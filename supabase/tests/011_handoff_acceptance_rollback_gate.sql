\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.handoff_packages') is not null then raise exception 'handoff packages table still exists'; end if;
  if to_regclass('public.handoff_artifacts') is not null then raise exception 'handoff artifacts table still exists'; end if;
  if to_regclass('public.handoff_readiness_checks') is not null then raise exception 'handoff checks table still exists'; end if;
  if to_regclass('public.handoff_training_records') is not null then raise exception 'handoff training table still exists'; end if;
  if to_regclass('public.final_acceptances') is not null then raise exception 'final acceptance table still exists'; end if;
  if to_regprocedure('app.accept_handoff_package(uuid,text)') is not null then raise exception 'accept function still exists'; end if;
  if exists (select 1 from pg_type where typname = 'handoff_check_code') then raise exception 'M9 types still exist'; end if;
  if position('final_handoff_acceptance' in pg_get_functiondef('app.enforce_approval_append_only()'::regprocedure)) > 0 then
    raise exception 'M9 approval policy survived rollback';
  end if;
  if position('contractual_monthly_report_issue' in pg_get_functiondef('app.enforce_approval_append_only()'::regprocedure)) = 0 then
    raise exception 'M8 approval policy missing after rollback';
  end if;
  if to_regclass('public.contractual_monthly_reports') is null then raise exception 'M8 table missing after rollback'; end if;
end;
$$;

select 'HANDOFF_ACCEPTANCE_ROLLBACK_PASS' as result;
