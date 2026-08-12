begin;

revoke all on function public.request_operational_approval(uuid,text,uuid,text,text,text) from public,authenticated;
revoke all on function public.request_closed_won_approval(uuid,uuid,text,text) from public,authenticated;
revoke all on function public.decide_operational_approval(uuid,uuid,text,text,text,text) from public,authenticated;
revoke all on function public.assign_operational_task(uuid,uuid,uuid,uuid,text) from public,authenticated;
revoke all on function public.complete_operational_task_v2(uuid,uuid,text,text) from public,authenticated;
revoke all on function public.review_reply_and_route(uuid,uuid,public.reply_classification,text) from public,authenticated;
revoke all on function public.record_meeting_outcome_v2(uuid,uuid,text,timestamptz,text,text,text) from public,authenticated;
revoke all on function public.transition_operational_incident(uuid,uuid,text,text,text,boolean,text) from public,authenticated;
revoke all on function public.evaluate_operations_health(uuid,timestamptz) from public,authenticated;

drop function if exists public.request_operational_approval(uuid,text,uuid,text,text,text);
drop function if exists public.request_closed_won_approval(uuid,uuid,text,text);
drop function if exists public.decide_operational_approval(uuid,uuid,text,text,text,text);
drop function if exists public.assign_operational_task(uuid,uuid,uuid,uuid,text);
drop function if exists public.complete_operational_task_v2(uuid,uuid,text,text);
drop function if exists public.review_reply_and_route(uuid,uuid,public.reply_classification,text);
drop function if exists public.record_meeting_outcome_v2(uuid,uuid,text,timestamptz,text,text,text);
drop function if exists public.transition_operational_incident(uuid,uuid,text,text,text,boolean,text);
drop function if exists public.evaluate_operations_health(uuid,timestamptz);

drop trigger if exists opportunities_canonical_closed_won_approval on public.opportunities;
drop function if exists app.enforce_canonical_closed_won_approval();
drop trigger if exists messages_operations_send_health on public.messages;
drop function if exists app.enforce_operations_send_health();
drop trigger if exists meetings_open_outcome_sla on public.meetings;
drop function if exists app.open_meeting_outcome_sla();

drop function if exists app.request_closed_won_approval(uuid,uuid,text,text);
drop function if exists app.request_operational_approval(uuid,text,uuid,text,text,text);
drop function if exists app.decide_operational_approval(uuid,uuid,text,text,text,text);
drop function if exists app.assign_operational_task(uuid,uuid,uuid,uuid,text);
drop function if exists app.complete_operational_task_v2(uuid,uuid,text,text);
drop function if exists app.review_reply_and_route(uuid,uuid,public.reply_classification,text);
drop function if exists app.record_meeting_outcome_v2(uuid,uuid,text,timestamptz,text,text,text);
drop function if exists app.transition_operational_incident(uuid,uuid,text,text,text,boolean,text);
drop function if exists app.run_operations_watchdog(uuid,timestamptz,text);
drop function if exists app.evaluate_operations_health(uuid,timestamptz);
drop function if exists app.open_operational_incident(uuid,text,public.incident_severity,text,uuid);
drop function if exists app.operations_business_deadline(uuid,date,integer,time);
drop function if exists app.canonical_approval_subject_sha256(uuid,text,uuid);
drop function if exists app.operations_command_finish(uuid,text,text,jsonb);
drop function if exists app.operations_command_begin(uuid,text,text,jsonb);
drop function if exists app.operations_assert_operator(uuid,boolean);
drop function if exists app.operations_assignment_is_active(uuid);

alter table public.approvals drop constraint if exists approvals_request_tenant_fkey;
drop index if exists public.approvals_request_unique;
alter table public.approvals drop column if exists request_id;

alter table public.incidents drop constraint if exists incidents_status_check;
update public.incidents set status='MITIGATED' where status in ('CONTAINED','RECOVERING','MONITORING');
update public.incidents set status='RESOLVED' where status='REVIEWED';
drop index if exists public.incidents_org_key_unique;
alter table public.incidents
  drop constraint if exists incidents_owner_tenant_fkey,
  drop constraint if exists incidents_ack_by_tenant_fkey,
  drop constraint if exists incidents_contained_by_tenant_fkey,
  drop constraint if exists incidents_recovering_by_tenant_fkey,
  drop constraint if exists incidents_monitoring_by_tenant_fkey,
  drop constraint if exists incidents_resolved_by_tenant_fkey,
  drop constraint if exists incidents_reviewed_by_tenant_fkey,
  drop constraint if exists incidents_evidence_check,
  drop column if exists incident_key,
  drop column if exists policy_version,
  drop column if exists ack_due_at,
  drop column if exists containment_due_at,
  drop column if exists acknowledged_by,
  drop column if exists contained_at,
  drop column if exists contained_by,
  drop column if exists recovering_at,
  drop column if exists recovering_by,
  drop column if exists monitoring_at,
  drop column if exists monitoring_by,
  drop column if exists resolved_by,
  drop column if exists reviewed_at,
  drop column if exists reviewed_by,
  drop column if exists evidence_sha256,
  drop column if exists recovery_test_passed,
  drop column if exists next_update_due_at,
  add constraint incidents_status_check check (status in ('OPEN','ACKNOWLEDGED','MITIGATED','RESOLVED'));

alter table public.tasks
  drop constraint if exists tasks_owner_tenant_fkey,
  drop constraint if exists tasks_backup_tenant_fkey,
  drop constraint if exists tasks_completed_by_tenant_fkey,
  drop constraint if exists tasks_completion_evidence_check,
  drop constraint if exists tasks_completion_contract_check,
  drop column if exists backup_user_id,
  drop column if exists policy_version,
  drop column if exists completed_by,
  drop column if exists completion_evidence_sha256,
  drop column if exists correlation_id;

alter table public.meetings
  drop constraint if exists meetings_outcome_status_check,
  drop constraint if exists meetings_outcome_actor_tenant_fkey,
  drop constraint if exists meetings_outcome_evidence_check,
  drop column if exists outcome_status,
  drop column if exists outcome_recorded_at,
  drop column if exists outcome_recorded_by,
  drop column if exists outcome_evidence_sha256;

drop table if exists public.operations_watchdog_runs;
drop table if exists public.incident_alert_requirements;
drop table if exists public.operational_sla_cases;
drop table if exists public.approval_requests;
drop table if exists public.operational_command_ledger;
drop table if exists public.operational_assignments;
drop function if exists app.prevent_operations_control_direct_write();

create or replace function app.m020_rollback_fail_closed()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'M020_OPERATIONS_CONTROL_UNAVAILABLE'; end $$;

drop trigger if exists approvals_m020_rollback_fail_closed on public.approvals;
create trigger approvals_m020_rollback_fail_closed before insert or update or delete on public.approvals
for each row execute function app.m020_rollback_fail_closed();
drop trigger if exists incidents_m020_rollback_fail_closed on public.incidents;
create trigger incidents_m020_rollback_fail_closed before insert or update or delete on public.incidents
for each row execute function app.m020_rollback_fail_closed();
drop trigger if exists tasks_m020_rollback_fail_closed on public.tasks;
create trigger tasks_m020_rollback_fail_closed before insert or update or delete on public.tasks
for each row execute function app.m020_rollback_fail_closed();
drop trigger if exists roadmap_m020_rollback_fail_closed on public.roadmap_milestones;
create trigger roadmap_m020_rollback_fail_closed before insert or update or delete on public.roadmap_milestones
for each row execute function app.m020_rollback_fail_closed();
drop trigger if exists opportunities_m020_rollback_fail_closed on public.opportunities;
create trigger opportunities_m020_rollback_fail_closed before update of stage on public.opportunities
for each row when (new.stage='CLOSED_WON') execute function app.m020_rollback_fail_closed();
drop trigger if exists messages_m020_rollback_fail_closed on public.messages;
create trigger messages_m020_rollback_fail_closed before insert or update of status on public.messages
for each row when (new.direction='OUTBOUND' and new.status<>'DRY_RUN') execute function app.m020_rollback_fail_closed();

revoke insert,update,delete,truncate on public.approvals,public.incidents,public.tasks,public.roadmap_milestones,public.meetings,public.provider_events,public.event_outbox,public.notification_deliveries from authenticated;

commit;
