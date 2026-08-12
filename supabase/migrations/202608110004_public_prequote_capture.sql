begin;

alter table public.prequote_models
  add constraint prequote_models_organization_id_id_unique
  unique (organization_id, id);

alter table public.prequotes
  drop constraint prequotes_model_id_fkey;

alter table public.prequotes
  add constraint prequotes_model_tenant_fkey
  foreign key (organization_id, model_id)
  references public.prequote_models (organization_id, id);

alter table public.prequotes
  add column idempotency_key text;

alter table public.prequotes
  add column privacy_notice_version text;

update public.prequotes
set idempotency_key = 'legacy:' || id::text
where idempotency_key is null;

update public.prequotes
set privacy_notice_version = 'LEGACY_UNKNOWN'
where privacy_notice_version is null;

alter table public.prequotes
  alter column idempotency_key set not null,
  alter column privacy_notice_version set not null,
  add constraint prequotes_idempotency_key_format
    check (idempotency_key ~ '^[A-Za-z0-9_.:-]{16,128}$'),
  add constraint prequotes_organization_idempotency_unique
    unique (organization_id, idempotency_key),
  add constraint prequotes_privacy_notice_version_format
    check (privacy_notice_version ~ '^[A-Za-z0-9_.:-]{8,64}$');

create table app.private_runtime_config (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  prequote_ingest_secret text not null check (length(prequote_ingest_secret) >= 32),
  updated_at timestamptz not null default now()
);

create table public.public_prequote_nonces (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_nonce uuid not null,
  request_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, request_nonce),
  check (request_expires_at <= created_at + interval '10 minutes')
);

create index public_prequote_nonces_expiry_idx
on public.public_prequote_nonces (request_expires_at);

create table public.public_prequote_rate_windows (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rate_limit_key_sha256 text not null check (rate_limit_key_sha256 ~ '^[a-f0-9]{64}$'),
  window_start timestamptz not null,
  request_count integer not null check (request_count between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (organization_id, rate_limit_key_sha256, window_start)
);

create or replace function public.create_public_prequote(
  target_organization_id uuid,
  target_idempotency_key text,
  target_request_nonce uuid,
  target_request_expires_at_epoch bigint,
  target_payload_sha256 text,
  target_request_signature text,
  target_rate_limit_key_sha256 text,
  target_payload_text text
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  runtime_secret text;
  expected_signature text;
  signed_value text;
  calculated_payload_sha256 text;
  request_expires_at timestamptz;
  payload jsonb;
  input_payload jsonb;
  estimate_payload jsonb;
  contact_payload jsonb;
  attribution_payload jsonb;
  selected_model public.prequote_models%rowtype;
  existing_prequote public.prequotes%rowtype;
  created_prequote_id uuid := gen_random_uuid();
  created_folio text;
  created_correlation_id uuid;
  normalized_email_value text;
  normalized_phone_value text;
  phone_digits text;
  monthly_spend_value numeric(16,2);
  installed_capacity_value numeric(14,3);
  coverage_target_value numeric(5,2);
  rate_window timestamptz := date_trunc('hour', clock_timestamp());
  rate_count integer;
begin
  if target_organization_id is null
    or target_request_nonce is null
    or target_idempotency_key is null
    or target_idempotency_key !~ '^[A-Za-z0-9_.:-]{16,128}$'
    or target_payload_sha256 !~ '^[a-f0-9]{64}$'
    or target_request_signature !~ '^[a-f0-9]{64}$'
    or target_rate_limit_key_sha256 !~ '^[a-f0-9]{64}$'
    or target_payload_text is null
    or octet_length(target_payload_text) > 100000
  then
    raise exception 'PUBLIC_PREQUOTE_REQUEST_INVALID';
  end if;

  select prequote_ingest_secret into runtime_secret
  from app.private_runtime_config
  where organization_id = target_organization_id;
  if not found then raise exception 'PUBLIC_PREQUOTE_RUNTIME_NOT_CONFIGURED'; end if;

  calculated_payload_sha256 := encode(digest(target_payload_text, 'sha256'), 'hex');
  if calculated_payload_sha256 <> target_payload_sha256 then
    raise exception 'PUBLIC_PREQUOTE_PAYLOAD_HASH_MISMATCH';
  end if;

  signed_value := concat_ws(E'\n',
    target_organization_id::text,
    target_idempotency_key,
    target_request_nonce::text,
    target_request_expires_at_epoch::text,
    target_payload_sha256,
    target_rate_limit_key_sha256
  );
  expected_signature := encode(
    hmac(convert_to(signed_value, 'UTF8'), convert_to(runtime_secret, 'UTF8'), 'sha256'),
    'hex'
  );
  if digest(target_request_signature, 'sha256') <> digest(expected_signature, 'sha256') then
    raise exception 'PUBLIC_PREQUOTE_SIGNATURE_INVALID';
  end if;

  request_expires_at := to_timestamp(target_request_expires_at_epoch);
  if request_expires_at < clock_timestamp() - interval '30 seconds'
    or request_expires_at > clock_timestamp() + interval '5 minutes 30 seconds'
  then
    raise exception 'PUBLIC_PREQUOTE_PROOF_EXPIRED';
  end if;

  begin
    insert into public.public_prequote_nonces (
      organization_id, request_nonce, request_expires_at
    ) values (
      target_organization_id, target_request_nonce, request_expires_at
    );
  exception
    when unique_violation then raise exception 'PUBLIC_PREQUOTE_REPLAY_REJECTED';
  end;

  perform pg_advisory_xact_lock(
    hashtextextended(target_organization_id::text || ':' || target_idempotency_key, 0)
  );

  select * into existing_prequote
  from public.prequotes
  where organization_id = target_organization_id
    and idempotency_key = target_idempotency_key;
  if found then
    return jsonb_build_object(
      'status', 'DUPLICATE',
      'record_id', existing_prequote.id,
      'folio', existing_prequote.folio,
      'correlation_id', existing_prequote.correlation_id
    );
  end if;

  insert into public.public_prequote_rate_windows (
    organization_id, rate_limit_key_sha256, window_start, request_count
  ) values (
    target_organization_id, target_rate_limit_key_sha256, rate_window, 1
  )
  on conflict (organization_id, rate_limit_key_sha256, window_start)
  do update set
    request_count = public.public_prequote_rate_windows.request_count + 1,
    updated_at = clock_timestamp()
  where public.public_prequote_rate_windows.request_count < 5
  returning request_count into rate_count;
  if rate_count is null then raise exception 'PUBLIC_PREQUOTE_RATE_LIMIT_EXCEEDED'; end if;

  begin
    payload := target_payload_text::jsonb;
  exception when others then
    raise exception 'PUBLIC_PREQUOTE_PAYLOAD_JSON_INVALID';
  end;
  if jsonb_typeof(payload) <> 'object'
    or jsonb_typeof(payload -> 'input') <> 'object'
    or jsonb_typeof(payload -> 'estimate') <> 'object'
  then
    raise exception 'PUBLIC_PREQUOTE_PAYLOAD_SHAPE_INVALID';
  end if;

  input_payload := payload -> 'input';
  estimate_payload := payload -> 'estimate';
  contact_payload := input_payload -> 'contact';
  attribution_payload := coalesce(input_payload -> 'attribution', '{}'::jsonb);
  if jsonb_typeof(contact_payload) <> 'object'
    or jsonb_typeof(attribution_payload) <> 'object'
    or input_payload -> 'consent' <> 'true'::jsonb
    or input_payload ->> 'privacyNoticeVersion' !~ '^[A-Za-z0-9_.:-]{8,64}$'
    or estimate_payload ->> 'strictLeadStatus' <> 'DOES_NOT_COUNT_WITHOUT_HUMAN_EVIDENCE'
    or estimate_payload ->> 'modelStatus' <> 'APPROVED'
    or estimate_payload ->> 'estimateKind' not in ('SOLAR_RANGE', 'SERVICE_REVIEW')
    or estimate_payload ->> 'verdict' not in ('OUT_OF_SCOPE', 'COMMERCIAL_REVIEW', 'INDUSTRIAL_REVIEW', 'TECHNICAL_REVIEW')
    or input_payload ->> 'needType' not in ('SOLAR_NEW', 'SOLAR_EXISTING', 'MAINTENANCE_THERMOGRAPHY', 'ELECTRICAL_INFRASTRUCTURE', 'TRANSFORMERS', 'STORAGE')
    or input_payload ->> 'tariff' not in ('GDMTH', 'GDMTO', 'PDBT', 'UNKNOWN')
    or input_payload ->> 'zone' not in ('URBAN', 'SUBURBAN', 'RURAL')
  then
    raise exception 'PUBLIC_PREQUOTE_PAYLOAD_POLICY_REJECTED';
  end if;

  begin
    created_correlation_id := (payload ->> 'correlationId')::uuid;
    monthly_spend_value := (input_payload ->> 'monthlySpendMxn')::numeric;
    installed_capacity_value := (input_payload ->> 'existingCapacityKwp')::numeric;
    coverage_target_value := (input_payload ->> 'coverageTargetPct')::numeric;
  exception when others then
    raise exception 'PUBLIC_PREQUOTE_NUMERIC_OR_ID_INVALID';
  end;
  if monthly_spend_value < 0 or monthly_spend_value > 50000000
    or installed_capacity_value < 0 or installed_capacity_value > 100000
    or coverage_target_value < 30 or coverage_target_value > 100
  then
    raise exception 'PUBLIC_PREQUOTE_RANGE_INVALID';
  end if;

  if length(btrim(input_payload ->> 'city')) not between 2 and 100
    or length(btrim(input_payload ->> 'state')) not between 2 and 100
    or length(btrim(contact_payload ->> 'company')) not between 2 and 160
    or length(btrim(contact_payload ->> 'fullName')) not between 2 and 160
    or length(btrim(contact_payload ->> 'role')) not between 2 and 120
  then
    raise exception 'PUBLIC_PREQUOTE_TEXT_INVALID';
  end if;

  normalized_email_value := lower(btrim(contact_payload ->> 'email'));
  if length(normalized_email_value) > 254
    or normalized_email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise exception 'PUBLIC_PREQUOTE_EMAIL_INVALID';
  end if;

  phone_digits := regexp_replace(coalesce(contact_payload ->> 'phone', ''), '[^0-9]', '', 'g');
  if left(coalesce(contact_payload ->> 'phone', ''), 1) = '+' then
    normalized_phone_value := '+' || phone_digits;
  elsif length(phone_digits) = 10 then
    normalized_phone_value := '+52' || phone_digits;
  elsif length(phone_digits) between 11 and 15 then
    normalized_phone_value := '+' || phone_digits;
  else
    raise exception 'PUBLIC_PREQUOTE_PHONE_INVALID';
  end if;
  if normalized_phone_value !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'PUBLIC_PREQUOTE_PHONE_INVALID';
  end if;

  select * into selected_model
  from public.prequote_models
  where organization_id = target_organization_id
    and version = estimate_payload ->> 'modelVersion'
    and status = 'APPROVED'
    and approved_by is not null
    and approved_at is not null
    and coalesce(valid_from, '-infinity'::timestamptz) <= clock_timestamp()
    and coalesce(valid_until, 'infinity'::timestamptz) >= clock_timestamp();
  if not found then raise exception 'PUBLIC_PREQUOTE_MODEL_NOT_APPROVED'; end if;

  created_folio := 'ENN-PRE-' || upper(substr(replace(created_prequote_id::text, '-', ''), 1, 8));
  insert into public.prequotes (
    id, organization_id, model_id, folio, need_type, account_name, contact_name,
    contact_role, normalized_email, phone_e164, monthly_spend_mxn, tariff,
    installed_capacity_kwp, coverage_target_pct, city, state, zone, result_json,
    consented_at, evidence_class, correlation_id, idempotency_key, privacy_notice_version
  ) values (
    created_prequote_id,
    target_organization_id,
    selected_model.id,
    created_folio,
    input_payload ->> 'needType',
    btrim(contact_payload ->> 'company'),
    btrim(contact_payload ->> 'fullName'),
    btrim(contact_payload ->> 'role'),
    normalized_email_value,
    normalized_phone_value,
    monthly_spend_value,
    input_payload ->> 'tariff',
    installed_capacity_value,
    coverage_target_value,
    btrim(input_payload ->> 'city'),
    btrim(input_payload ->> 'state'),
    input_payload ->> 'zone',
    jsonb_build_object('estimate', estimate_payload, 'attribution', attribution_payload),
    clock_timestamp(),
    'live',
    created_correlation_id,
    target_idempotency_key,
    input_payload ->> 'privacyNoticeVersion'
  );

  insert into public.event_outbox (
    organization_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload_json
  ) values (
    target_organization_id,
    'prequote',
    created_prequote_id,
    'prequote.captured',
    'prequote-captured:' || created_prequote_id::text,
    jsonb_build_object(
      'prequote_id', created_prequote_id,
      'folio', created_folio,
      'verdict', estimate_payload ->> 'verdict',
      'evidence_class', 'live',
      'correlation_id', created_correlation_id
    )
  );

  insert into public.audit_log (
    organization_id, actor_user_id, action, record_type, record_id, correlation_id, new_data
  ) values (
    target_organization_id,
    null,
    'PUBLIC_CAPTURE',
    'prequotes',
    created_prequote_id,
    created_correlation_id,
    jsonb_build_object(
      'id', created_prequote_id,
      'organization_id', target_organization_id,
      'model_id', selected_model.id,
      'folio', created_folio,
      'need_type', input_payload ->> 'needType',
      'verdict', estimate_payload ->> 'verdict',
      'evidence_class', 'live',
      'privacy_notice_version', input_payload ->> 'privacyNoticeVersion',
      'created_at', clock_timestamp()
    )
  );

  return jsonb_build_object(
    'status', 'CREATED',
    'record_id', created_prequote_id,
    'folio', created_folio,
    'correlation_id', created_correlation_id
  );
end;
$$;

alter table public.public_prequote_nonces enable row level security;
alter table public.public_prequote_rate_windows enable row level security;

revoke all on table app.private_runtime_config from public;
revoke all on table public.public_prequote_nonces from public;
revoke all on table public.public_prequote_rate_windows from public;
revoke all on function public.create_public_prequote(uuid, text, uuid, bigint, text, text, text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant usage on schema public to anon;
    grant execute on function public.create_public_prequote(uuid, text, uuid, bigint, text, text, text, text) to anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table app.private_runtime_config from authenticated;
    revoke all on table public.public_prequote_nonces from authenticated;
    revoke all on table public.public_prequote_rate_windows from authenticated;
    revoke execute on function public.create_public_prequote(uuid, text, uuid, bigint, text, text, text, text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on table app.private_runtime_config from service_role;
    revoke all on table public.public_prequote_nonces from service_role;
    revoke all on table public.public_prequote_rate_windows from service_role;
  end if;
end;
$$;

commit;
