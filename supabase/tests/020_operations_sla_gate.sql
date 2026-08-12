\set ON_ERROR_STOP on

insert into public.organizations(id,slug,legal_name) values
('32000000-0000-4000-8000-000000000001','m020-a','M020 Synthetic A'),
('32000000-0000-4000-8000-000000000002','m020-b','M020 Synthetic B');
insert into public.organization_users(organization_id,user_id,role) values
('32000000-0000-4000-8000-000000000001','32010000-0000-4000-8000-000000000001','ennco_admin'),
('32000000-0000-4000-8000-000000000001','32010000-0000-4000-8000-000000000002','teckel_admin'),
('32000000-0000-4000-8000-000000000001','32010000-0000-4000-8000-000000000003','ennco_operator'),
('32000000-0000-4000-8000-000000000001','32010000-0000-4000-8000-000000000005','auditor_readonly'),
('32000000-0000-4000-8000-000000000002','32010000-0000-4000-8000-000000000004','ennco_admin');
insert into public.runtime_controls(organization_id,global_kill_switch,external_send_allowed) values
('32000000-0000-4000-8000-000000000001',false,true),
('32000000-0000-4000-8000-000000000002',true,false);
insert into public.reporting_calendar_days(organization_id,calendar_date,is_business_day,evidence_class,source_sha256,recorded_by)
select '32000000-0000-4000-8000-000000000001',d::date,extract(isodow from d)<6,'live',repeat('1',64),'32010000-0000-4000-8000-000000000002'
from generate_series(date '2026-08-10',date '2026-08-31',interval '1 day') d;

select set_config('app.operations_rpc_write','on',false);
insert into public.operational_assignments(organization_id,primary_user_id,backup_user_id,status,source_reference,configured_by,configured_at)
values('32000000-0000-4000-8000-000000000001','32010000-0000-4000-8000-000000000003','32010000-0000-4000-8000-000000000002','ACTIVE','synthetic gate','32010000-0000-4000-8000-000000000001',now());
select set_config('app.operations_rpc_write','off',false);

set request.jwt.claim.sub='32010000-0000-4000-8000-000000000001';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ begin
  if (public.evaluate_operations_health('32000000-0000-4000-8000-000000000001',now())->>'state')<>'UNKNOWN' then raise exception 'WATCHDOG_ABSENCE_NOT_UNKNOWN'; end if;
end $$;
reset role;
do $$ begin
  begin
    insert into public.messages(organization_id,direction,status,idempotency_key,correlation_id)
    values('32000000-0000-4000-8000-000000000001','OUTBOUND','QUEUED','m020-unknown-watchdog-send','32040000-0000-4000-8000-000000000010');
    raise exception 'UNKNOWN_WATCHDOG_SEND_BYPASS';
  exception when others then if sqlerrm='UNKNOWN_WATCHDOG_SEND_BYPASS' then raise; end if; end;
  insert into public.messages(organization_id,direction,status,idempotency_key,correlation_id)
  values('32000000-0000-4000-8000-000000000001','OUTBOUND','DRY_RUN','m020-dry-run-allowed','32040000-0000-4000-8000-000000000011');
end $$;

insert into public.accounts(id,organization_id,legal_name,normalized_name,evidence_class)
values('32070000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','Synthetic M020 Account','synthetic-m020-account','synthetic_demo');
set session_replication_role=replica;
insert into public.opportunities(
  id,organization_id,account_id,stage,economic_buyer,active_pain,business_impact,timing_under_90_days,value_mxn,next_action,next_action_at
) values (
  '32080000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','32070000-0000-4000-8000-000000000001',
  'DECISION',true,true,true,true,1000000,'synthetic signed state',now()+interval '1 day'
);
set session_replication_role=origin;

set request.jwt.claim.sub='32010000-0000-4000-8000-000000000003';
set request.jwt.claim.aal='aal1';
set role authenticated;
do $$ begin
  begin perform public.evaluate_operations_health('32000000-0000-4000-8000-000000000001',now());
    raise exception 'AAL1_READ_BYPASS'; exception when others then if sqlerrm='AAL1_READ_BYPASS' then raise; end if; end;
  begin insert into public.tasks(organization_id,task_type,normalized_objective,due_at) values('32000000-0000-4000-8000-000000000001','BYPASS','must fail',now());
    raise exception 'TASK_DML_BYPASS'; exception when others then if sqlerrm='TASK_DML_BYPASS' then raise; end if; end;
  begin insert into public.approvals(organization_id,subject_type,subject_id,subject_sha256,decision,decided_by) values('32000000-0000-4000-8000-000000000001','bypass',gen_random_uuid(),repeat('2',64),'APPROVED','32010000-0000-4000-8000-000000000003');
    raise exception 'APPROVAL_DML_BYPASS'; exception when others then if sqlerrm='APPROVAL_DML_BYPASS' then raise; end if; end;
  begin update public.incidents set status='RESOLVED' where organization_id='32000000-0000-4000-8000-000000000001';
    raise exception 'INCIDENT_DML_BYPASS'; exception when others then if sqlerrm='INCIDENT_DML_BYPASS' then raise; end if; end;
  begin update public.meetings set outcome_status='HELD' where organization_id='32000000-0000-4000-8000-000000000001';
    raise exception 'MEETING_DML_BYPASS'; exception when others then if sqlerrm='MEETING_DML_BYPASS' then raise; end if; end;
  begin update public.provider_events set reply_classification='POSITIVE' where organization_id='32000000-0000-4000-8000-000000000001';
    raise exception 'PROVIDER_EVENT_DML_BYPASS'; exception when others then if sqlerrm='PROVIDER_EVENT_DML_BYPASS' then raise; end if; end;
  begin delete from public.event_outbox where organization_id='32000000-0000-4000-8000-000000000001';
    raise exception 'OUTBOX_DELETE_BYPASS'; exception when others then if sqlerrm='OUTBOX_DELETE_BYPASS' then raise; end if; end;
  begin insert into public.notification_deliveries(organization_id,outbox_event_id,channel,destination_hash,status,delivered_at)
    values('32000000-0000-4000-8000-000000000001',gen_random_uuid(),'TELEGRAM',repeat('f',64),'DELIVERED',now());
    raise exception 'DELIVERY_FORGERY_BYPASS'; exception when others then if sqlerrm='DELIVERY_FORGERY_BYPASS' then raise; end if; end;
end $$;
reset role;

insert into public.contacts(id,organization_id,account_id,full_name,role_title,normalized_email,verified,verified_at,source_confidence)
values('32100000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','32070000-0000-4000-8000-000000000001','Synthetic Reply','Plant Director','reply@synthetic.invalid',true,now(),'VERIFIED');
insert into public.campaigns(id,organization_id,name,status,manifest_json,manifest_sha256,suppression_snapshot_at,shadow_canary_decision,approved_by,approved_at)
values('32110000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','Synthetic Reply Campaign','ACTIVE','{}',repeat('1',64),now(),'PASS','32010000-0000-4000-8000-000000000001',now());
insert into public.sequence_versions(id,organization_id,campaign_id,version,sender_name,sender_title,content_sha256,approved_by,approved_at)
values('32120000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','32110000-0000-4000-8000-000000000001',1,'Synthetic Sender','CEO',repeat('2',64),'32010000-0000-4000-8000-000000000001',now());
insert into public.mailboxes(id,organization_id,normalized_email,domain,sender_name)
values('32130000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','sender@synthetic.invalid','synthetic.invalid','Synthetic Sender');
insert into public.campaign_enrollments(id,organization_id,campaign_id,sequence_version_id,account_id,contact_id,mailbox_id,status)
values('32140000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','32110000-0000-4000-8000-000000000001','32120000-0000-4000-8000-000000000001','32070000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','32130000-0000-4000-8000-000000000001','REPLIED');
insert into public.messages(id,organization_id,enrollment_id,mailbox_id,contact_id,direction,status,idempotency_key,correlation_id)
values('32150000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','32140000-0000-4000-8000-000000000001','32130000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','INBOUND','DELIVERED','synthetic-historical-reply','32160000-0000-4000-8000-000000000001');
insert into public.tasks(id,organization_id,account_id,contact_id,task_type,normalized_objective,due_at)
values('32170000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','32070000-0000-4000-8000-000000000001','32100000-0000-4000-8000-000000000001','REPLY_FOLLOW_UP','historical reply follow up',now()+interval '4 hours');
insert into public.provider_events(id,organization_id,source,source_record_type,external_event_id,message_id,payload_json,observed_at,processed_at,event_kind,reply_classification,correlation_id,processing_status)
values('32180000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','gmail','message','synthetic-historical-reply','32150000-0000-4000-8000-000000000001','{}','2026-08-10T10:00:00-06:00',now(),'REPLY','UNREVIEWED','32160000-0000-4000-8000-000000000001','PROCESSED');
set request.jwt.claim.sub='32010000-0000-4000-8000-000000000003';
set request.jwt.claim.aal='aal2';
set role authenticated;
select public.review_reply_and_route('32000000-0000-4000-8000-000000000001','32180000-0000-4000-8000-000000000001','POSITIVE',repeat('4',64));
reset role;
do $$ begin
  if not exists(select 1 from public.operational_sla_cases where subject_id='32170000-0000-4000-8000-000000000001' and case_type='POSITIVE_REPLY' and status='BREACHED' and due_at='2026-08-10T18:00:00-06:00') then raise exception 'HISTORICAL_REPLY_FALSE_SLA_RESET'; end if;
  if not exists(select 1 from public.tasks where id='32170000-0000-4000-8000-000000000001' and due_at='2026-08-10T18:00:00-06:00') then raise exception 'HISTORICAL_REPLY_TASK_DUE_RESET'; end if;
end $$;

set request.jwt.claim.sub='32010000-0000-4000-8000-000000000001';
set request.jwt.claim.aal='aal2';
set role authenticated;
select public.request_operational_approval(
  '32000000-0000-4000-8000-000000000001','campaign_copy','32020000-0000-4000-8000-000000000001',repeat('3',64),
  'approve synthetic transition',repeat('a',64)
);
do $$ declare request_id uuid; begin
  select id into request_id from public.approval_requests where organization_id='32000000-0000-4000-8000-000000000001';
  begin perform public.decide_operational_approval('32000000-0000-4000-8000-000000000001',request_id,repeat('3',64),'APPROVED','self decision must fail',repeat('b',64));
    raise exception 'APPROVAL_SELF_DECISION_BYPASS'; exception when others then if sqlerrm='APPROVAL_SELF_DECISION_BYPASS' then raise; end if; end;
  begin perform public.decide_operational_approval('32000000-0000-4000-8000-000000000001',request_id,repeat('4',64),'APPROVED','hash drift must fail',repeat('c',64));
    raise exception 'APPROVAL_HASH_DRIFT_BYPASS'; exception when others then if sqlerrm='APPROVAL_HASH_DRIFT_BYPASS' then raise; end if; end;
end $$;
reset role;

set request.jwt.claim.sub='32010000-0000-4000-8000-000000000002';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ declare request_id uuid; result jsonb; begin
  select id into request_id from public.approval_requests where organization_id='32000000-0000-4000-8000-000000000001';
  result:=public.decide_operational_approval('32000000-0000-4000-8000-000000000001',request_id,repeat('3',64),'APPROVED','independent synthetic approval',repeat('d',64));
  if result->>'status'<>'APPROVED' or result->>'replayed'<>'false' then raise exception 'APPROVAL_DECISION_RESULT_INVALID'; end if;
  result:=public.decide_operational_approval('32000000-0000-4000-8000-000000000001',request_id,repeat('3',64),'APPROVED','independent synthetic approval',repeat('d',64));
  if result->>'replayed'<>'true' then raise exception 'APPROVAL_REPLAY_INVALID'; end if;
end $$;
reset role;

select set_config('app.operations_rpc_write','on',false);
insert into public.approval_requests(
  organization_id,subject_type,subject_id,subject_sha256,status,request_reason,requested_by,requested_at,due_at,idempotency_key
) values (
  '32000000-0000-4000-8000-000000000001','synthetic_expired','32020000-0000-4000-8000-000000000009',repeat('6',64),
  'PENDING','synthetic expired approval','32010000-0000-4000-8000-000000000001',now()-interval '5 days',now()-interval '1 day',repeat('6',64)
);
select set_config('app.operations_rpc_write','off',false);
set request.jwt.claim.sub='32010000-0000-4000-8000-000000000002';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ declare request_id uuid; result jsonb; begin
  select id into request_id from public.approval_requests where subject_type='synthetic_expired';
  result:=public.decide_operational_approval('32000000-0000-4000-8000-000000000001',request_id,repeat('6',64),'APPROVED','expired decision must not remain pending',repeat('1',64));
  if result->>'status'<>'EXPIRED' or result->'approval_id'<>'null'::jsonb then raise exception 'APPROVAL_EXPIRY_RESPONSE_INVALID'; end if;
  if not exists(select 1 from public.approval_requests where id=request_id and status='EXPIRED') then raise exception 'APPROVAL_EXPIRY_NOT_PERSISTED'; end if;
end $$;
reset role;
set request.jwt.claim.sub='32010000-0000-4000-8000-000000000001';
set request.jwt.claim.aal='aal2';
set role authenticated;
select public.request_operational_approval(
  '32000000-0000-4000-8000-000000000001','synthetic_expired','32020000-0000-4000-8000-000000000009',repeat('6',64),
  'replacement after expired approval',repeat('2',64)
);
reset role;

set request.jwt.claim.sub='32010000-0000-4000-8000-000000000001';
set request.jwt.claim.aal='aal2';
set role authenticated;
select public.request_closed_won_approval(
  '32000000-0000-4000-8000-000000000001','32080000-0000-4000-8000-000000000001',
  'approve canonical opportunity snapshot',repeat('9',64)
);
reset role;
set session_replication_role=replica;
update public.opportunities set next_action='synthetic state changed after request' where id='32080000-0000-4000-8000-000000000001';
set session_replication_role=origin;
set request.jwt.claim.sub='32010000-0000-4000-8000-000000000002';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ declare request_record public.approval_requests%rowtype; begin
  select * into request_record from public.approval_requests
  where organization_id='32000000-0000-4000-8000-000000000001' and subject_type='opportunity_closed_won';
  begin perform public.decide_operational_approval(
    request_record.organization_id,request_record.id,request_record.subject_sha256,'APPROVED','stale subject must fail',repeat('0',64)
  ); raise exception 'APPROVAL_CANONICAL_DRIFT_BYPASS';
  exception when others then if sqlerrm='APPROVAL_CANONICAL_DRIFT_BYPASS' then raise; end if; end;
end $$;
reset role;

set request.jwt.claim.sub='32010000-0000-4000-8000-000000000003';
set request.jwt.claim.aal='aal2';
set role authenticated;
select app.schedule_meeting(
  '32000000-0000-4000-8000-000000000001','32080000-0000-4000-8000-000000000001',now()+interval '1 hour','m020-meeting-outcome-sla'
);
reset role;
do $$ begin
  if not exists(
    select 1 from public.operational_sla_cases s join public.meetings m on m.id=s.subject_id
    where s.organization_id='32000000-0000-4000-8000-000000000001' and s.case_type='MEETING_OUTCOME'
      and s.subject_type='meeting' and s.status='OPEN' and s.due_at=m.scheduled_at+interval '24 hours'
  ) then raise exception 'MEETING_OUTCOME_SLA_NOT_OPENED'; end if;
end $$;

set request.jwt.claim.sub='32010000-0000-4000-8000-000000000003';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ declare meeting_id uuid; begin
  select id into meeting_id from public.meetings where opportunity_id='32080000-0000-4000-8000-000000000001';
  begin perform public.record_meeting_outcome_v2(
    '32000000-0000-4000-8000-000000000001',meeting_id,'HELD',null,'null time must fail',repeat('a',64),repeat('c',64)
  ); raise exception 'NULL_MEETING_OUTCOME_TIME_BYPASS';
  exception when others then if sqlerrm='NULL_MEETING_OUTCOME_TIME_BYPASS' then raise; end if; end;
  begin perform public.record_meeting_outcome_v2(
    '32000000-0000-4000-8000-000000000001',meeting_id,'HELD',now()+interval '1 hour','future meeting must fail',repeat('a',64),repeat('a',64)
  ); raise exception 'FUTURE_MEETING_OUTCOME_BYPASS';
  exception when others then if sqlerrm='FUTURE_MEETING_OUTCOME_BYPASS' then raise; end if; end;
  begin perform public.record_meeting_outcome_v2(
    '32000000-0000-4000-8000-000000000001',meeting_id,'HELD',now(),'early held meeting must fail',repeat('a',64),repeat('b',64)
  ); raise exception 'EARLY_HELD_MEETING_BYPASS';
  exception when others then if sqlerrm='EARLY_HELD_MEETING_BYPASS' then raise; end if; end;
end $$;
reset role;

insert into public.tasks(id,organization_id,task_type,normalized_objective,due_at,correlation_id)
values('32030000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','REPLY_FOLLOW_UP','synthetic reply follow up',now()+interval '1 hour','32040000-0000-4000-8000-000000000001');
select set_config('app.operations_rpc_write','on',false);
insert into public.operational_sla_cases(organization_id,case_type,subject_type,subject_id,severity,due_at)
values('32000000-0000-4000-8000-000000000001','POSITIVE_REPLY','task','32030000-0000-4000-8000-000000000001','P1',now()-interval '1 minute');
select set_config('app.operations_rpc_write','off',false);
set request.jwt.claim.sub='32010000-0000-4000-8000-000000000001';
set request.jwt.claim.aal='aal2';
set role authenticated;
select public.assign_operational_task('32000000-0000-4000-8000-000000000001','32030000-0000-4000-8000-000000000001','32010000-0000-4000-8000-000000000003','32010000-0000-4000-8000-000000000002',repeat('e',64));
do $$ begin
  if not exists(select 1 from public.operational_sla_cases where subject_id='32030000-0000-4000-8000-000000000001' and owner_user_id='32010000-0000-4000-8000-000000000003' and backup_user_id='32010000-0000-4000-8000-000000000002') then raise exception 'TASK_SLA_ASSIGNMENT_NOT_PROPAGATED'; end if;
  begin perform public.assign_operational_task('32000000-0000-4000-8000-000000000001','32030000-0000-4000-8000-000000000001','32010000-0000-4000-8000-000000000005','32010000-0000-4000-8000-000000000002',repeat('3',64));
    raise exception 'TASK_AUDITOR_ASSIGNMENT_BYPASS'; exception when others then if sqlerrm='TASK_AUDITOR_ASSIGNMENT_BYPASS' then raise; end if; end;
end $$;
reset role;
set request.jwt.claim.sub='32010000-0000-4000-8000-000000000003';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ declare result jsonb; begin
  result:=public.complete_operational_task_v2('32000000-0000-4000-8000-000000000001','32030000-0000-4000-8000-000000000001',repeat('5',64),repeat('f',64));
  if result->>'status'<>'DONE' then raise exception 'TASK_COMPLETION_INVALID'; end if;
  if not exists(select 1 from public.operational_sla_cases where subject_id='32030000-0000-4000-8000-000000000001' and status='BREACHED' and completed_at is not null) then raise exception 'LATE_TASK_FALSE_MET'; end if;
end $$;
reset role;

select app.open_operational_incident('32000000-0000-4000-8000-000000000001','synthetic-intermediate','P1','Synthetic intermediate lifecycle',null);
set request.jwt.claim.sub='32010000-0000-4000-8000-000000000001';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ declare incident_id uuid; result jsonb; begin
  select id into incident_id from public.incidents where incident_key='synthetic-intermediate';
  result:=public.transition_operational_incident('32000000-0000-4000-8000-000000000001',incident_id,'ACKNOWLEDGE',repeat('e',64),'ack before rollback',false,repeat('7',64));
  result:=public.transition_operational_incident('32000000-0000-4000-8000-000000000001',incident_id,'CONTAIN',repeat('f',64),'contained before rollback',false,repeat('8',64));
end $$;
reset role;

select app.open_operational_incident('32000000-0000-4000-8000-000000000001','synthetic-lifecycle','P0','Synthetic lifecycle incident','32040000-0000-4000-8000-000000000002');
set request.jwt.claim.sub='32010000-0000-4000-8000-000000000001';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ declare incident_id uuid; result jsonb; begin
  select id into incident_id from public.incidents where incident_key='synthetic-lifecycle';
  begin perform public.transition_operational_incident('32000000-0000-4000-8000-000000000001',incident_id,'RESOLVE',repeat('6',64),'cannot skip lifecycle',true,repeat('0',64));
    raise exception 'INCIDENT_SKIP_BYPASS'; exception when others then if sqlerrm='INCIDENT_SKIP_BYPASS' then raise; end if; end;
  result:=public.transition_operational_incident('32000000-0000-4000-8000-000000000001',incident_id,'ACKNOWLEDGE',repeat('6',64),'acknowledged synthetic incident',false,repeat('1',64));
  result:=public.transition_operational_incident('32000000-0000-4000-8000-000000000001',incident_id,'CONTAIN',repeat('7',64),'contained synthetic incident',false,repeat('2',64));
  result:=public.transition_operational_incident('32000000-0000-4000-8000-000000000001',incident_id,'RECOVER',repeat('8',64),'recovered synthetic service',false,repeat('3',64));
  result:=public.transition_operational_incident('32000000-0000-4000-8000-000000000001',incident_id,'MONITOR',repeat('9',64),'monitored synthetic recovery',false,repeat('4',64));
  result:=public.transition_operational_incident('32000000-0000-4000-8000-000000000001',incident_id,'RESOLVE',repeat('a',64),'root cause and resolution verified',true,repeat('5',64));
  result:=public.transition_operational_incident('32000000-0000-4000-8000-000000000001',incident_id,'REVIEW',repeat('b',64),'post incident review complete',true,repeat('6',64));
  if result->>'status'<>'REVIEWED' then raise exception 'INCIDENT_LIFECYCLE_INVALID'; end if;
end $$;
reset role;

do $$ declare old_incident_id uuid; new_incident_id uuid; begin
  select id into old_incident_id from public.incidents where incident_key='synthetic-lifecycle';
  new_incident_id:=app.open_operational_incident('32000000-0000-4000-8000-000000000001','synthetic-lifecycle','P0','Synthetic lifecycle incident recurred','32040000-0000-4000-8000-000000000003');
  if new_incident_id is null or new_incident_id=old_incident_id then raise exception 'INCIDENT_REOPEN_REUSED_OCCURRENCE'; end if;
  if not exists(select 1 from public.operational_sla_cases where subject_id=new_incident_id and case_type='INCIDENT_ACK' and status='OPEN') then raise exception 'INCIDENT_REOPEN_SLA_MISSING'; end if;
  if not exists(select 1 from public.event_outbox where aggregate_id=new_incident_id and event_type='incident.opened') then raise exception 'INCIDENT_REOPEN_ALERT_MISSING'; end if;
  if (select count(*) from public.incident_alert_requirements where incident_id=new_incident_id)<>2 then raise exception 'INCIDENT_ALERT_MATRIX_INCOMPLETE'; end if;
  if not exists(select 1 from public.runtime_controls where organization_id='32000000-0000-4000-8000-000000000001' and global_kill_switch and not external_send_allowed) then raise exception 'P0_OPEN_DID_NOT_PAUSE_SEND'; end if;
end $$;

insert into public.event_outbox(id,organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json,created_at)
values('32050000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','synthetic','32050000-0000-4000-8000-000000000002','synthetic.stale','synthetic-stale-outbox','{}',now()-interval '10 minutes');
do $$ declare result jsonb; begin
  result:=app.run_operations_watchdog('32000000-0000-4000-8000-000000000001',now(),repeat('c',64));
  if result->>'status'<>'DEGRADED' or (result->>'incidents_created')::integer<1 then raise exception 'WATCHDOG_FINDING_INVALID'; end if;
  result:=app.run_operations_watchdog('32000000-0000-4000-8000-000000000001',(result->>'evaluated_at')::timestamptz,repeat('c',64));
  if result->>'replayed'<>'true' then raise exception 'WATCHDOG_REPLAY_INVALID'; end if;
end $$;

select app.open_operational_incident('32000000-0000-4000-8000-000000000001','synthetic-p0-overdue','P0','Synthetic overdue P0',null);
update public.incidents set ack_due_at=now()-interval '1 minute' where incident_key='synthetic-p0-overdue';
update public.event_outbox set created_at=now()-interval '3 minutes'
where aggregate_id=(select id from public.incidents where incident_key='synthetic-p0-overdue') and event_type='incident.opened';
insert into public.notification_deliveries(organization_id,outbox_event_id,channel,destination_hash,status,delivered_at)
select organization_id,id,'EMAIL',repeat('a',64),'DELIVERED',now()
from public.event_outbox where aggregate_id=(select id from public.incidents where incident_key='synthetic-p0-overdue') and event_type='incident.opened';
select app.run_operations_watchdog('32000000-0000-4000-8000-000000000001',now(),repeat('d',64));
do $$ begin
  if not exists(select 1 from public.runtime_controls where organization_id='32000000-0000-4000-8000-000000000001' and global_kill_switch and not external_send_allowed) then raise exception 'P0_KILL_SWITCH_NOT_ENFORCED'; end if;
  if (select count(*) from public.incidents where organization_id='32000000-0000-4000-8000-000000000001' and incident_key='outbox:32050000-0000-4000-8000-000000000001')<>1 then raise exception 'WATCHDOG_IDEMPOTENCY_INVALID'; end if;
  if not exists(select 1 from public.incidents where organization_id='32000000-0000-4000-8000-000000000001' and incident_key like 'alert-delivery:%' and severity='P0') then raise exception 'CRITICAL_ALERT_DELIVERY_WATCHDOG_MISSING'; end if;
  if not exists(select 1 from public.audit_log where organization_id='32000000-0000-4000-8000-000000000001' and record_type='approval_requests') then raise exception 'OPERATIONS_AUDIT_MISSING'; end if;
  if has_function_privilege('public','public.request_operational_approval(uuid,text,uuid,text,text,text)','EXECUTE') then raise exception 'PUBLIC_APPROVAL_RPC_EXECUTE_BYPASS'; end if;
  if has_function_privilege('authenticated','app.request_operational_approval(uuid,text,uuid,text,text,text)','EXECUTE') then raise exception 'INTERNAL_APPROVAL_RPC_EXECUTE_BYPASS'; end if;
  if has_function_privilege('authenticated','app.run_operations_watchdog(uuid,timestamptz,text)','EXECUTE') then raise exception 'AUTHENTICATED_WATCHDOG_EXECUTE_BYPASS'; end if;
  if not has_function_privilege('authenticated','public.request_operational_approval(uuid,text,uuid,text,text,text)','EXECUTE') then raise exception 'AUTHENTICATED_APPROVAL_WRAPPER_MISSING'; end if;
  if not has_function_privilege('service_role','app.run_operations_watchdog(uuid,timestamptz,text)','EXECUTE') then raise exception 'SERVICE_WATCHDOG_EXECUTE_MISSING'; end if;
end $$;

set request.jwt.claim.sub='32010000-0000-4000-8000-000000000001';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ declare health jsonb; begin
  health:=public.evaluate_operations_health('32000000-0000-4000-8000-000000000001',now());
  if health->>'status'<>'READ_ONLY' or health->>'state'<>'DEGRADED' or health->>'operator_assignment'<>'ACTIVE' then raise exception 'OPERATIONS_HEALTH_INVALID'; end if;
  begin perform public.evaluate_operations_health('32000000-0000-4000-8000-000000000002',now());
    raise exception 'CROSS_TENANT_HEALTH_BYPASS'; exception when others then if sqlerrm='CROSS_TENANT_HEALTH_BYPASS' then raise; end if; end;
end $$;
reset role;

\echo 'OPERATIONS_SLA_FORWARD_GATE_PASS'
