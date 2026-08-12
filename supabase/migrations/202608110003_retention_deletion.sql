begin;

create type public.legal_hold_status as enum ('ACTIVE', 'RELEASED');
create type public.deletion_batch_status as enum ('DRAFT', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED');
create type public.deletion_item_status as enum ('PENDING', 'ELIGIBLE', 'INELIGIBLE_RETENTION', 'BLOCKED_HOLD', 'EXECUTED', 'FAILED');
create type public.deletion_reason_code as enum ('RETENTION_EXPIRED', 'DATA_SUBJECT_REQUEST', 'SYNTHETIC_TEST');
create type public.legal_hold_reason_code as enum ('LEGAL', 'CONTRACTUAL', 'INCIDENT', 'DISPUTE');
create type public.restoration_status as enum ('NOT_REQUESTED', 'NOT_POSSIBLE', 'METADATA_ONLY_VERIFIED');

create unique index contacts_organization_id_id_unique
on public.contacts (organization_id, id);

create table public.legal_holds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subject_type text not null default 'CONTACT' check (subject_type = 'CONTACT'),
  subject_id uuid not null,
  status public.legal_hold_status not null default 'ACTIVE',
  reason_code public.legal_hold_reason_code not null,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  effective_at timestamptz not null default now(),
  review_due_at timestamptz,
  created_by uuid not null,
  released_by uuid,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legal_holds_contact_tenant_fkey
    foreign key (organization_id, subject_id)
    references public.contacts (organization_id, id),
  check (review_due_at is null or review_due_at > effective_at),
  check (
    (status = 'ACTIVE' and released_by is null and released_at is null)
    or (status = 'RELEASED' and released_by is not null and released_at is not null)
  )
);

create unique index legal_holds_one_active_per_contact
on public.legal_holds (organization_id, subject_id)
where status = 'ACTIVE';

create table public.deletion_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  status public.deletion_batch_status not null default 'DRAFT',
  reason_code public.deletion_reason_code not null,
  evidence_class public.evidence_class not null,
  input_manifest_sha256 text not null check (input_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  requested_by uuid not null,
  approved_by uuid,
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'DRAFT' and approved_by is null and approved_at is null and started_at is null and completed_at is null)
    or (status in ('APPROVED', 'CANCELLED') and approved_by is not null and approved_at is not null and started_at is null and completed_at is null)
    or (status = 'IN_PROGRESS' and approved_by is not null and approved_at is not null and started_at is not null and completed_at is null)
    or (status in ('COMPLETED', 'FAILED') and approved_by is not null and approved_at is not null and started_at is not null and completed_at is not null)
  ),
  check (approved_by is null or approved_by <> requested_by)
);

create unique index deletion_batches_organization_id_id_unique
on public.deletion_batches (organization_id, id);

create table public.deletion_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  batch_id uuid not null,
  subject_type text not null default 'CONTACT' check (subject_type = 'CONTACT'),
  subject_id uuid not null,
  subject_hash text not null check (subject_hash ~ '^[a-f0-9]{64}$'),
  status public.deletion_item_status not null default 'PENDING',
  retention_due_at timestamptz not null,
  evaluated_at timestamptz,
  blocked_hold_id uuid references public.legal_holds(id),
  failure_code text check (failure_code is null or failure_code ~ '^[A-Z0-9_]{1,64}$'),
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deletion_items_batch_tenant_fkey
    foreign key (organization_id, batch_id)
    references public.deletion_batches (organization_id, id)
    on delete cascade,
  constraint deletion_items_contact_tenant_fkey
    foreign key (organization_id, subject_id)
    references public.contacts (organization_id, id),
  unique (batch_id, subject_type, subject_id),
  check (
    (status in ('PENDING', 'ELIGIBLE', 'INELIGIBLE_RETENTION') and blocked_hold_id is null and executed_at is null)
    or (status = 'BLOCKED_HOLD' and blocked_hold_id is not null and executed_at is null)
    or (status = 'EXECUTED' and blocked_hold_id is null and failure_code is null and executed_at is not null)
    or (status = 'FAILED' and failure_code is not null and executed_at is null)
  )
);

create unique index deletion_items_organization_id_id_unique
on public.deletion_items (organization_id, id);

create table public.deletion_tombstones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deletion_item_id uuid not null,
  subject_type text not null check (subject_type = 'CONTACT'),
  subject_hash text not null check (subject_hash ~ '^[a-f0-9]{64}$'),
  deletion_evidence_sha256 text not null check (deletion_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  deleted_at timestamptz not null,
  restore_semantics text not null default 'NO_RAW_DATA_RESTORE_FROM_TOMBSTONE'
    check (restore_semantics = 'NO_RAW_DATA_RESTORE_FROM_TOMBSTONE'),
  restoration_status public.restoration_status not null default 'NOT_POSSIBLE',
  restoration_reviewed_by uuid,
  restoration_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint deletion_tombstones_item_tenant_fkey
    foreign key (organization_id, deletion_item_id)
    references public.deletion_items (organization_id, id),
  unique (organization_id, deletion_item_id),
  check (
    (restoration_status in ('NOT_REQUESTED', 'NOT_POSSIBLE') and restoration_reviewed_by is null and restoration_reviewed_at is null)
    or (restoration_status = 'METADATA_ONLY_VERIFIED' and restoration_reviewed_by is not null and restoration_reviewed_at is not null)
  )
);

create or replace function app.retention_audit_snapshot(
  target_record_type text,
  snapshot jsonb
)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when snapshot is null then null
    when target_record_type = 'legal_holds' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'subject_type', snapshot -> 'subject_type',
      'subject_id', snapshot -> 'subject_id',
      'status', snapshot -> 'status',
      'reason_code', snapshot -> 'reason_code',
      'evidence_sha256', snapshot -> 'evidence_sha256',
      'effective_at', snapshot -> 'effective_at',
      'review_due_at', snapshot -> 'review_due_at',
      'created_by', snapshot -> 'created_by',
      'released_by', snapshot -> 'released_by',
      'released_at', snapshot -> 'released_at',
      'created_at', snapshot -> 'created_at',
      'updated_at', snapshot -> 'updated_at'
    ))
    when target_record_type = 'deletion_batches' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'status', snapshot -> 'status',
      'reason_code', snapshot -> 'reason_code',
      'evidence_class', snapshot -> 'evidence_class',
      'input_manifest_sha256', snapshot -> 'input_manifest_sha256',
      'requested_by', snapshot -> 'requested_by',
      'approved_by', snapshot -> 'approved_by',
      'approved_at', snapshot -> 'approved_at',
      'started_at', snapshot -> 'started_at',
      'completed_at', snapshot -> 'completed_at',
      'created_at', snapshot -> 'created_at',
      'updated_at', snapshot -> 'updated_at'
    ))
    when target_record_type = 'deletion_items' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'batch_id', snapshot -> 'batch_id',
      'subject_type', snapshot -> 'subject_type',
      'subject_id', snapshot -> 'subject_id',
      'subject_hash', snapshot -> 'subject_hash',
      'status', snapshot -> 'status',
      'retention_due_at', snapshot -> 'retention_due_at',
      'evaluated_at', snapshot -> 'evaluated_at',
      'blocked_hold_id', snapshot -> 'blocked_hold_id',
      'failure_code', snapshot -> 'failure_code',
      'executed_at', snapshot -> 'executed_at',
      'created_at', snapshot -> 'created_at',
      'updated_at', snapshot -> 'updated_at'
    ))
    when target_record_type = 'deletion_tombstones' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'deletion_item_id', snapshot -> 'deletion_item_id',
      'subject_type', snapshot -> 'subject_type',
      'subject_hash', snapshot -> 'subject_hash',
      'deletion_evidence_sha256', snapshot -> 'deletion_evidence_sha256',
      'deleted_at', snapshot -> 'deleted_at',
      'restore_semantics', snapshot -> 'restore_semantics',
      'restoration_status', snapshot -> 'restoration_status',
      'restoration_reviewed_by', snapshot -> 'restoration_reviewed_by',
      'restoration_reviewed_at', snapshot -> 'restoration_reviewed_at',
      'created_at', snapshot -> 'created_at'
    ))
    else jsonb_build_object('redaction', 'NO_RETENTION_ALLOWLIST_FOR_RECORD_TYPE')
  end;
$$;

create or replace function app.capture_retention_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  raw_data jsonb;
begin
  raw_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.audit_log (
    organization_id, actor_user_id, action, record_type, record_id, old_data, new_data
  ) values (
    nullif(raw_data ->> 'organization_id', '')::uuid,
    auth.uid(),
    tg_op,
    tg_table_name,
    nullif(raw_data ->> 'id', '')::uuid,
    case when tg_op in ('UPDATE', 'DELETE') then app.retention_audit_snapshot(tg_table_name, to_jsonb(old)) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then app.retention_audit_snapshot(tg_table_name, to_jsonb(new)) else null end
  );
  return coalesce(new, old);
end;
$$;

create or replace function app.enforce_legal_hold_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.subject_type is distinct from old.subject_type
    or new.subject_id is distinct from old.subject_id
    or new.reason_code is distinct from old.reason_code
    or new.evidence_sha256 is distinct from old.evidence_sha256
    or new.created_by is distinct from old.created_by
    or new.effective_at is distinct from old.effective_at
  then raise exception 'LEGAL_HOLD_IDENTITY_IMMUTABLE'; end if;

  if old.status = 'ACTIVE' and new.status not in ('ACTIVE', 'RELEASED') then
    raise exception 'INVALID_LEGAL_HOLD_TRANSITION';
  end if;
  if old.status = 'RELEASED' and new is distinct from old then
    raise exception 'RELEASED_LEGAL_HOLD_IMMUTABLE';
  end if;
  return new;
end;
$$;

create or replace function app.enforce_legal_hold_actor()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null then raise exception 'AUTHENTICATED_ACTOR_REQUIRED'; end if;

  perform pg_advisory_xact_lock(
    hashtextextended('legal-hold:' || new.organization_id::text || ':' || new.subject_id::text, 0)
  );

  if tg_op = 'INSERT' then
    if new.created_by is distinct from actor_id then raise exception 'LEGAL_HOLD_CREATED_BY_MISMATCH'; end if;
  elsif old.status = 'ACTIVE' and new.status = 'RELEASED' then
    if new.released_by is distinct from actor_id then raise exception 'LEGAL_HOLD_RELEASED_BY_MISMATCH'; end if;
  end if;
  return new;
end;
$$;

create or replace function app.enforce_deletion_batch_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.reason_code is distinct from old.reason_code
    or new.evidence_class is distinct from old.evidence_class
    or new.input_manifest_sha256 is distinct from old.input_manifest_sha256
    or new.requested_by is distinct from old.requested_by
  then raise exception 'DELETION_BATCH_IDENTITY_IMMUTABLE'; end if;

  if new.status is distinct from old.status and not (
    (old.status = 'DRAFT' and new.status in ('APPROVED', 'CANCELLED'))
    or (old.status = 'APPROVED' and new.status in ('IN_PROGRESS', 'CANCELLED'))
    or (old.status = 'IN_PROGRESS' and new.status in ('COMPLETED', 'FAILED'))
  ) then raise exception 'INVALID_DELETION_BATCH_TRANSITION'; end if;

  if old.status in ('COMPLETED', 'FAILED', 'CANCELLED') and new is distinct from old then
    raise exception 'TERMINAL_DELETION_BATCH_IMMUTABLE';
  end if;
  return new;
end;
$$;

create or replace function app.enforce_deletion_batch_actor()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if actor_id is null then raise exception 'AUTHENTICATED_ACTOR_REQUIRED'; end if;
    if new.status <> 'DRAFT' then raise exception 'DELETION_BATCH_MUST_START_DRAFT'; end if;
    if new.requested_by is distinct from actor_id then raise exception 'DELETION_BATCH_REQUESTED_BY_MISMATCH'; end if;
  elsif old.status = 'DRAFT' and new.status in ('APPROVED', 'CANCELLED') then
    if actor_id is null then raise exception 'AUTHENTICATED_ACTOR_REQUIRED'; end if;
    if new.approved_by is distinct from actor_id then raise exception 'DELETION_BATCH_APPROVED_BY_MISMATCH'; end if;
    if new.approved_by = old.requested_by then raise exception 'DELETION_BATCH_FOUR_EYES_REQUIRED'; end if;
  elsif new.status is distinct from old.status then
    if current_user <> 'service_role'
      and not pg_has_role(current_user, 'pg_database_owner', 'USAGE')
    then raise exception 'DELETION_BATCH_TECHNICAL_TRANSITION_REQUIRES_SERVICE_ROLE'; end if;
  end if;
  return new;
end;
$$;

create or replace function app.enforce_deletion_item_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.batch_id is distinct from old.batch_id
    or new.subject_type is distinct from old.subject_type
    or new.subject_id is distinct from old.subject_id
    or new.subject_hash is distinct from old.subject_hash
    or new.retention_due_at is distinct from old.retention_due_at
  then raise exception 'DELETION_ITEM_IDENTITY_IMMUTABLE'; end if;

  if new.status is distinct from old.status and not (
    (old.status = 'PENDING' and new.status in ('ELIGIBLE', 'INELIGIBLE_RETENTION', 'BLOCKED_HOLD', 'FAILED'))
    or (old.status = 'ELIGIBLE' and new.status in ('BLOCKED_HOLD', 'EXECUTED', 'FAILED'))
    or (old.status in ('INELIGIBLE_RETENTION', 'BLOCKED_HOLD') and new.status = 'PENDING')
  ) then raise exception 'INVALID_DELETION_ITEM_TRANSITION'; end if;

  if old.status in ('EXECUTED', 'FAILED') and new is distinct from old then
    raise exception 'TERMINAL_DELETION_ITEM_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger legal_holds_updated_at before update on public.legal_holds
for each row execute function app.set_updated_at();
create trigger deletion_batches_updated_at before update on public.deletion_batches
for each row execute function app.set_updated_at();
create trigger deletion_items_updated_at before update on public.deletion_items
for each row execute function app.set_updated_at();

create trigger legal_holds_transition before update on public.legal_holds
for each row execute function app.enforce_legal_hold_transition();
create trigger legal_holds_actor before insert or update on public.legal_holds
for each row execute function app.enforce_legal_hold_actor();
create trigger deletion_batches_transition before update on public.deletion_batches
for each row execute function app.enforce_deletion_batch_transition();
create trigger deletion_batches_actor before insert or update on public.deletion_batches
for each row execute function app.enforce_deletion_batch_actor();
create trigger deletion_items_transition before update on public.deletion_items
for each row execute function app.enforce_deletion_item_transition();

create trigger legal_holds_audit after insert or update or delete on public.legal_holds
for each row execute function app.capture_retention_audit_event();
create trigger deletion_batches_audit after insert or update or delete on public.deletion_batches
for each row execute function app.capture_retention_audit_event();
create trigger deletion_items_audit after insert or update or delete on public.deletion_items
for each row execute function app.capture_retention_audit_event();
create trigger deletion_tombstones_audit after insert or update or delete on public.deletion_tombstones
for each row execute function app.capture_retention_audit_event();

create or replace function app.is_contact_under_legal_hold(
  target_organization_id uuid,
  target_contact_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.legal_holds lh
    where lh.organization_id = target_organization_id
      and lh.subject_type = 'CONTACT'
      and lh.subject_id = target_contact_id
      and lh.status = 'ACTIVE'
  );
$$;

create or replace function app.create_contact_deletion_item(
  target_batch_id uuid,
  target_contact_id uuid,
  target_retention_due_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  batch_record public.deletion_batches%rowtype;
  contact_record public.contacts%rowtype;
  created_item_id uuid;
  calculated_subject_hash text;
begin
  select * into batch_record from public.deletion_batches
  where id = target_batch_id for update;
  if not found then raise exception 'DELETION_BATCH_NOT_FOUND'; end if;
  if batch_record.status not in ('DRAFT', 'APPROVED') then raise exception 'DELETION_BATCH_NOT_OPEN'; end if;

  select * into contact_record from public.contacts
  where id = target_contact_id and organization_id = batch_record.organization_id;
  if not found then raise exception 'CONTACT_NOT_FOUND_OR_TENANT_MISMATCH'; end if;
  if contact_record.is_deleted then raise exception 'CONTACT_ALREADY_DELETED'; end if;

  calculated_subject_hash := encode(
    digest(batch_record.organization_id::text || ':CONTACT:' || contact_record.id::text, 'sha256'),
    'hex'
  );

  insert into public.deletion_items (
    organization_id, batch_id, subject_id, subject_hash, retention_due_at
  ) values (
    batch_record.organization_id, batch_record.id, contact_record.id, calculated_subject_hash, target_retention_due_at
  ) returning id into created_item_id;

  return created_item_id;
end;
$$;

create or replace function app.assess_contact_deletion(target_item_id uuid)
returns public.deletion_item_status
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  item_record public.deletion_items%rowtype;
  batch_record public.deletion_batches%rowtype;
  active_hold_id uuid;
  next_status public.deletion_item_status;
begin
  select * into item_record from public.deletion_items where id = target_item_id for update;
  if not found then raise exception 'DELETION_ITEM_NOT_FOUND'; end if;

  select * into batch_record from public.deletion_batches
  where id = item_record.batch_id and organization_id = item_record.organization_id for share;
  if not found then raise exception 'DELETION_BATCH_TENANT_MISMATCH'; end if;
  if batch_record.status not in ('APPROVED', 'IN_PROGRESS') then raise exception 'DELETION_BATCH_NOT_APPROVED'; end if;
  if item_record.status not in ('PENDING', 'INELIGIBLE_RETENTION', 'BLOCKED_HOLD') then
    raise exception 'DELETION_ITEM_NOT_ASSESSABLE';
  end if;

  select id into active_hold_id from public.legal_holds
  where organization_id = item_record.organization_id
    and subject_type = item_record.subject_type
    and subject_id = item_record.subject_id
    and status = 'ACTIVE'
  for share;

  if active_hold_id is not null then
    next_status := 'BLOCKED_HOLD';
    update public.deletion_items
    set status = next_status, blocked_hold_id = active_hold_id, evaluated_at = now(), failure_code = null
    where id = item_record.id;
    return next_status;
  end if;

  next_status := case
    when item_record.retention_due_at <= now() then 'ELIGIBLE'::public.deletion_item_status
    else 'INELIGIBLE_RETENTION'::public.deletion_item_status
  end;

  update public.deletion_items
  set status = next_status, blocked_hold_id = null, evaluated_at = now(), failure_code = null
  where id = item_record.id;
  return next_status;
end;
$$;

create or replace function app.execute_contact_deletion(target_item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  item_record public.deletion_items%rowtype;
  batch_record public.deletion_batches%rowtype;
  contact_record public.contacts%rowtype;
  active_hold_id uuid;
  deletion_timestamp timestamptz := clock_timestamp();
  evidence_hash text;
begin
  perform pg_advisory_xact_lock(hashtextextended('retention:' || target_item_id::text, 0));

  select * into item_record from public.deletion_items where id = target_item_id for update;
  if not found then raise exception 'DELETION_ITEM_NOT_FOUND'; end if;
  if item_record.status <> 'ELIGIBLE' then raise exception 'DELETION_ITEM_NOT_ELIGIBLE'; end if;

  perform pg_advisory_xact_lock(
    hashtextextended('legal-hold:' || item_record.organization_id::text || ':' || item_record.subject_id::text, 0)
  );

  select * into batch_record from public.deletion_batches
  where id = item_record.batch_id and organization_id = item_record.organization_id for update;
  if not found then raise exception 'DELETION_BATCH_TENANT_MISMATCH'; end if;
  if batch_record.status not in ('APPROVED', 'IN_PROGRESS') then raise exception 'DELETION_BATCH_NOT_EXECUTABLE'; end if;

  select id into active_hold_id from public.legal_holds
  where organization_id = item_record.organization_id
    and subject_type = item_record.subject_type
    and subject_id = item_record.subject_id
    and status = 'ACTIVE'
  for share;

  if active_hold_id is not null then
    update public.deletion_items
    set status = 'BLOCKED_HOLD', blocked_hold_id = active_hold_id, evaluated_at = now(), failure_code = null
    where id = item_record.id;
    return false;
  end if;

  select * into contact_record from public.contacts
  where id = item_record.subject_id and organization_id = item_record.organization_id
  for update;
  if not found or contact_record.is_deleted then
    update public.deletion_items set status = 'FAILED', failure_code = 'TARGET_NOT_FOUND'
    where id = item_record.id;
    return false;
  end if;

  if batch_record.status = 'APPROVED' then
    update public.deletion_batches
    set status = 'IN_PROGRESS', started_at = deletion_timestamp
    where id = batch_record.id;
  end if;

  update public.provider_events pe
  set payload_json = '{"redacted":true,"reason_code":"RETENTION_DELETION"}'::jsonb
  where pe.organization_id = item_record.organization_id
    and pe.message_id in (
      select m.id from public.messages m
      where m.organization_id = item_record.organization_id and m.contact_id = item_record.subject_id
    );

  update public.event_outbox eo
  set payload_json = jsonb_build_object('redacted', true, 'reason_code', 'RETENTION_DELETION')
  where eo.organization_id = item_record.organization_id
    and eo.aggregate_type = 'message'
    and eo.aggregate_id in (
      select m.id from public.messages m
      where m.organization_id = item_record.organization_id and m.contact_id = item_record.subject_id
    );

  update public.dead_letters dl
  set payload_json = '{"redacted":true,"reason_code":"RETENTION_DELETION"}'::jsonb,
      reason = 'RETENTION_DELETION'
  where dl.organization_id = item_record.organization_id
    and dl.source_table = 'event_outbox'
    and dl.source_id in (
      select eo.id from public.event_outbox eo
      where eo.organization_id = item_record.organization_id
        and eo.aggregate_type = 'message'
        and eo.aggregate_id in (
          select m.id from public.messages m
          where m.organization_id = item_record.organization_id and m.contact_id = item_record.subject_id
        )
    );

  update public.messages
  set normalized_to = null,
      normalized_from = null,
      subject = null,
      body_text = null,
      provider_message_id = null
  where organization_id = item_record.organization_id and contact_id = item_record.subject_id;

  delete from storage.objects so
  using public.prequote_documents pd
  where so.bucket_id = pd.bucket_id
    and so.name = pd.storage_path
    and pd.organization_id = item_record.organization_id
    and pd.prequote_id in (
      select l.prequote_id from public.leads l
      where l.organization_id = item_record.organization_id
        and l.contact_id = item_record.subject_id
        and l.prequote_id is not null
    );

  delete from public.prequote_documents pd
  where pd.organization_id = item_record.organization_id
    and pd.prequote_id in (
      select l.prequote_id from public.leads l
      where l.organization_id = item_record.organization_id
        and l.contact_id = item_record.subject_id
        and l.prequote_id is not null
    );

  update public.prequotes pq
  set contact_name = 'Deleted subject',
      contact_role = 'Deleted',
      normalized_email = 'deleted+' || item_record.subject_hash || '@invalid.local',
      phone_e164 = null
  where pq.organization_id = item_record.organization_id
    and pq.id in (
      select l.prequote_id from public.leads l
      where l.organization_id = item_record.organization_id
        and l.contact_id = item_record.subject_id
        and l.prequote_id is not null
    );

  update public.meetings mt
  set outcome_notes = null
  where mt.organization_id = item_record.organization_id
    and mt.opportunity_id in (
      select o.id from public.opportunities o
      join public.leads l on l.id = o.lead_id and l.organization_id = o.organization_id
      where o.organization_id = item_record.organization_id and l.contact_id = item_record.subject_id
    );

  update public.opportunities o
  set next_action = null,
      loss_reason = null
  where o.organization_id = item_record.organization_id
    and o.lead_id in (
      select l.id from public.leads l
      where l.organization_id = item_record.organization_id and l.contact_id = item_record.subject_id
    );

  update public.leads
  set qualification_reason = null
  where organization_id = item_record.organization_id and contact_id = item_record.subject_id;

  delete from public.source_evidence
  where organization_id = item_record.organization_id
    and lower(subject_type) = 'contact'
    and subject_id = item_record.subject_id;

  delete from public.tasks
  where organization_id = item_record.organization_id and contact_id = item_record.subject_id;

  update public.contacts
  set full_name = 'Deleted subject',
      role_title = 'Deleted',
      normalized_email = 'deleted+' || item_record.subject_hash || '@invalid.local',
      phone_e164 = null,
      verified = false,
      verified_at = null,
      source_confidence = 'UNVERIFIED',
      is_deleted = true
  where id = item_record.subject_id and organization_id = item_record.organization_id;

  evidence_hash := encode(
    digest(item_record.id::text || ':' || item_record.subject_hash || ':' || deletion_timestamp::text, 'sha256'),
    'hex'
  );

  update public.deletion_items
  set status = 'EXECUTED', blocked_hold_id = null, failure_code = null, executed_at = deletion_timestamp
  where id = item_record.id;

  insert into public.deletion_tombstones (
    organization_id, deletion_item_id, subject_type, subject_hash,
    deletion_evidence_sha256, deleted_at, restoration_status
  ) values (
    item_record.organization_id, item_record.id, item_record.subject_type, item_record.subject_hash,
    evidence_hash, deletion_timestamp, 'NOT_POSSIBLE'
  );

  if not exists (
    select 1 from public.deletion_items di
    where di.batch_id = batch_record.id and di.status <> 'EXECUTED'
  ) then
    update public.deletion_batches
    set status = 'COMPLETED', completed_at = clock_timestamp()
    where id = batch_record.id;
  end if;

  insert into public.audit_log (
    organization_id, actor_user_id, action, record_type, record_id, new_data
  ) values (
    item_record.organization_id,
    auth.uid(),
    'RETENTION_ANONYMIZED',
    'contacts',
    item_record.subject_id,
    jsonb_build_object(
      'subject_hash', item_record.subject_hash,
      'deletion_item_id', item_record.id,
      'deleted_at', deletion_timestamp,
      'restore_semantics', 'NO_RAW_DATA_RESTORE_FROM_TOMBSTONE'
    )
  );

  return true;
end;
$$;

alter table public.legal_holds enable row level security;
alter table public.deletion_batches enable row level security;
alter table public.deletion_items enable row level security;
alter table public.deletion_tombstones enable row level security;

drop policy if exists organization_users_member_read on public.organization_users;
drop policy if exists organization_users_self_or_admin_read on public.organization_users;
create policy organization_users_self_or_admin_read on public.organization_users
for select
using (
  user_id = auth.uid()
  or app.has_role(
    organization_id,
    array['ennco_admin'::public.user_role, 'teckel_admin'::public.user_role]
  )
);

create policy legal_holds_privileged_read on public.legal_holds for select
using (app.has_role(organization_id, array['ennco_admin'::public.user_role, 'teckel_admin'::public.user_role, 'auditor_readonly'::public.user_role]));
create policy legal_holds_admin_insert on public.legal_holds for insert
with check (app.has_role(organization_id, array['ennco_admin'::public.user_role, 'teckel_admin'::public.user_role]));
create policy legal_holds_admin_update on public.legal_holds for update
using (app.has_role(organization_id, array['ennco_admin'::public.user_role, 'teckel_admin'::public.user_role]))
with check (app.has_role(organization_id, array['ennco_admin'::public.user_role, 'teckel_admin'::public.user_role]));

create policy deletion_batches_privileged_read on public.deletion_batches for select
using (app.has_role(organization_id, array['ennco_admin'::public.user_role, 'teckel_admin'::public.user_role, 'auditor_readonly'::public.user_role]));
create policy deletion_batches_teckel_insert on public.deletion_batches for insert
with check (app.has_role(organization_id, array['teckel_admin'::public.user_role]));
create policy deletion_batches_admin_update on public.deletion_batches for update
using (app.has_role(organization_id, array['ennco_admin'::public.user_role, 'teckel_admin'::public.user_role]))
with check (app.has_role(organization_id, array['ennco_admin'::public.user_role, 'teckel_admin'::public.user_role]));

create policy deletion_items_privileged_read on public.deletion_items for select
using (app.has_role(organization_id, array['ennco_admin'::public.user_role, 'teckel_admin'::public.user_role, 'auditor_readonly'::public.user_role]));
create policy deletion_tombstones_privileged_read on public.deletion_tombstones for select
using (app.has_role(organization_id, array['ennco_admin'::public.user_role, 'teckel_admin'::public.user_role, 'auditor_readonly'::public.user_role]));

revoke all on function app.retention_audit_snapshot(text, jsonb) from public;
revoke all on function app.capture_retention_audit_event() from public;
revoke all on function app.is_contact_under_legal_hold(uuid, uuid) from public;
revoke all on function app.create_contact_deletion_item(uuid, uuid, timestamptz) from public;
revoke all on function app.assess_contact_deletion(uuid) from public;
revoke all on function app.execute_contact_deletion(uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update on public.legal_holds to authenticated;
    grant select, insert, update on public.deletion_batches to authenticated;
    grant select on public.deletion_items, public.deletion_tombstones to authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on public.legal_holds, public.deletion_batches, public.deletion_items, public.deletion_tombstones to service_role;
    grant execute on function app.is_contact_under_legal_hold(uuid, uuid) to service_role;
    grant execute on function app.create_contact_deletion_item(uuid, uuid, timestamptz) to service_role;
    grant execute on function app.assess_contact_deletion(uuid) to service_role;
    grant execute on function app.execute_contact_deletion(uuid) to service_role;
  end if;
end;
$$;

commit;
