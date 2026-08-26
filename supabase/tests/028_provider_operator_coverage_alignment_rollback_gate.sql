\set ON_ERROR_STOP on

do $$
declare requirements text[]:=app.provider_control_requirements(); result jsonb;
begin
  if cardinality(requirements)<>16 or not ('M028_ROLLBACK_HOLD'=any(requirements))
  then raise exception 'M028_ROLLBACK_SENTINEL_MISSING:%',requirements; end if;
  result:=app.evaluate_outbound_provider_readiness_as_system(
    '28000000-0000-4000-8000-000000000001','2026-08-20T18:00:00Z'
  );
  if result->>'release_state'<>'HOLD'
    or not (result->'blockers' ? 'PROVIDER_ACTIVATION_GATES_INCOMPLETE')
  then raise exception 'M028_ROLLBACK_DID_NOT_FAIL_CLOSED:%',result; end if;
  if (select count(*) from public.provider_activation_gates
      where organization_id='28000000-0000-4000-8000-000000000001')<>15
  then raise exception 'M028_ROLLBACK_DESTROYED_GATE_LEDGER'; end if;
end $$;

select 'PROVIDER_OPERATOR_COVERAGE_ALIGNMENT_ROLLBACK_PASS' as result;
