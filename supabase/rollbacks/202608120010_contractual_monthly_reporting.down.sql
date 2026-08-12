begin;

drop trigger if exists recovery_experiments_audit on public.recovery_experiments;
drop trigger if exists contractual_report_issuances_audit on public.contractual_report_issuances;
drop trigger if exists contractual_report_items_audit on public.contractual_report_items;
drop trigger if exists contractual_monthly_reports_audit on public.contractual_monthly_reports;
drop trigger if exists campaign_operation_days_audit on public.campaign_operation_days;
drop trigger if exists reporting_calendar_days_audit on public.reporting_calendar_days;
drop trigger if exists commercial_stage_events_audit on public.commercial_stage_events;
drop trigger if exists campaign_operation_days_integrity on public.campaign_operation_days;
drop trigger if exists reporting_calendar_days_integrity on public.reporting_calendar_days;
drop trigger if exists contractual_report_issuances_append_only on public.contractual_report_issuances;
drop trigger if exists contractual_report_items_append_only on public.contractual_report_items;
drop trigger if exists contractual_monthly_reports_append_only on public.contractual_monthly_reports;
drop trigger if exists campaign_operation_days_append_only on public.campaign_operation_days;
drop trigger if exists reporting_calendar_days_append_only on public.reporting_calendar_days;
drop trigger if exists commercial_stage_events_append_only on public.commercial_stage_events;
drop trigger if exists opportunities_stage_event on public.opportunities;

drop function if exists app.capture_monthly_audit();
drop function if exists app.release_recovery_experiment(uuid);
drop function if exists app.create_recovery_experiment(uuid, public.recovery_variable, text, integer, text, uuid, boolean, boolean, boolean, boolean, boolean);
drop function if exists app.issue_contractual_monthly_report(uuid);
drop function if exists app.generate_contractual_monthly_report(uuid, uuid, date, text, uuid);
drop function if exists app.enforce_operation_day_integrity();
drop function if exists app.enforce_reporting_calendar_integrity();
drop function if exists app.prevent_monthly_evidence_mutation();
drop function if exists app.capture_commercial_stage_event();

drop index if exists public.recovery_one_active_experiment_per_campaign;

drop table if exists public.recovery_experiments;
drop table if exists public.contractual_report_issuances;
drop table if exists public.contractual_report_items;
drop table if exists public.contractual_monthly_reports;
drop table if exists public.reporting_calendar_days;
drop table if exists public.campaign_operation_days;
drop table if exists public.commercial_stage_events;

drop index if exists public.opportunities_organization_id_id_unique;

drop type if exists public.recovery_experiment_status;
drop type if exists public.recovery_variable;
drop type if exists public.contractual_report_item_kind;
drop type if exists public.campaign_operation_status;

create or replace function app.enforce_approval_append_only()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  actor_id uuid;
begin
  if tg_op <> 'INSERT' then raise exception 'APPROVAL_APPEND_ONLY'; end if;
  actor_id := auth.uid();
  if actor_id is not null and new.decided_by <> actor_id then
    raise exception 'APPROVAL_ACTOR_MISMATCH';
  end if;
  if new.subject_type in ('campaign_first_send_release', 'rollout_wave_release')
    and (
      actor_id is null
      or not app.has_role(new.organization_id, array['teckel_admin'::public.user_role])
    )
  then raise exception 'OUTBOUND_RELEASE_APPROVAL_JORGE_ONLY'; end if;
  return new;
end;
$$;

commit;
