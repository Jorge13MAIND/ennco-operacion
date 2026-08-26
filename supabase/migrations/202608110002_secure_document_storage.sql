begin;

create type public.document_quarantine_status as enum ('PENDING', 'CLEAN', 'REJECTED', 'ERROR');

create or replace function app.redact_audit_snapshot(
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
    when target_record_type = 'messages' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'enrollment_id', snapshot -> 'enrollment_id',
      'mailbox_id', snapshot -> 'mailbox_id',
      'contact_id', snapshot -> 'contact_id',
      'direction', snapshot -> 'direction',
      'status', snapshot -> 'status',
      'touch_number', snapshot -> 'touch_number',
      'correlation_id', snapshot -> 'correlation_id',
      'sent_at', snapshot -> 'sent_at',
      'created_at', snapshot -> 'created_at',
      'updated_at', snapshot -> 'updated_at'
    ))
    when target_record_type = 'suppression_entries' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'kind', snapshot -> 'kind',
      'account_id', snapshot -> 'account_id',
      'source_batch_id', snapshot -> 'source_batch_id',
      'effective_at', snapshot -> 'effective_at',
      'expires_at', snapshot -> 'expires_at',
      'created_at', snapshot -> 'created_at'
    ))
    when target_record_type = 'event_outbox' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'aggregate_type', snapshot -> 'aggregate_type',
      'aggregate_id', snapshot -> 'aggregate_id',
      'event_type', snapshot -> 'event_type',
      'status', snapshot -> 'status',
      'attempt_count', snapshot -> 'attempt_count',
      'next_attempt_at', snapshot -> 'next_attempt_at',
      'locked_at', snapshot -> 'locked_at',
      'created_at', snapshot -> 'created_at',
      'delivered_at', snapshot -> 'delivered_at'
    ))
    when target_record_type = 'campaigns' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'status', snapshot -> 'status',
      'manifest_sha256', snapshot -> 'manifest_sha256',
      'suppression_snapshot_at', snapshot -> 'suppression_snapshot_at',
      'shadow_canary_decision', snapshot -> 'shadow_canary_decision',
      'approved_by', snapshot -> 'approved_by',
      'approved_at', snapshot -> 'approved_at',
      'created_at', snapshot -> 'created_at',
      'updated_at', snapshot -> 'updated_at'
    ))
    when target_record_type = 'runtime_controls' then jsonb_strip_nulls(jsonb_build_object(
      'organization_id', snapshot -> 'organization_id',
      'global_kill_switch', snapshot -> 'global_kill_switch',
      'external_send_allowed', snapshot -> 'external_send_allowed',
      'updated_by', snapshot -> 'updated_by',
      'updated_at', snapshot -> 'updated_at'
    ))
    when target_record_type = 'campaign_enrollments' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'campaign_id', snapshot -> 'campaign_id',
      'sequence_version_id', snapshot -> 'sequence_version_id',
      'account_id', snapshot -> 'account_id',
      'contact_id', snapshot -> 'contact_id',
      'mailbox_id', snapshot -> 'mailbox_id',
      'status', snapshot -> 'status',
      'next_touch_number', snapshot -> 'next_touch_number',
      'next_touch_at', snapshot -> 'next_touch_at',
      'created_at', snapshot -> 'created_at',
      'updated_at', snapshot -> 'updated_at'
    ))
    when target_record_type = 'leads' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'account_id', snapshot -> 'account_id',
      'contact_id', snapshot -> 'contact_id',
      'prequote_id', snapshot -> 'prequote_id',
      'status', snapshot -> 'status',
      'contractual_qualified', snapshot -> 'contractual_qualified',
      'evidence_class', snapshot -> 'evidence_class',
      'created_at', snapshot -> 'created_at',
      'updated_at', snapshot -> 'updated_at'
    ))
    when target_record_type = 'opportunities' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'account_id', snapshot -> 'account_id',
      'lead_id', snapshot -> 'lead_id',
      'stage', snapshot -> 'stage',
      'economic_buyer', snapshot -> 'economic_buyer',
      'active_pain', snapshot -> 'active_pain',
      'business_impact', snapshot -> 'business_impact',
      'timing_under_90_days', snapshot -> 'timing_under_90_days',
      'value_mxn', snapshot -> 'value_mxn',
      'next_action_at', snapshot -> 'next_action_at',
      'created_at', snapshot -> 'created_at',
      'updated_at', snapshot -> 'updated_at'
    ))
    when target_record_type = 'approvals' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'subject_type', snapshot -> 'subject_type',
      'subject_id', snapshot -> 'subject_id',
      'subject_sha256', snapshot -> 'subject_sha256',
      'decision', snapshot -> 'decision',
      'decided_by', snapshot -> 'decided_by',
      'decided_at', snapshot -> 'decided_at'
    ))
    when target_record_type = 'incidents' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'severity', snapshot -> 'severity',
      'status', snapshot -> 'status',
      'correlation_id', snapshot -> 'correlation_id',
      'opened_at', snapshot -> 'opened_at',
      'acknowledged_at', snapshot -> 'acknowledged_at',
      'resolved_at', snapshot -> 'resolved_at',
      'owner_user_id', snapshot -> 'owner_user_id'
    ))
    when target_record_type = 'prequote_documents' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'prequote_id', snapshot -> 'prequote_id',
      'bucket_id', snapshot -> 'bucket_id',
      'media_type', snapshot -> 'media_type',
      'sha256', snapshot -> 'sha256',
      'size_bytes', snapshot -> 'size_bytes',
      'retention_until', snapshot -> 'retention_until',
      'quarantine_status', snapshot -> 'quarantine_status',
      'scanned_at', snapshot -> 'scanned_at',
      'scan_engine', snapshot -> 'scan_engine',
      'released_at', snapshot -> 'released_at',
      'created_at', snapshot -> 'created_at'
    ))
    else jsonb_build_object('redaction', 'NO_ALLOWLIST_FOR_RECORD_TYPE')
  end;
$$;

create or replace function app.capture_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  raw_data jsonb;
  org_id uuid;
  row_id uuid;
  correlation_id_value uuid;
begin
  raw_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  org_id := nullif(raw_data ->> 'organization_id', '')::uuid;
  row_id := nullif(raw_data ->> 'id', '')::uuid;
  correlation_id_value := nullif(raw_data ->> 'correlation_id', '')::uuid;

  insert into public.audit_log (
    organization_id, actor_user_id, action, record_type, record_id, correlation_id, old_data, new_data
  ) values (
    org_id,
    auth.uid(),
    tg_op,
    tg_table_name,
    row_id,
    correlation_id_value,
    case when tg_op in ('UPDATE', 'DELETE') then app.redact_audit_snapshot(tg_table_name, to_jsonb(old)) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then app.redact_audit_snapshot(tg_table_name, to_jsonb(new)) else null end
  );
  return coalesce(new, old);
end;
$$;

drop trigger prevent_audit_update_delete on public.audit_log;

update public.audit_log
set old_data = app.redact_audit_snapshot(record_type, old_data),
    new_data = app.redact_audit_snapshot(record_type, new_data);

create trigger prevent_audit_update_delete
before update or delete on public.audit_log
for each row execute function app.prevent_audit_mutation();

create or replace function app.is_valid_sensitive_document_path(
  target_organization_id uuid,
  target_prequote_id uuid,
  target_storage_path text
)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select target_storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/prequotes/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$'
    and split_part(target_storage_path, '/', 1) = target_organization_id::text
    and split_part(target_storage_path, '/', 2) = 'prequotes'
    and split_part(target_storage_path, '/', 3) = target_prequote_id::text
    and array_length(string_to_array(target_storage_path, '/'), 1) = 4;
$$;

create or replace function app.sensitive_document_org_id(target_storage_path text)
returns uuid
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
begin
  if target_storage_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/prequotes/' then
    return null;
  end if;
  return split_part(target_storage_path, '/', 1)::uuid;
exception
  when invalid_text_representation then return null;
end;
$$;

create or replace function app.document_media_type_matches_path(
  target_storage_path text,
  target_media_type text
)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select case target_media_type
    when 'application/pdf' then target_storage_path ~ '\.pdf$'
    when 'image/jpeg' then target_storage_path ~ '\.(jpg|jpeg)$'
    when 'image/png' then target_storage_path ~ '\.png$'
    else false
  end;
$$;

create unique index prequotes_organization_id_id_unique
on public.prequotes (organization_id, id);

alter table public.prequote_documents
  drop constraint prequote_documents_prequote_id_fkey,
  add column bucket_id text not null default 'ennco-sensitive-documents',
  add column quarantine_status public.document_quarantine_status not null default 'PENDING',
  add column scanned_at timestamptz,
  add column scan_engine text,
  add column scan_result_json jsonb,
  add column released_at timestamptz,
  add constraint prequote_documents_prequote_tenant_fkey
    foreign key (organization_id, prequote_id)
    references public.prequotes (organization_id, id)
    on delete cascade,
  add constraint prequote_documents_private_bucket_check
    check (bucket_id = 'ennco-sensitive-documents'),
  add constraint prequote_documents_path_check
    check (app.is_valid_sensitive_document_path(organization_id, prequote_id, storage_path)),
  add constraint prequote_documents_media_path_check
    check (app.document_media_type_matches_path(storage_path, media_type)),
  add constraint prequote_documents_retention_check
    check (retention_until > created_at),
  add constraint prequote_documents_quarantine_check
    check (
      (
        quarantine_status = 'PENDING'
        and scanned_at is null
        and scan_engine is null
        and scan_result_json is null
        and released_at is null
      )
      or (
        quarantine_status = 'CLEAN'
        and scanned_at is not null
        and nullif(btrim(scan_engine), '') is not null
        and scan_result_json @> '{"malware": false, "checksum_verified": true}'::jsonb
        and released_at is not null
      )
      or (
        quarantine_status in ('REJECTED', 'ERROR')
        and scanned_at is not null
        and nullif(btrim(scan_engine), '') is not null
        and scan_result_json is not null
        and released_at is null
      )
    );

create unique index prequote_documents_bucket_path_unique
on public.prequote_documents (bucket_id, storage_path);

create or replace function app.enforce_document_quarantine_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.quarantine_status is distinct from old.quarantine_status
    or new.scanned_at is distinct from old.scanned_at
    or new.scan_engine is distinct from old.scan_engine
    or new.scan_result_json is distinct from old.scan_result_json
    or new.released_at is distinct from old.released_at
  then
    if current_user not in ('service_role', 'supabase_admin')
      and not pg_has_role(current_user, 'pg_database_owner', 'USAGE')
    then
      raise exception 'QUARANTINE_TRANSITION_REQUIRES_SERVICE_ROLE';
    end if;
  end if;
  return new;
end;
$$;

create trigger prequote_documents_quarantine_transition
before update of quarantine_status, scanned_at, scan_engine, scan_result_json, released_at
on public.prequote_documents
for each row execute function app.enforce_document_quarantine_transition();

create or replace function app.enforce_document_identity_immutability()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.prequote_id is distinct from old.prequote_id
    or new.bucket_id is distinct from old.bucket_id
    or new.storage_path is distinct from old.storage_path
    or new.media_type is distinct from old.media_type
    or new.sha256 is distinct from old.sha256
    or new.size_bytes is distinct from old.size_bytes
  then
    raise exception 'DOCUMENT_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger prequote_documents_identity_immutable
before update of organization_id, prequote_id, bucket_id, storage_path, media_type, sha256, size_bytes
on public.prequote_documents
for each row execute function app.enforce_document_identity_immutability();

create trigger prequote_documents_audit
after insert or update or delete on public.prequote_documents
for each row execute function app.capture_audit_event();

drop policy if exists prequote_documents_member_read on public.prequote_documents;
drop policy if exists prequote_documents_operator_write on public.prequote_documents;

create policy prequote_documents_explicit_read
on public.prequote_documents
for select
using (
  app.has_role(
    organization_id,
    array[
      'ennco_admin'::public.user_role,
      'ennco_operator'::public.user_role,
      'teckel_admin'::public.user_role,
      'teckel_operator'::public.user_role
    ]
  )
  and (
    quarantine_status = 'CLEAN'
    or app.has_role(
      organization_id,
      array['teckel_admin'::public.user_role, 'teckel_operator'::public.user_role]
    )
  )
);

create policy prequote_documents_explicit_insert
on public.prequote_documents
for insert
with check (
  quarantine_status = 'PENDING'
  and app.has_role(
    organization_id,
    array[
      'ennco_admin'::public.user_role,
      'ennco_operator'::public.user_role,
      'teckel_admin'::public.user_role,
      'teckel_operator'::public.user_role
    ]
  )
);

create policy prequote_documents_admin_update
on public.prequote_documents
for update
using (app.has_role(organization_id, array['ennco_admin'::public.user_role, 'teckel_admin'::public.user_role]))
with check (app.has_role(organization_id, array['ennco_admin'::public.user_role, 'teckel_admin'::public.user_role]));

create policy prequote_documents_admin_delete
on public.prequote_documents
for delete
using (app.has_role(organization_id, array['ennco_admin'::public.user_role, 'teckel_admin'::public.user_role]));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ennco-sensitive-documents',
  'ennco-sensitive-documents',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function app.protect_sensitive_document_bucket()
returns trigger
language plpgsql
set search_path = storage, pg_temp
as $$
begin
  if tg_op = 'DELETE' and old.id = 'ennco-sensitive-documents' then
    raise exception 'SENSITIVE_BUCKET_DELETE_BLOCKED';
  end if;

  if tg_op = 'UPDATE' and old.id = 'ennco-sensitive-documents' then
    if new.id is distinct from old.id
      or new.name is distinct from 'ennco-sensitive-documents'
      or new.public is distinct from false
      or new.file_size_limit is null
      or new.file_size_limit > 10485760
      or new.allowed_mime_types is null
      or coalesce(array_length(new.allowed_mime_types, 1), 0) = 0
      or not (new.allowed_mime_types <@ array['application/pdf', 'image/jpeg', 'image/png']::text[])
    then
      raise exception 'SENSITIVE_BUCKET_SECURITY_DOWNGRADE_BLOCKED';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger protect_sensitive_document_bucket
before update or delete on storage.buckets
for each row execute function app.protect_sensitive_document_bucket();

create or replace function app.enforce_sensitive_storage_object_link()
returns trigger
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
    and old.bucket_id = 'ennco-sensitive-documents'
    and (
      new.bucket_id is distinct from old.bucket_id
      or new.name is distinct from old.name
    )
  then
    raise exception 'SENSITIVE_OBJECT_IDENTITY_IMMUTABLE';
  end if;

  if new.bucket_id = 'ennco-sensitive-documents' and not exists (
    select 1
    from public.prequote_documents pd
    where pd.bucket_id = new.bucket_id
      and pd.storage_path = new.name
      and pd.organization_id = app.sensitive_document_org_id(new.name)
  ) then
    raise exception 'DOCUMENT_METADATA_REQUIRED';
  end if;
  return new;
end;
$$;

create trigger enforce_sensitive_storage_object_link
before insert or update of bucket_id, name on storage.objects
for each row execute function app.enforce_sensitive_storage_object_link();

create or replace function app.can_insert_sensitive_storage_object(target_storage_path text)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select app.has_role(
    app.sensitive_document_org_id(target_storage_path),
    array[
      'ennco_admin'::public.user_role,
      'ennco_operator'::public.user_role,
      'teckel_admin'::public.user_role,
      'teckel_operator'::public.user_role
    ]
  ) and exists (
    select 1
    from public.prequote_documents pd
    where pd.bucket_id = 'ennco-sensitive-documents'
      and pd.storage_path = target_storage_path
      and pd.organization_id = app.sensitive_document_org_id(target_storage_path)
      and pd.quarantine_status = 'PENDING'
  );
$$;

create or replace function app.can_read_sensitive_storage_object(target_storage_path text)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select app.has_role(
    app.sensitive_document_org_id(target_storage_path),
    array[
      'ennco_admin'::public.user_role,
      'ennco_operator'::public.user_role,
      'teckel_admin'::public.user_role,
      'teckel_operator'::public.user_role
    ]
  ) and exists (
    select 1
    from public.prequote_documents pd
    where pd.bucket_id = 'ennco-sensitive-documents'
      and pd.storage_path = target_storage_path
      and pd.organization_id = app.sensitive_document_org_id(target_storage_path)
      and pd.quarantine_status = 'CLEAN'
  );
$$;

do $$
declare
  storage_rls_enabled boolean;
  storage_table_owner name;
begin
  select c.relrowsecurity, r.rolname
  into storage_rls_enabled, storage_table_owner
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_roles r on r.oid = c.relowner
  where n.nspname = 'storage'
    and c.relname = 'objects';

  if storage_rls_enabled is null then
    raise exception 'MANAGED_STORAGE_OBJECTS_TABLE_REQUIRED';
  end if;

  if pg_has_role(current_user, storage_table_owner, 'USAGE') then
    alter table storage.objects enable row level security;
  elsif not storage_rls_enabled then
    raise exception 'MANAGED_STORAGE_RLS_REQUIRED';
  end if;
end;
$$;

drop policy if exists ennco_sensitive_documents_read on storage.objects;
drop policy if exists ennco_sensitive_documents_insert on storage.objects;
drop policy if exists ennco_sensitive_documents_update on storage.objects;
drop policy if exists ennco_sensitive_documents_delete on storage.objects;

create policy ennco_sensitive_documents_read
on storage.objects
for select
using (
  bucket_id = 'ennco-sensitive-documents'
  and app.can_read_sensitive_storage_object(name)
);

create policy ennco_sensitive_documents_insert
on storage.objects
for insert
with check (
  bucket_id = 'ennco-sensitive-documents'
  and app.can_insert_sensitive_storage_object(name)
);

create policy ennco_sensitive_documents_update
on storage.objects
for update
using (
  bucket_id = 'ennco-sensitive-documents'
  and app.has_role(
    app.sensitive_document_org_id(name),
    array['ennco_admin'::public.user_role, 'teckel_admin'::public.user_role]
  )
)
with check (
  bucket_id = 'ennco-sensitive-documents'
  and app.has_role(
    app.sensitive_document_org_id(name),
    array['ennco_admin'::public.user_role, 'teckel_admin'::public.user_role]
  )
);

create policy ennco_sensitive_documents_delete
on storage.objects
for delete
using (
  bucket_id = 'ennco-sensitive-documents'
  and app.has_role(
    app.sensitive_document_org_id(name),
    array['ennco_admin'::public.user_role, 'teckel_admin'::public.user_role]
  )
);

revoke all on function app.sensitive_document_org_id(text) from public;
revoke all on function app.is_valid_sensitive_document_path(uuid, uuid, text) from public;
revoke all on function app.document_media_type_matches_path(text, text) from public;
revoke all on function app.redact_audit_snapshot(text, jsonb) from public;
revoke all on function app.capture_audit_event() from public;
revoke all on function app.can_insert_sensitive_storage_object(text) from public;
revoke all on function app.can_read_sensitive_storage_object(text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function app.sensitive_document_org_id(text) to authenticated;
    grant execute on function app.is_valid_sensitive_document_path(uuid, uuid, text) to authenticated;
    grant execute on function app.document_media_type_matches_path(text, text) to authenticated;
    grant execute on function app.can_insert_sensitive_storage_object(text) to authenticated;
    grant execute on function app.can_read_sensitive_storage_object(text) to authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function app.sensitive_document_org_id(text) to service_role;
    grant execute on function app.is_valid_sensitive_document_path(uuid, uuid, text) to service_role;
    grant execute on function app.document_media_type_matches_path(text, text) to service_role;
    grant select on public.prequote_documents to service_role;
    grant update (quarantine_status, scanned_at, scan_engine, scan_result_json, released_at, retention_until)
      on public.prequote_documents to service_role;
  end if;
end;
$$;

commit;
