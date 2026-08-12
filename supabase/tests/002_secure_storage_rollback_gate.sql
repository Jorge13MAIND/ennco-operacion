\set ON_ERROR_STOP on

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'prequote_documents' and column_name = 'quarantine_status'
  ) then raise exception 'ROLLBACK_LEFT_QUARANTINE_COLUMN'; end if;

  if exists (
    select 1 from pg_type where typname = 'document_quarantine_status'
  ) then raise exception 'ROLLBACK_LEFT_QUARANTINE_TYPE'; end if;

  if exists (
    select 1 from storage.buckets where id = 'ennco-sensitive-documents'
  ) then raise exception 'ROLLBACK_LEFT_EMPTY_BUCKET'; end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.prequote_documents'::regclass
      and conname = 'prequote_documents_prequote_id_fkey'
  ) then raise exception 'ROLLBACK_DID_NOT_RESTORE_ORIGINAL_FK'; end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'prequote_documents'
      and policyname = 'prequote_documents_member_read'
  ) then raise exception 'ROLLBACK_DID_NOT_RESTORE_READ_POLICY'; end if;
end;
$$;

\echo 'SECURE_STORAGE_ROLLBACK_PASS'
