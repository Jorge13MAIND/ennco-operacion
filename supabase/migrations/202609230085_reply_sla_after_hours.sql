begin;
-- Responses received after 18:00 or on a non-business day are due next business day at noon.
create function app.reply_response_deadline(target_organization_id uuid,target_observed_at timestamptz)
returns timestamptz language plpgsql stable security definer set search_path=public,app,pg_temp as $$
declare local_received timestamp; received_business_day boolean;
begin
  local_received:=target_observed_at at time zone 'America/Mexico_City';
  select d.is_business_day into received_business_day from public.reporting_calendar_days d
    where d.organization_id=target_organization_id and d.jurisdiction='MX'
      and d.evidence_class='live' and d.calendar_date=local_received::date;
  if received_business_day is null then raise exception 'OPERATIONS_BUSINESS_CALENDAR_INCOMPLETE'; end if;
  if received_business_day and local_received::time<'18:00'::time then
    return app.operations_business_deadline(target_organization_id,local_received::date,0,'18:00');
  end if;
  return app.operations_business_deadline(target_organization_id,local_received::date,
    case when received_business_day then 1 else 0 end,'12:00');
end $$;
revoke all on function app.reply_response_deadline(uuid,timestamptz) from public,anon,authenticated,service_role;
create or replace function app.review_reply_and_route(
  target_organization_id uuid,target_provider_event_id uuid,target_classification public.reply_classification,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; base jsonb; event_record public.provider_events%rowtype; task_record public.tasks%rowtype; assignment public.operational_assignments%rowtype; due_value timestamptz; case_status text; response jsonb;
begin
  perform app.operations_assert_operator(target_organization_id);
  replay:=app.operations_command_begin(target_organization_id,'review_reply_and_route',target_idempotency_key,
    jsonb_build_object('provider_event_id',target_provider_event_id,'classification',target_classification));
  if replay is not null then return replay; end if;
  select * into event_record from public.provider_events where organization_id=target_organization_id and id=target_provider_event_id for update;
  if not found then raise exception 'PROVIDER_EVENT_NOT_FOUND'; end if;
  base:=app.review_reply_event(target_organization_id,target_provider_event_id,target_classification);
  if target_classification='POSITIVE' then
    due_value:=app.reply_response_deadline(target_organization_id,event_record.observed_at);
    case_status:=case when due_value<clock_timestamp() then 'BREACHED' else 'OPEN' end;
    select * into assignment from public.operational_assignments where organization_id=target_organization_id and status='ACTIVE'
      and app.operations_assignment_is_active(target_organization_id);
    select t.* into task_record from public.tasks t join public.messages m on m.organization_id=t.organization_id and m.contact_id=t.contact_id
    where t.organization_id=target_organization_id and t.task_type='REPLY_FOLLOW_UP' and t.status='OPEN' and m.id=event_record.message_id
    order by t.created_at desc limit 1 for update of t;
    if found then
      perform set_config('app.operations_rpc_write','on',true);
      update public.tasks set owner_user_id=assignment.primary_user_id,backup_user_id=assignment.backup_user_id,
        due_at=due_value,policy_version='ENNCO-CLIENT-SLA-2026-08-12-V1',correlation_id=event_record.correlation_id where id=task_record.id;
      insert into public.operational_sla_cases(organization_id,case_type,subject_type,subject_id,severity,owner_user_id,backup_user_id,due_at,status,breach_recorded_at)
      values(target_organization_id,'POSITIVE_REPLY','task',task_record.id,'P1',assignment.primary_user_id,assignment.backup_user_id,due_value,case_status,
        case when case_status='BREACHED' then now() else null end)
      on conflict do nothing;
    end if;
  end if;
  response:=jsonb_build_object('status','REVIEWED','provider_event_id',target_provider_event_id,'classification',target_classification,
    'lead_id',base->'lead_id','task_id',task_record.id,'correlation_id',event_record.correlation_id);
  return app.operations_command_finish(target_organization_id,'review_reply_and_route',target_idempotency_key,response);
end $$;
commit;
