begin;

create table public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_name text not null check (event_name in (
    'DIAGNOSTIC_VIEWED',
    'PREQUOTE_STARTED',
    'PREQUOTE_SUBMITTED',
    'PREQUOTE_SUCCEEDED',
    'PREQUOTE_FAILED',
    'PDF_DOWNLOADED'
  )),
  session_id uuid not null,
  correlation_id uuid,
  path text not null check (path in ('/diagnostico', '/privacidad')),
  properties jsonb not null default '{}'::jsonb check (jsonb_typeof(properties) = 'object'),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_.:-]{16,128}$'),
  evidence_class public.evidence_class not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create index analytics_events_funnel_idx
on public.analytics_events (organization_id, event_name, occurred_at desc);

create table public.analytics_rate_windows (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rate_limit_key_sha256 text not null check (rate_limit_key_sha256 ~ '^[a-f0-9]{64}$'),
  window_start timestamptz not null,
  request_count integer not null check (request_count between 1 and 120),
  updated_at timestamptz not null default now(),
  primary key (organization_id, rate_limit_key_sha256, window_start)
);

create or replace function public.capture_public_analytics_event(
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
  event_name_value text;
  session_id_value uuid;
  correlation_id_value uuid;
  path_value text;
  properties_value jsonb;
  occurred_at_value timestamptz;
  existing_event public.analytics_events%rowtype;
  created_event_id uuid := gen_random_uuid();
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
    or octet_length(target_payload_text) > 10000
  then
    raise exception 'ANALYTICS_REQUEST_INVALID';
  end if;

  select prequote_ingest_secret into runtime_secret
  from app.private_runtime_config
  where organization_id = target_organization_id;
  if not found then raise exception 'ANALYTICS_RUNTIME_NOT_CONFIGURED'; end if;

  calculated_payload_sha256 := encode(digest(target_payload_text, 'sha256'), 'hex');
  if calculated_payload_sha256 <> target_payload_sha256 then
    raise exception 'ANALYTICS_PAYLOAD_HASH_MISMATCH';
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
    raise exception 'ANALYTICS_SIGNATURE_INVALID';
  end if;

  request_expires_at := to_timestamp(target_request_expires_at_epoch);
  if request_expires_at < clock_timestamp() - interval '30 seconds'
    or request_expires_at > clock_timestamp() + interval '5 minutes 30 seconds'
  then
    raise exception 'ANALYTICS_PROOF_EXPIRED';
  end if;

  begin
    insert into public.public_prequote_nonces (
      organization_id, request_nonce, request_expires_at
    ) values (
      target_organization_id, target_request_nonce, request_expires_at
    );
  exception
    when unique_violation then raise exception 'ANALYTICS_REPLAY_REJECTED';
  end;

  perform pg_advisory_xact_lock(
    hashtextextended(target_organization_id::text || ':analytics:' || target_idempotency_key, 0)
  );
  select * into existing_event
  from public.analytics_events
  where organization_id = target_organization_id
    and idempotency_key = target_idempotency_key;
  if found then
    return jsonb_build_object('status', 'DUPLICATE', 'event_id', existing_event.id);
  end if;

  insert into public.analytics_rate_windows (
    organization_id, rate_limit_key_sha256, window_start, request_count
  ) values (
    target_organization_id, target_rate_limit_key_sha256, rate_window, 1
  )
  on conflict (organization_id, rate_limit_key_sha256, window_start)
  do update set
    request_count = public.analytics_rate_windows.request_count + 1,
    updated_at = clock_timestamp()
  where public.analytics_rate_windows.request_count < 120
  returning request_count into rate_count;
  if rate_count is null then raise exception 'ANALYTICS_RATE_LIMIT_EXCEEDED'; end if;

  begin
    payload := target_payload_text::jsonb;
    event_name_value := payload ->> 'eventName';
    session_id_value := (payload ->> 'sessionId')::uuid;
    correlation_id_value := nullif(payload ->> 'correlationId', '')::uuid;
    path_value := payload ->> 'path';
    properties_value := coalesce(payload -> 'properties', '{}'::jsonb);
    occurred_at_value := (payload ->> 'occurredAt')::timestamptz;
  exception when others then
    raise exception 'ANALYTICS_PAYLOAD_INVALID';
  end;

  if jsonb_typeof(payload) <> 'object'
    or event_name_value not in (
      'DIAGNOSTIC_VIEWED', 'PREQUOTE_STARTED', 'PREQUOTE_SUBMITTED',
      'PREQUOTE_SUCCEEDED', 'PREQUOTE_FAILED', 'PDF_DOWNLOADED'
    )
    or path_value not in ('/diagnostico', '/privacidad')
    or jsonb_typeof(properties_value) <> 'object'
    or occurred_at_value < clock_timestamp() - interval '24 hours'
    or occurred_at_value > clock_timestamp() + interval '5 minutes'
    or payload ->> 'evidenceClass' <> 'live'
  then
    raise exception 'ANALYTICS_PAYLOAD_POLICY_REJECTED';
  end if;

  if exists (
    select 1
    from jsonb_each_text(properties_value) as property
    where property.key not in ('estimate_kind', 'verdict', 'error_code', 'model_version')
      or property.value !~ '^[A-Za-z0-9_.:-]{1,100}$'
  ) then
    raise exception 'ANALYTICS_PROPERTIES_REJECTED';
  end if;

  insert into public.analytics_events (
    id, organization_id, event_name, session_id, correlation_id, path,
    properties, idempotency_key, evidence_class, occurred_at
  ) values (
    created_event_id, target_organization_id, event_name_value, session_id_value,
    correlation_id_value, path_value, properties_value, target_idempotency_key,
    'live', occurred_at_value
  );

  return jsonb_build_object('status', 'CREATED', 'event_id', created_event_id);
end;
$$;

alter table public.analytics_events enable row level security;
alter table public.analytics_rate_windows enable row level security;

create policy analytics_events_member_read
on public.analytics_events
for select using (app.is_member(organization_id));

revoke all on table public.analytics_events from public;
revoke all on table public.analytics_rate_windows from public;
revoke all on function public.capture_public_analytics_event(uuid, text, uuid, bigint, text, text, text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant usage on schema public to anon;
    grant execute on function public.capture_public_analytics_event(uuid, text, uuid, bigint, text, text, text, text) to anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on public.analytics_events to authenticated;
    revoke all on table public.analytics_rate_windows from authenticated;
    revoke execute on function public.capture_public_analytics_event(uuid, text, uuid, bigint, text, text, text, text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on table public.analytics_rate_windows from service_role;
  end if;
end;
$$;

commit;
