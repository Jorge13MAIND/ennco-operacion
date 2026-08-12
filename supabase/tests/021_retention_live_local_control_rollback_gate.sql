\set ON_ERROR_STOP on

do $$ begin
  if to_regclass('public.retention_policy_versions') is null
    or to_regclass('public.retention_reconciliation_runs') is null
    or to_regclass('public.retention_provider_propagations') is null
    or to_regclass('public.retention_restore_reconciliation_runs') is null
    or to_regclass('public.legal_holds') is null
    or to_regclass('public.deletion_batches') is null
    or to_regclass('public.deletion_items') is null
    or to_regclass('public.deletion_tombstones') is null
  then raise exception 'M021_ROLLBACK_DESTROYED_EVIDENCE'; end if;
  if not exists(select 1 from public.deletion_tombstones where organization_id='32100000-0000-4000-8000-000000000001'
    and subject_hash=encode(digest('32100000-0000-4000-8000-000000000001:CONTACT:32130000-0000-4000-8000-000000000001','sha256'),'hex')
    and deletion_evidence_sha256 ~ '^[a-f0-9]{64}$')
  then raise exception 'M021_ROLLBACK_TOMBSTONE_CHECKSUM_CHANGED'; end if;
  if not exists(
    select 1 from public.m021_gate_preservation_snapshot s
    where s.tombstone_count=(select count(*) from public.deletion_tombstones where organization_id='32100000-0000-4000-8000-000000000001')
      and s.tombstone_checksum=(select encode(digest(coalesce(string_agg(id::text||':'||subject_hash||':'||deletion_evidence_sha256||':'||deleted_at::text,E'\n' order by id),''),'sha256'),'hex') from public.deletion_tombstones where organization_id='32100000-0000-4000-8000-000000000001')
      and s.reconciliation_watermark=(select max(heartbeat_at) from public.retention_reconciliation_runs where organization_id='32100000-0000-4000-8000-000000000001')
  ) then raise exception 'M021_ROLLBACK_JOURNAL_OR_WATERMARK_CHANGED'; end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.deletion_tombstones'::regclass
    and tgname='deletion_tombstones_m021_rollback_fail_closed' and not tgisinternal)
  then raise exception 'M021_ROLLBACK_GUARD_MISSING'; end if;
  if pg_get_constraintdef((select oid from pg_constraint where conrelid='public.qualification_evidence_links'::regclass and conname='qualification_evidence_source_tenant_fkey')) ilike '%ON DELETE CASCADE%'
    or pg_get_functiondef('app.enforce_research_rpc_write()'::regprocedure) like '%retention_internal_executor%'
    or not exists(select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
      where t.tgrelid='public.qualification_evidence_links'::regclass and t.tgname='qualification_evidence_links_append_only'
        and p.proname='prevent_commercial_integrity_mutation' and not t.tgisinternal)
  then raise exception 'M021_ROLLBACK_PRE_M021_GUARDS_NOT_RESTORED'; end if;
end $$;

set request.jwt.claim.sub='32110000-0000-4000-8000-000000000003';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ declare h jsonb; begin
  h:=public.evaluate_retention_health('32100000-0000-4000-8000-000000000001');
  if h->>'state'<>'UNKNOWN' or h->>'reason_code'<>'M021_RETENTION_CONTROL_UNAVAILABLE'
  then raise exception 'M021_ROLLBACK_NOT_FAIL_CLOSED'; end if;
  begin update public.deletion_batches set status='FAILED' where organization_id='32100000-0000-4000-8000-000000000001'; raise exception 'EXPECTED_ROLLBACK_MUTATION_BLOCK';
  exception when insufficient_privilege then null; when others then if sqlerrm<>'M021_RETENTION_CONTROL_UNAVAILABLE' then raise; end if; end;
end $$;
reset role;
reset request.jwt.claim.sub;

set role service_role;
do $$ begin
  begin perform app.run_retention_reconciler('32100000-0000-4000-8000-000000000001',repeat('f',64)); raise exception 'EXPECTED_RECONCILER_REVOKED';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

\echo 'RETENTION_LIVE_LOCAL_CONTROL_ROLLBACK_PASS'
