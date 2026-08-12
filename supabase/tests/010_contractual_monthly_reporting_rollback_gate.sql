\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.commercial_stage_events') is not null then raise exception 'stage events table still exists'; end if;
  if to_regclass('public.campaign_operation_days') is not null then raise exception 'operation days table still exists'; end if;
  if to_regclass('public.reporting_calendar_days') is not null then raise exception 'calendar table still exists'; end if;
  if to_regclass('public.contractual_monthly_reports') is not null then raise exception 'monthly reports table still exists'; end if;
  if to_regclass('public.contractual_report_items') is not null then raise exception 'report items table still exists'; end if;
  if to_regclass('public.contractual_report_issuances') is not null then raise exception 'issuances table still exists'; end if;
  if to_regclass('public.recovery_experiments') is not null then raise exception 'recovery table still exists'; end if;
  if to_regprocedure('app.generate_contractual_monthly_report(uuid,uuid,date,text,uuid)') is not null then raise exception 'report function still exists'; end if;
  if exists (select 1 from pg_type where typname = 'recovery_variable') then raise exception 'M8 types still exist'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'messages_scaled_release_gate' and not tgisinternal) then
    raise exception 'M7 message trigger missing after rollback';
  end if;
  if to_regclass('public.rollout_waves') is null then raise exception 'M7 table missing after rollback'; end if;
  if position('contractual_monthly_report_issue' in pg_get_functiondef('app.enforce_approval_append_only()'::regprocedure)) > 0 then
    raise exception 'M8 approval policy survived rollback';
  end if;
end;
$$;

select 'CONTRACTUAL_MONTHLY_REPORTING_ROLLBACK_PASS' as result;
