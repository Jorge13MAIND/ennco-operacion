\set ON_ERROR_STOP on

do $$
begin
  if has_table_privilege('authenticated', 'public.source_evidence', 'INSERT')
    or has_table_privilege('authenticated', 'public.leads', 'UPDATE')
    or has_table_privilege('authenticated', 'public.qualification_checks', 'INSERT')
    or has_table_privilege('authenticated', 'public.payments', 'INSERT')
    or has_table_privilege('authenticated', 'public.attribution_events', 'INSERT')
    or has_table_privilege('authenticated', 'public.commissions', 'INSERT')
  then raise exception 'M014_ROLLBACK_RESTORED_DIRECT_DML'; end if;

  if position(
    'app.qualification_evidence_is_strict'
    in pg_get_functiondef('app.enforce_lead_qualification_transition()'::regprocedure)
  ) = 0 then raise exception 'M014_ROLLBACK_WEAKENED_LEAD_GATE'; end if;

  if position(
    'new.stage in (''QUALIFIED'', ''TECHNICAL_VISIT'', ''PROPOSAL'', ''DECISION'', ''CLOSED_WON'')'
    in pg_get_functiondef('app.enforce_opportunity_transition()'::regprocedure)
  ) = 0 then raise exception 'M014_ROLLBACK_WEAKENED_OPPORTUNITY_GATE'; end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.payments'::regclass
      and tgname = 'payments_append_only' and not tgisinternal
  ) then raise exception 'M014_ROLLBACK_REMOVED_PAYMENT_APPEND_ONLY'; end if;
end;
$$;

\echo 'COMMERCIAL_INTEGRITY_ROLLBACK_GATE_PASS'
