\set ON_ERROR_STOP on
set request.jwt.claim.sub='31910000-0000-4000-8000-000000000002';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ declare assessment jsonb;
begin
  assessment:=public.assess_research_inventory('31900000-0000-4000-8000-000000000001');
  if assessment->>'decision'<>'KILL' or assessment->>'outreach_state'<>'RESEARCH_ONLY_HOLD'
    or (assessment->>'outreach_eligible_records')::int<>0
    or assessment->'blockers'<>jsonb_build_array('M019_ROLLED_BACK_RESEARCH_UNAVAILABLE')
  then raise exception 'M019_ROLLBACK_ASSESSMENT_NOT_FAIL_CLOSED'; end if;
  begin
    perform public.freeze_research_inventory_snapshot('31900000-0000-4000-8000-000000000001',repeat('0',64),repeat('1',64));
    raise exception 'EXPECTED_ROLLBACK_MUTATION_BLOCK';
  exception when others then if sqlstate not in ('42501','42883') then raise; end if; end;
end $$;
reset role;
do $$ begin
  if to_regclass('public.research_inventory_snapshots') is null
    or not exists(select 1 from public.research_inventory_snapshots)
    or not exists(select 1 from pg_trigger where tgrelid='public.accounts'::regclass
      and tgname='accounts_m019_rollback_fail_closed' and not tgisinternal)
  then raise exception 'M019_ROLLBACK_DID_NOT_PRESERVE_EVIDENCE_OR_GUARD'; end if;
end $$;
\echo 'RESEARCH_WORKBENCH_ROLLBACK_GATE_PASS'
