\set ON_ERROR_STOP on

set request.jwt.claim.sub = '81111111-1111-4111-8111-111111111111';
set request.jwt.claim.aal = 'aal2';
set role authenticated;

do $$
declare
  checks_before bigint := (select count(*) from public.qualification_checks);
  outbox_before bigint := (select count(*) from public.event_outbox);
begin
  if has_function_privilege(
    'authenticated',
    'app.qualify_lead_strict_without_suppression(uuid,uuid,boolean,boolean,boolean,boolean,numeric,uuid[])',
    'EXECUTE'
  ) then raise exception 'M017_ROLLBACK_EXPOSED_SUPPRESSION_BYPASS'; end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.suppression_entries'::regclass
      and tgname = 'suppression_entries_a_qualification_mutex' and not tgisinternal
  ) then raise exception 'M017_ROLLBACK_REMOVED_SUPPRESSION_MUTEX'; end if;
  if to_regprocedure('app.is_suppressed(uuid,uuid,text,text)') is null then
    raise exception 'M017_ROLLBACK_REMOVED_SUPPRESSION_EVALUATION';
  end if;
  if position(
    'M017_ROLLED_BACK_STRICT_QUALIFICATION_DISABLED'
    in pg_get_functiondef('app.qualify_lead_strict(uuid,uuid,boolean,boolean,boolean,boolean,numeric,uuid[])'::regprocedure)
  ) = 0 then raise exception 'M017_ROLLBACK_NOT_FAIL_CLOSED'; end if;

  begin
    perform app.qualify_lead_strict(
      '11111111-1111-4111-8111-111111111111',
      '61111111-1111-4111-8111-111111111199',
      true, true, true, true, 0,
      array[
        '71111111-1111-4111-8111-111111111191',
        '71111111-1111-4111-8111-111111111192',
        '71111111-1111-4111-8111-111111111193',
        '71111111-1111-4111-8111-111111111194'
      ]::uuid[]
    );
    raise exception 'EXPECTED_M017_ROLLBACK_QUALIFICATION_BLOCK';
  exception when others then
    if sqlerrm <> 'M017_ROLLED_BACK_STRICT_QUALIFICATION_DISABLED' then raise; end if;
  end;
  if (select count(*) from public.qualification_checks) <> checks_before
    or (select count(*) from public.event_outbox) <> outbox_before
  then raise exception 'M017_ROLLBACK_BLOCK_MUTATED_COMMERCIAL_STATE'; end if;
  if has_table_privilege('authenticated', 'public.leads', 'UPDATE')
    or has_table_privilege('authenticated', 'public.qualification_checks', 'INSERT')
  then raise exception 'M017_ROLLBACK_RESTORED_DIRECT_QUALIFICATION_DML'; end if;
end;
$$;

reset role;
reset request.jwt.claim.aal;
reset request.jwt.claim.sub;

\echo 'STRICT_LEAD_SUPPRESSION_ROLLBACK_GATE_PASS'
