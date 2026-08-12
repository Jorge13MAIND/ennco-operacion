begin;

create or replace function app.current_request_aal()
returns text
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  claim_aal text;
  claims_text text;
begin
  claim_aal := nullif(current_setting('request.jwt.claim.aal', true), '');
  if claim_aal is not null then return claim_aal; end if;

  claims_text := nullif(current_setting('request.jwt.claims', true), '');
  if claims_text is null then return null; end if;
  return claims_text::jsonb ->> 'aal';
exception
  when others then return null;
end;
$$;

create or replace function app.is_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select app.current_request_aal() = 'aal2'
    and exists (
      select 1
      from public.organization_users ou
      where ou.organization_id = target_organization_id
        and ou.user_id = auth.uid()
        and ou.active
    );
$$;

create or replace function app.has_role(target_organization_id uuid, allowed_roles public.user_role[])
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select app.current_request_aal() = 'aal2'
    and exists (
      select 1
      from public.organization_users ou
      where ou.organization_id = target_organization_id
        and ou.user_id = auth.uid()
        and ou.active
        and ou.role = any(allowed_roles)
    );
$$;

drop policy if exists event_outbox_technical_write on public.event_outbox;
revoke insert, update, delete, truncate on public.event_outbox from authenticated;

create unique index if not exists leads_organization_id_id_unique
on public.leads (organization_id, id);

alter table public.leads
  drop constraint if exists leads_account_id_fkey,
  drop constraint if exists leads_contact_id_fkey,
  drop constraint if exists leads_prequote_id_fkey,
  drop constraint if exists leads_account_tenant_fkey,
  drop constraint if exists leads_contact_tenant_fkey,
  drop constraint if exists leads_prequote_tenant_fkey;

alter table public.leads
  add constraint leads_account_tenant_fkey
    foreign key (organization_id, account_id)
    references public.accounts (organization_id, id),
  add constraint leads_contact_tenant_fkey
    foreign key (organization_id, contact_id)
    references public.contacts (organization_id, id),
  add constraint leads_prequote_tenant_fkey
    foreign key (organization_id, prequote_id)
    references public.prequotes (organization_id, id);

create or replace function app.enforce_lead_reference_integrity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.contact_id is not null and new.account_id is not null and not exists (
    select 1
    from public.contacts c
    where c.organization_id = new.organization_id
      and c.id = new.contact_id
      and c.account_id = new.account_id
  ) then
    raise exception 'TENANT_REFERENCE_MISMATCH:leads.contact_account';
  end if;
  return new;
end;
$$;

drop trigger if exists leads_reference_integrity on public.leads;
create trigger leads_reference_integrity
before insert or update of organization_id, account_id, contact_id, prequote_id
on public.leads
for each row execute function app.enforce_lead_reference_integrity();

alter table public.deletion_batches
  add column if not exists approved_item_count integer,
  add column if not exists approved_items_sha256 text;

alter table public.deletion_batches
  drop constraint if exists deletion_batches_approved_item_snapshot_check;

alter table public.deletion_batches
  add constraint deletion_batches_approved_item_snapshot_check check (
    (
      status = 'DRAFT'
      and approved_item_count is null
      and approved_items_sha256 is null
    )
    or (
      status <> 'DRAFT'
      and approved_item_count is not null
      and approved_item_count > 0
      and approved_items_sha256 ~ '^[a-f0-9]{64}$'
    )
  );

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

  if old.status <> 'DRAFT' and (
    new.approved_item_count is distinct from old.approved_item_count
    or new.approved_items_sha256 is distinct from old.approved_items_sha256
  ) then raise exception 'DELETION_BATCH_APPROVED_ITEMS_IMMUTABLE'; end if;

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
  item_count integer;
  item_manifest text;
begin
  if tg_op = 'INSERT' then
    if actor_id is null then raise exception 'AUTHENTICATED_ACTOR_REQUIRED'; end if;
    if new.status <> 'DRAFT' then raise exception 'DELETION_BATCH_MUST_START_DRAFT'; end if;
    if new.requested_by is distinct from actor_id then raise exception 'DELETION_BATCH_REQUESTED_BY_MISMATCH'; end if;
    if new.approved_item_count is not null or new.approved_items_sha256 is not null then
      raise exception 'DELETION_BATCH_APPROVAL_SNAPSHOT_FORBIDDEN_IN_DRAFT';
    end if;
  elsif old.status = 'DRAFT' and new.status in ('APPROVED', 'CANCELLED') then
    if actor_id is null then raise exception 'AUTHENTICATED_ACTOR_REQUIRED'; end if;
    if new.approved_by is distinct from actor_id then raise exception 'DELETION_BATCH_APPROVED_BY_MISMATCH'; end if;
    if new.approved_by = old.requested_by then raise exception 'DELETION_BATCH_FOUR_EYES_REQUIRED'; end if;

    select count(*), encode(digest(
      coalesce(string_agg(
        di.subject_hash || ':' || extract(epoch from di.retention_due_at)::numeric(20,6)::text,
        E'\n' order by di.subject_hash, di.retention_due_at, di.id
      ), ''),
      'sha256'
    ), 'hex')
    into item_count, item_manifest
    from public.deletion_items di
    where di.organization_id = new.organization_id
      and di.batch_id = new.id;

    if item_count < 1 then raise exception 'DELETION_BATCH_ITEMS_REQUIRED_BEFORE_APPROVAL'; end if;
    new.approved_item_count := item_count;
    new.approved_items_sha256 := item_manifest;
  elsif new.status is distinct from old.status then
    if current_user <> 'service_role'
      and not pg_has_role(current_user, 'pg_database_owner', 'USAGE')
    then raise exception 'DELETION_BATCH_TECHNICAL_TRANSITION_REQUIRES_SERVICE_ROLE'; end if;
  end if;
  return new;
end;
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
  if batch_record.status <> 'DRAFT' then raise exception 'DELETION_BATCH_NOT_DRAFT'; end if;

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
    batch_record.organization_id, batch_record.id, contact_record.id,
    calculated_subject_hash, target_retention_due_at
  ) returning id into created_item_id;

  return created_item_id;
end;
$$;

create or replace function app.enforce_deletion_item_batch_membership()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  batch_status public.deletion_batch_status;
  expected_subject_hash text;
  target_batch_id uuid;
  target_organization_id uuid;
begin
  if tg_op = 'DELETE' then
    target_batch_id := old.batch_id;
    target_organization_id := old.organization_id;
  else
    target_batch_id := new.batch_id;
    target_organization_id := new.organization_id;
  end if;

  select db.status into batch_status
  from public.deletion_batches db
  where db.id = target_batch_id
    and db.organization_id = target_organization_id
  for share;

  if not found then raise exception 'DELETION_BATCH_NOT_FOUND_OR_TENANT_MISMATCH'; end if;
  if batch_status <> 'DRAFT' then raise exception 'DELETION_BATCH_ITEMS_FROZEN'; end if;

  if tg_op = 'DELETE' then return old; end if;

  expected_subject_hash := encode(
    digest(new.organization_id::text || ':CONTACT:' || new.subject_id::text, 'sha256'),
    'hex'
  );
  if new.subject_hash is distinct from expected_subject_hash then
    raise exception 'DELETION_ITEM_SUBJECT_HASH_MISMATCH';
  end if;
  if new.status <> 'PENDING'
    or new.evaluated_at is not null
    or new.blocked_hold_id is not null
    or new.failure_code is not null
    or new.executed_at is not null
  then raise exception 'DELETION_ITEM_MUST_START_PENDING'; end if;
  return new;
end;
$$;

drop trigger if exists deletion_items_batch_membership on public.deletion_items;
create trigger deletion_items_batch_membership
before insert or delete on public.deletion_items
for each row execute function app.enforce_deletion_item_batch_membership();

revoke all on function app.current_request_aal() from public;
revoke all on function app.enforce_lead_reference_integrity() from public;
revoke all on function app.enforce_deletion_item_batch_membership() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function app.current_request_aal() to authenticated;
    revoke insert, update, delete, truncate on public.event_outbox from authenticated;
  end if;
end;
$$;

commit;
