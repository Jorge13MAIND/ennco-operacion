begin;

drop policy if exists ennco_sensitive_documents_read on storage.objects;
drop policy if exists ennco_sensitive_documents_insert on storage.objects;
drop policy if exists ennco_sensitive_documents_update on storage.objects;
drop policy if exists ennco_sensitive_documents_delete on storage.objects;

drop trigger if exists enforce_sensitive_storage_object_link on storage.objects;
drop trigger if exists protect_sensitive_document_bucket on storage.buckets;
drop trigger if exists prequote_documents_quarantine_transition on public.prequote_documents;
drop trigger if exists prequote_documents_identity_immutable on public.prequote_documents;
drop trigger if exists prequote_documents_audit on public.prequote_documents;

drop function if exists app.enforce_sensitive_storage_object_link();
drop function if exists app.can_insert_sensitive_storage_object(text);
drop function if exists app.can_read_sensitive_storage_object(text);
drop function if exists app.protect_sensitive_document_bucket();
drop function if exists app.enforce_document_quarantine_transition();
drop function if exists app.enforce_document_identity_immutability();

drop policy if exists prequote_documents_explicit_read on public.prequote_documents;
drop policy if exists prequote_documents_explicit_insert on public.prequote_documents;
drop policy if exists prequote_documents_admin_update on public.prequote_documents;
drop policy if exists prequote_documents_admin_delete on public.prequote_documents;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke update (quarantine_status, scanned_at, scan_engine, scan_result_json, released_at, retention_until)
      on public.prequote_documents from service_role;
    revoke select on public.prequote_documents from service_role;
  end if;
end;
$$;

alter table public.prequote_documents
  drop constraint if exists prequote_documents_prequote_tenant_fkey,
  drop constraint if exists prequote_documents_private_bucket_check,
  drop constraint if exists prequote_documents_path_check,
  drop constraint if exists prequote_documents_media_path_check,
  drop constraint if exists prequote_documents_retention_check,
  drop constraint if exists prequote_documents_quarantine_check;

drop index if exists public.prequote_documents_bucket_path_unique;

alter table public.prequote_documents
  drop column if exists bucket_id,
  drop column if exists quarantine_status,
  drop column if exists scanned_at,
  drop column if exists scan_engine,
  drop column if exists scan_result_json,
  drop column if exists released_at,
  add constraint prequote_documents_prequote_id_fkey
    foreign key (prequote_id) references public.prequotes(id) on delete cascade;

drop index if exists public.prequotes_organization_id_id_unique;

create policy prequote_documents_member_read
on public.prequote_documents
for select
using (app.is_member(organization_id));

create policy prequote_documents_operator_write
on public.prequote_documents
for all
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
)
with check (
  app.has_role(
    organization_id,
    array[
      'ennco_admin'::public.user_role,
      'ennco_operator'::public.user_role,
      'teckel_admin'::public.user_role,
      'teckel_operator'::public.user_role
    ]
  )
);

delete from storage.buckets b
where b.id = 'ennco-sensitive-documents'
  and not exists (
    select 1 from storage.objects o where o.bucket_id = b.id
  );

drop function if exists app.document_media_type_matches_path(text, text);
drop function if exists app.sensitive_document_org_id(text);
drop function if exists app.is_valid_sensitive_document_path(uuid, uuid, text);
drop type if exists public.document_quarantine_status;

-- Audit snapshots already sanitized by the forward migration remain redacted.
-- Restoring the former full-row audit serializer would reintroduce PII leakage.

commit;
