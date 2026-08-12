\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.legal_holds') is null
    or to_regclass('public.deletion_batches') is null
    or to_regclass('public.deletion_items') is null
    or to_regclass('public.deletion_tombstones') is null
  then raise exception 'ROLLBACK_DESTROYED_RETENTION_JOURNAL'; end if;
  if not exists(select 1 from public.deletion_tombstones where subject_hash ~ '^[a-f0-9]{64}$'
    and deletion_evidence_sha256 ~ '^[a-f0-9]{64}$')
  then raise exception 'ROLLBACK_DESTROYED_TOMBSTONE_EVIDENCE'; end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.deletion_tombstones'::regclass
    and tgname='deletion_tombstones_m003_rollback_fail_closed' and not tgisinternal)
  then raise exception 'ROLLBACK_FAIL_CLOSED_GUARD_MISSING'; end if;
  if not (select is_deleted from public.contacts where id='32111111-1111-4111-8111-111111111111')
  then raise exception 'ROLLBACK_RESTORED_ANONYMIZED_CONTACT'; end if;
  if exists(select 1 from public.messages where contact_id='32111111-1111-4111-8111-111111111111'
    and num_nonnulls(normalized_to,normalized_from,subject,body_text,provider_message_id)>0)
  then raise exception 'ROLLBACK_RESTORED_MESSAGE_CONTENT'; end if;
end $$;

set request.jwt.claim.sub='82111111-1111-4111-8111-111111111111';
set role authenticated;
do $$ begin
  begin
    update public.deletion_batches set status='FAILED' where id='61111111-1111-4111-8111-111111111111';
    raise exception 'EXPECTED_RETENTION_ROLLBACK_HOLD';
  exception when others then
    if sqlerrm not in ('M003_RETENTION_CONTROL_UNAVAILABLE','permission denied for table deletion_batches')
    then raise; end if;
  end;
  begin
    perform app.execute_contact_deletion((select id from public.deletion_items limit 1));
    raise exception 'EXPECTED_RETENTION_EXECUTOR_REVOKED';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
reset request.jwt.claim.sub;

\echo 'RETENTION_DELETION_ROLLBACK_PASS'
