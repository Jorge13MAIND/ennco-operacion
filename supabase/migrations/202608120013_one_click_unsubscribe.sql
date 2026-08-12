begin;

alter table app.private_runtime_config
  add column unsubscribe_ingest_secret text
  check (unsubscribe_ingest_secret is null or length(unsubscribe_ingest_secret) >= 32);

create table public.unsubscribe_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  enrollment_id uuid not null,
  token_nonce uuid not null,
  idempotency_key text not null check (idempotency_key ~ '^unsubscribe:[a-f0-9]{64}$'),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  foreign key (organization_id, enrollment_id)
    references public.campaign_enrollments (organization_id, id),
  unique (organization_id, token_nonce),
  unique (organization_id, idempotency_key),
  unique (organization_id, id)
);

create or replace function public.apply_one_click_unsubscribe(
  target_organization_id uuid,
  target_enrollment_id uuid,
  target_token_nonce uuid,
  target_idempotency_key text,
  target_request_nonce uuid,
  target_request_expires_at_epoch bigint,
  target_payload_sha256 text,
  target_request_signature text
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  runtime_secret text;
  expected_payload_sha256 text;
  expected_signature text;
  canonical_value text;
  request_expires_at timestamptz;
  enrollment_record public.campaign_enrollments%rowtype;
  contact_record public.contacts%rowtype;
  existing_request public.unsubscribe_requests%rowtype;
  created_request public.unsubscribe_requests%rowtype;
begin
  if target_organization_id is null
    or target_enrollment_id is null
    or target_token_nonce is null
    or target_request_nonce is null
    or target_idempotency_key !~ '^unsubscribe:[a-f0-9]{64}$'
    or target_payload_sha256 !~ '^[a-f0-9]{64}$'
    or target_request_signature !~ '^[a-f0-9]{64}$'
  then raise exception 'UNSUBSCRIBE_REQUEST_INVALID'; end if;

  select unsubscribe_ingest_secret into runtime_secret
  from app.private_runtime_config
  where organization_id = target_organization_id;
  if not found or runtime_secret is null then raise exception 'UNSUBSCRIBE_RUNTIME_NOT_CONFIGURED'; end if;

  expected_payload_sha256 := encode(digest(
    target_organization_id::text || ':' || target_enrollment_id::text || ':' || target_token_nonce::text,
    'sha256'
  ), 'hex');
  if target_payload_sha256 <> expected_payload_sha256 then
    raise exception 'UNSUBSCRIBE_PAYLOAD_HASH_MISMATCH';
  end if;

  canonical_value := concat_ws(':',
    target_organization_id::text,
    target_enrollment_id::text,
    target_token_nonce::text,
    target_idempotency_key,
    target_request_nonce::text,
    target_request_expires_at_epoch::text,
    target_payload_sha256
  );
  expected_signature := encode(
    hmac(convert_to(canonical_value, 'UTF8'), convert_to(runtime_secret, 'UTF8'), 'sha256'),
    'hex'
  );
  if digest(target_request_signature, 'sha256') <> digest(expected_signature, 'sha256') then
    raise exception 'UNSUBSCRIBE_SIGNATURE_INVALID';
  end if;

  request_expires_at := to_timestamp(target_request_expires_at_epoch);
  if request_expires_at < clock_timestamp() - interval '30 seconds'
    or request_expires_at > clock_timestamp() + interval '5 minutes 30 seconds'
  then raise exception 'UNSUBSCRIBE_PROOF_EXPIRED'; end if;

  begin
    insert into public.public_prequote_nonces (organization_id, request_nonce, request_expires_at)
    values (target_organization_id, target_request_nonce, request_expires_at);
  exception
    when unique_violation then raise exception 'UNSUBSCRIBE_REPLAY_REJECTED';
  end;

  perform pg_advisory_xact_lock(
    hashtextextended(target_organization_id::text || ':unsubscribe:' || target_enrollment_id::text, 0)
  );

  select * into existing_request
  from public.unsubscribe_requests
  where organization_id = target_organization_id
    and (idempotency_key = target_idempotency_key or token_nonce = target_token_nonce);
  if found then
    if existing_request.enrollment_id <> target_enrollment_id
      or existing_request.token_nonce <> target_token_nonce
      or existing_request.idempotency_key <> target_idempotency_key
      or existing_request.payload_sha256 <> target_payload_sha256
    then raise exception 'UNSUBSCRIBE_IDEMPOTENCY_DRIFT'; end if;
    return jsonb_build_object(
      'status', 'DUPLICATE',
      'request_id', existing_request.id,
      'correlation_id', existing_request.correlation_id
    );
  end if;

  select * into enrollment_record
  from public.campaign_enrollments
  where organization_id = target_organization_id and id = target_enrollment_id
  for update;
  if not found then raise exception 'UNSUBSCRIBE_ENROLLMENT_NOT_FOUND'; end if;

  select * into contact_record
  from public.contacts
  where organization_id = target_organization_id and id = enrollment_record.contact_id;
  if not found or contact_record.is_deleted then raise exception 'UNSUBSCRIBE_CONTACT_NOT_FOUND'; end if;

  insert into public.suppression_entries (
    organization_id, kind, normalized_email, reason
  ) values (
    target_organization_id, 'UNSUBSCRIBE', contact_record.normalized_email, 'ONE_CLICK_UNSUBSCRIBE'
  ) on conflict do nothing;

  update public.campaign_enrollments
  set status = 'UNSUBSCRIBED', stopped_reason = 'ONE_CLICK_UNSUBSCRIBE',
      next_touch_at = null, updated_at = now()
  where organization_id = target_organization_id and id = target_enrollment_id;

  insert into public.unsubscribe_requests (
    organization_id, enrollment_id, token_nonce, idempotency_key, payload_sha256
  ) values (
    target_organization_id, target_enrollment_id, target_token_nonce,
    target_idempotency_key, target_payload_sha256
  ) returning * into created_request;

  insert into public.event_outbox (
    organization_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload_json
  ) values (
    target_organization_id, 'enrollment', target_enrollment_id, 'contact.unsubscribed',
    'one-click-unsubscribe:' || created_request.id::text,
    jsonb_build_object(
      'unsubscribe_request_id', created_request.id,
      'enrollment_id', target_enrollment_id,
      'correlation_id', created_request.correlation_id,
      'source', 'ONE_CLICK'
    )
  );

  insert into public.audit_log (
    organization_id, actor_user_id, action, record_type, record_id, correlation_id, new_data
  ) values (
    target_organization_id, null, 'ONE_CLICK_APPLIED', 'unsubscribe_requests',
    created_request.id, created_request.correlation_id,
    jsonb_build_object(
      'id', created_request.id,
      'organization_id', target_organization_id,
      'enrollment_id', target_enrollment_id,
      'created_at', created_request.created_at
    )
  );

  return jsonb_build_object(
    'status', 'CREATED',
    'request_id', created_request.id,
    'correlation_id', created_request.correlation_id
  );
end;
$$;

alter table public.unsubscribe_requests enable row level security;
create policy unsubscribe_requests_member_read on public.unsubscribe_requests
for select using (app.is_member(organization_id));

revoke all on table public.unsubscribe_requests from public;
revoke all on function public.apply_one_click_unsubscribe(uuid, uuid, uuid, text, uuid, bigint, text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant usage on schema public to anon;
    grant execute on function public.apply_one_click_unsubscribe(uuid, uuid, uuid, text, uuid, bigint, text, text) to anon;
    revoke all on table public.unsubscribe_requests from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on public.unsubscribe_requests to authenticated;
    revoke insert, update, delete, truncate on public.unsubscribe_requests from authenticated;
    revoke execute on function public.apply_one_click_unsubscribe(uuid, uuid, uuid, text, uuid, bigint, text, text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on public.unsubscribe_requests to service_role;
    revoke insert, update, delete, truncate on public.unsubscribe_requests from service_role;
  end if;
end;
$$;

commit;
