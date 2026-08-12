begin;

drop trigger if exists approvals_m020_rollback_fail_closed on public.approvals;
drop trigger if exists incidents_m020_rollback_fail_closed on public.incidents;
drop trigger if exists tasks_m020_rollback_fail_closed on public.tasks;
drop trigger if exists roadmap_m020_rollback_fail_closed on public.roadmap_milestones;
drop trigger if exists opportunities_m020_rollback_fail_closed on public.opportunities;
drop trigger if exists messages_m020_rollback_fail_closed on public.messages;
drop function if exists app.m020_rollback_fail_closed();

alter table public.incidents drop constraint if exists incidents_status_check;
update public.incidents set status='CONTAINED' where status='MITIGATED';

create table public.operational_assignments (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  primary_user_id uuid,
  backup_user_id uuid,
  status text not null default 'UNKNOWN' check (status in ('UNKNOWN','ACTIVE','INACTIVE')),
  source_reference text,
  configured_by uuid,
  configured_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (organization_id, primary_user_id) references public.organization_users(organization_id,user_id),
  foreign key (organization_id, backup_user_id) references public.organization_users(organization_id,user_id),
  check (primary_user_id is null or primary_user_id is distinct from backup_user_id),
  check ((status = 'ACTIVE') = (primary_user_id is not null and backup_user_id is not null and configured_by is not null and configured_at is not null))
);

create table public.operational_command_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  command_name text not null,
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  response_json jsonb,
  actor_user_id uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (organization_id, command_name, idempotency_key)
);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subject_type text not null,
  subject_id uuid not null,
  subject_sha256 text not null check (subject_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED','EXPIRED','CANCELLED')),
  request_reason text not null check (char_length(btrim(request_reason)) between 3 and 2000),
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  due_at timestamptz not null,
  decided_by uuid,
  decided_at timestamptz,
  rationale text,
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  correlation_id uuid not null default gen_random_uuid(),
  foreign key (organization_id, requested_by) references public.organization_users(organization_id,user_id),
  foreign key (organization_id, decided_by) references public.organization_users(organization_id,user_id),
  unique (organization_id,id),
  unique (organization_id,idempotency_key),
  check (due_at > requested_at),
  check (
    (status = 'PENDING' and decided_by is null and decided_at is null)
    or (status in ('APPROVED','REJECTED') and decided_by is not null and decided_at is not null and nullif(btrim(rationale),'') is not null)
    or status in ('EXPIRED','CANCELLED')
  )
);

create unique index approval_requests_pending_subject_unique
on public.approval_requests(organization_id,subject_type,subject_id)
where status='PENDING';

alter table public.approvals add column if not exists request_id uuid;
alter table public.approvals add constraint approvals_request_tenant_fkey
  foreign key (organization_id,request_id) references public.approval_requests(organization_id,id);
create unique index if not exists approvals_request_unique on public.approvals(organization_id,request_id) where request_id is not null;

create table public.operational_sla_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_type text not null check (case_type in ('POSITIVE_REPLY','APPROVAL_DECISION','MEETING_OUTCOME','INCIDENT_ACK','INCIDENT_CONTAINMENT')),
  subject_type text not null,
  subject_id uuid not null,
  severity public.incident_severity not null,
  policy_version text not null default 'ENNCO-OPS-SLA-2026-08-12-V1',
  status text not null default 'OPEN' check (status in ('OPEN','MET','BREACHED','CANCELLED')),
  owner_user_id uuid,
  backup_user_id uuid,
  due_at timestamptz not null,
  completed_at timestamptz,
  completion_evidence_sha256 text check (completion_evidence_sha256 is null or completion_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  breach_recorded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id,owner_user_id) references public.organization_users(organization_id,user_id),
  foreign key (organization_id,backup_user_id) references public.organization_users(organization_id,user_id),
  unique (organization_id,case_type,subject_type,subject_id),
  constraint operational_sla_cases_completion_check check (
    (status='OPEN' and completed_at is null and completion_evidence_sha256 is null and breach_recorded_at is null)
    or (status='MET' and completed_at is not null and completion_evidence_sha256 is not null and breach_recorded_at is null)
    or (status='BREACHED' and breach_recorded_at is not null)
    or status='CANCELLED'
  )
);

create table public.operations_watchdog_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  evaluated_at timestamptz not null,
  status text not null check (status in ('HEALTHY','DEGRADED','UNKNOWN')),
  findings_count integer not null check (findings_count >= 0),
  incidents_created integer not null check (incidents_created >= 0),
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (organization_id,idempotency_key)
);

create unique index if not exists incidents_organization_id_id_unique on public.incidents(organization_id,id);
create unique index if not exists event_outbox_organization_id_id_unique on public.event_outbox(organization_id,id);
create table public.incident_alert_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  incident_id uuid not null,
  outbox_event_id uuid not null,
  audience text not null check (audience in ('CLIENT','TECKEL')),
  required_channel text not null check (required_channel in ('EMAIL','TELEGRAM')),
  required_destination_hash text check (required_destination_hash is null or required_destination_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (organization_id,incident_id) references public.incidents(organization_id,id) on delete cascade,
  foreign key (organization_id,outbox_event_id) references public.event_outbox(organization_id,id) on delete cascade,
  unique (organization_id,incident_id,audience,required_channel)
);

alter table public.tasks
  add column if not exists backup_user_id uuid,
  add column if not exists policy_version text,
  add column if not exists completed_by uuid,
  add column if not exists completion_evidence_sha256 text,
  add column if not exists correlation_id uuid;
alter table public.tasks
  add constraint tasks_owner_tenant_fkey foreign key (organization_id,owner_user_id) references public.organization_users(organization_id,user_id),
  add constraint tasks_backup_tenant_fkey foreign key (organization_id,backup_user_id) references public.organization_users(organization_id,user_id),
  add constraint tasks_completed_by_tenant_fkey foreign key (organization_id,completed_by) references public.organization_users(organization_id,user_id),
  add constraint tasks_completion_evidence_check check (completion_evidence_sha256 is null or completion_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  add constraint tasks_completion_contract_check check ((status='DONE') = (completed_at is not null and completed_by is not null and completion_evidence_sha256 is not null)) not valid;

alter table public.incidents drop constraint if exists incidents_status_check;
alter table public.incidents
  add column if not exists incident_key text,
  add column if not exists policy_version text not null default 'ENNCO-INCIDENT-2026-08-12-V1',
  add column if not exists ack_due_at timestamptz,
  add column if not exists containment_due_at timestamptz,
  add column if not exists acknowledged_by uuid,
  add column if not exists contained_at timestamptz,
  add column if not exists contained_by uuid,
  add column if not exists recovering_at timestamptz,
  add column if not exists recovering_by uuid,
  add column if not exists monitoring_at timestamptz,
  add column if not exists monitoring_by uuid,
  add column if not exists resolved_by uuid,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid,
  add column if not exists evidence_sha256 text,
  add column if not exists recovery_test_passed boolean not null default false,
  add column if not exists next_update_due_at timestamptz;
alter table public.incidents
  add constraint incidents_status_check check (status in ('OPEN','ACKNOWLEDGED','CONTAINED','RECOVERING','MONITORING','RESOLVED','REVIEWED')),
  add constraint incidents_owner_tenant_fkey foreign key (organization_id,owner_user_id) references public.organization_users(organization_id,user_id),
  add constraint incidents_ack_by_tenant_fkey foreign key (organization_id,acknowledged_by) references public.organization_users(organization_id,user_id),
  add constraint incidents_contained_by_tenant_fkey foreign key (organization_id,contained_by) references public.organization_users(organization_id,user_id),
  add constraint incidents_recovering_by_tenant_fkey foreign key (organization_id,recovering_by) references public.organization_users(organization_id,user_id),
  add constraint incidents_monitoring_by_tenant_fkey foreign key (organization_id,monitoring_by) references public.organization_users(organization_id,user_id),
  add constraint incidents_resolved_by_tenant_fkey foreign key (organization_id,resolved_by) references public.organization_users(organization_id,user_id),
  add constraint incidents_reviewed_by_tenant_fkey foreign key (organization_id,reviewed_by) references public.organization_users(organization_id,user_id),
  add constraint incidents_evidence_check check (evidence_sha256 is null or evidence_sha256 ~ '^[a-f0-9]{64}$');
create unique index incidents_org_key_unique on public.incidents(organization_id,incident_key) where incident_key is not null;

alter table public.meetings
  add column if not exists outcome_status text not null default 'SCHEDULED',
  add column if not exists outcome_recorded_at timestamptz,
  add column if not exists outcome_recorded_by uuid,
  add column if not exists outcome_evidence_sha256 text;
alter table public.meetings
  add constraint meetings_outcome_status_check check (outcome_status in ('SCHEDULED','HELD','NO_SHOW','CANCELLED','RESCHEDULED')),
  add constraint meetings_outcome_actor_tenant_fkey foreign key (organization_id,outcome_recorded_by) references public.organization_users(organization_id,user_id),
  add constraint meetings_outcome_evidence_check check (outcome_evidence_sha256 is null or outcome_evidence_sha256 ~ '^[a-f0-9]{64}$');

create or replace function app.operations_assert_operator(target_organization_id uuid, admin_only boolean default false)
returns void language plpgsql security definer set search_path=public,app,pg_temp as $$
begin
  if admin_only then
    if not app.has_role(target_organization_id,array['ennco_admin'::public.user_role,'teckel_admin'::public.user_role]) then
      raise exception 'OPERATIONS_ADMIN_ROLE_REQUIRED';
    end if;
  elsif not app.has_role(target_organization_id,array['ennco_admin'::public.user_role,'ennco_operator'::public.user_role,'teckel_admin'::public.user_role,'teckel_operator'::public.user_role]) then
    raise exception 'OPERATIONS_OPERATOR_ROLE_REQUIRED';
  end if;
end $$;

create or replace function app.operations_assignment_is_active(target_organization_id uuid)
returns boolean language sql stable security definer set search_path=public,app,pg_temp as $$
  select exists(
    select 1 from public.operational_assignments a
    join public.organization_users primary_member
      on primary_member.organization_id=a.organization_id and primary_member.user_id=a.primary_user_id and primary_member.active
      and primary_member.role in ('ennco_admin','ennco_operator','teckel_admin','teckel_operator')
    join public.organization_users backup_member
      on backup_member.organization_id=a.organization_id and backup_member.user_id=a.backup_user_id and backup_member.active
      and backup_member.role in ('ennco_admin','ennco_operator','teckel_admin','teckel_operator')
    where a.organization_id=target_organization_id and a.status='ACTIVE'
  )
$$;

create or replace function app.operations_command_begin(target_organization_id uuid,target_command_name text,target_idempotency_key text,target_request jsonb)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare expected_sha text; existing public.operational_command_ledger%rowtype;
begin
  if target_idempotency_key !~ '^[a-f0-9]{64}$' then raise exception 'OPERATIONS_IDEMPOTENCY_KEY_INVALID'; end if;
  expected_sha:=encode(digest(target_request::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':'||target_command_name||':'||target_idempotency_key,0));
  select * into existing from public.operational_command_ledger where organization_id=target_organization_id and command_name=target_command_name and idempotency_key=target_idempotency_key for update;
  if found then
    if existing.request_sha256<>expected_sha then raise exception 'OPERATIONS_IDEMPOTENCY_KEY_REUSE_MISMATCH'; end if;
    if existing.response_json is null then raise exception 'OPERATIONS_COMMAND_INCOMPLETE'; end if;
    return existing.response_json||jsonb_build_object('replayed',true);
  end if;
  perform set_config('app.operations_rpc_write','on',true);
  insert into public.operational_command_ledger(organization_id,command_name,idempotency_key,request_sha256,actor_user_id)
  values(target_organization_id,target_command_name,target_idempotency_key,expected_sha,auth.uid());
  return null;
end $$;

create or replace function app.operations_command_finish(target_organization_id uuid,target_command_name text,target_idempotency_key text,target_response jsonb)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
begin
  perform set_config('app.operations_rpc_write','on',true);
  update public.operational_command_ledger set response_json=target_response,completed_at=now()
  where organization_id=target_organization_id and command_name=target_command_name and idempotency_key=target_idempotency_key and response_json is null;
  if not found then raise exception 'OPERATIONS_COMMAND_FINISH_FAILED'; end if;
  return target_response||jsonb_build_object('replayed',false);
end $$;

create or replace function app.operations_business_deadline(target_organization_id uuid,target_start date,target_days integer,target_local_time time default '18:00')
returns timestamptz language plpgsql stable security definer set search_path=public,app,pg_temp as $$
declare deadline_date date;
begin
  if target_days not between 0 and 30 then raise exception 'OPERATIONS_BUSINESS_DAY_COUNT_INVALID'; end if;
  select d.calendar_date into deadline_date from public.reporting_calendar_days d
  where d.organization_id=target_organization_id and d.jurisdiction='MX' and d.evidence_class='live' and d.is_business_day
    and d.calendar_date>=target_start
  order by d.calendar_date offset target_days limit 1;
  if deadline_date is null then raise exception 'OPERATIONS_BUSINESS_CALENDAR_INCOMPLETE'; end if;
  return (deadline_date+target_local_time) at time zone 'America/Mexico_City';
end $$;

create or replace function app.canonical_approval_subject_sha256(
  target_organization_id uuid,target_subject_type text,target_subject_id uuid
) returns text language plpgsql stable security definer set search_path=public,app,pg_temp as $$
declare opportunity_record public.opportunities%rowtype;
begin
  if lower(btrim(target_subject_type))<>'opportunity_closed_won' then return null; end if;
  select * into opportunity_record from public.opportunities
  where organization_id=target_organization_id and id=target_subject_id;
  if not found then raise exception 'APPROVAL_CANONICAL_SUBJECT_NOT_FOUND'; end if;
  if opportunity_record.stage<>'DECISION' then raise exception 'CLOSED_WON_APPROVAL_REQUIRES_DECISION_STAGE'; end if;
  return encode(digest(jsonb_build_object(
    'organization_id',opportunity_record.organization_id,
    'opportunity_id',opportunity_record.id,
    'account_id',opportunity_record.account_id,
    'lead_id',opportunity_record.lead_id,
    'economic_buyer',opportunity_record.economic_buyer,
    'active_pain',opportunity_record.active_pain,
    'business_impact',opportunity_record.business_impact,
    'timing_under_90_days',opportunity_record.timing_under_90_days,
    'value_mxn',opportunity_record.value_mxn,
    'next_action',opportunity_record.next_action,
    'next_action_at',opportunity_record.next_action_at
  )::text,'sha256'),'hex');
end $$;

create or replace function app.request_operational_approval(
  target_organization_id uuid,target_subject_type text,target_subject_id uuid,target_subject_sha256 text,
  target_request_reason text,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; request_id uuid; due_value timestamptz; response jsonb; assignment public.operational_assignments%rowtype; canonical_sha text;
begin
  perform app.operations_assert_operator(target_organization_id,true);
  if target_subject_sha256 !~ '^[a-f0-9]{64}$' or char_length(btrim(coalesce(target_request_reason,''))) not between 3 and 2000 then
    raise exception 'APPROVAL_REQUEST_INPUT_INVALID';
  end if;
  canonical_sha:=app.canonical_approval_subject_sha256(target_organization_id,target_subject_type,target_subject_id);
  if canonical_sha is not null and canonical_sha<>target_subject_sha256 then raise exception 'APPROVAL_CANONICAL_SUBJECT_HASH_MISMATCH'; end if;
  replay:=app.operations_command_begin(target_organization_id,'request_operational_approval',target_idempotency_key,
    jsonb_build_object('subject_type',target_subject_type,'subject_id',target_subject_id,'subject_sha256',target_subject_sha256,'reason',target_request_reason));
  if replay is not null then return replay; end if;
  due_value:=app.operations_business_deadline(target_organization_id,(now() at time zone 'America/Mexico_City')::date,3,'18:00');
  perform set_config('app.operations_rpc_write','on',true);
  update public.approval_requests set status='EXPIRED'
  where organization_id=target_organization_id and subject_type=lower(btrim(target_subject_type))
    and subject_id=target_subject_id and status='PENDING' and due_at<clock_timestamp();
  insert into public.approval_requests(organization_id,subject_type,subject_id,subject_sha256,request_reason,requested_by,due_at,idempotency_key)
  values(target_organization_id,lower(btrim(target_subject_type)),target_subject_id,target_subject_sha256,btrim(target_request_reason),auth.uid(),due_value,target_idempotency_key)
  returning id into request_id;
  select * into assignment from public.operational_assignments where organization_id=target_organization_id and status='ACTIVE'
    and app.operations_assignment_is_active(target_organization_id);
  insert into public.operational_sla_cases(organization_id,case_type,subject_type,subject_id,severity,owner_user_id,backup_user_id,due_at)
  values(target_organization_id,'APPROVAL_DECISION','approval_request',request_id,'P2',assignment.primary_user_id,assignment.backup_user_id,due_value)
  on conflict do nothing;
  insert into public.event_outbox(organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json)
  values(target_organization_id,'approval_request',request_id,'approval.requested','approval-request:'||request_id,
    jsonb_build_object('approval_request_id',request_id,'due_at',due_value)) on conflict do nothing;
  response:=jsonb_build_object('status','PENDING','request_id',request_id,'due_at',due_value,'correlation_id',(select correlation_id from public.approval_requests where id=request_id));
  return app.operations_command_finish(target_organization_id,'request_operational_approval',target_idempotency_key,response);
end $$;

create or replace function app.request_closed_won_approval(
  target_organization_id uuid,target_opportunity_id uuid,target_request_reason text,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare canonical_sha text;
begin
  canonical_sha:=app.canonical_approval_subject_sha256(target_organization_id,'opportunity_closed_won',target_opportunity_id);
  return app.request_operational_approval(
    target_organization_id,'opportunity_closed_won',target_opportunity_id,canonical_sha,target_request_reason,target_idempotency_key
  )||jsonb_build_object('subject_sha256',canonical_sha);
end $$;

create or replace function app.decide_operational_approval(
  target_organization_id uuid,target_request_id uuid,target_subject_sha256 text,target_decision text,
  target_rationale text,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; request_record public.approval_requests%rowtype; approval_id uuid; response jsonb; canonical_sha text;
begin
  perform app.operations_assert_operator(target_organization_id,true);
  if target_decision not in ('APPROVED','REJECTED') or target_subject_sha256 !~ '^[a-f0-9]{64}$' or char_length(btrim(coalesce(target_rationale,''))) not between 3 and 2000 then
    raise exception 'APPROVAL_DECISION_INPUT_INVALID';
  end if;
  replay:=app.operations_command_begin(target_organization_id,'decide_operational_approval',target_idempotency_key,
    jsonb_build_object('request_id',target_request_id,'subject_sha256',target_subject_sha256,'decision',target_decision,'rationale',target_rationale));
  if replay is not null then return replay; end if;
  select * into request_record from public.approval_requests where organization_id=target_organization_id and id=target_request_id for update;
  if not found then raise exception 'APPROVAL_REQUEST_NOT_FOUND'; end if;
  if request_record.status<>'PENDING' then raise exception 'APPROVAL_REQUEST_NOT_PENDING'; end if;
  if request_record.requested_by=auth.uid() then raise exception 'APPROVAL_FOUR_EYES_REQUIRED'; end if;
  if request_record.subject_sha256<>target_subject_sha256 then raise exception 'APPROVAL_SUBJECT_HASH_MISMATCH'; end if;
  canonical_sha:=app.canonical_approval_subject_sha256(target_organization_id,request_record.subject_type,request_record.subject_id);
  if canonical_sha is not null and canonical_sha<>request_record.subject_sha256 then raise exception 'APPROVAL_CANONICAL_SUBJECT_CHANGED'; end if;
  if request_record.due_at<now() then
    perform set_config('app.operations_rpc_write','on',true);
    update public.approval_requests set status='EXPIRED' where id=request_record.id;
    update public.operational_sla_cases set status='BREACHED',breach_recorded_at=now(),updated_at=now()
    where organization_id=target_organization_id and case_type='APPROVAL_DECISION' and subject_id=request_record.id and status='OPEN';
    response:=jsonb_build_object('status','EXPIRED','request_id',request_record.id,'approval_id',null,'correlation_id',request_record.correlation_id);
    return app.operations_command_finish(target_organization_id,'decide_operational_approval',target_idempotency_key,response);
  end if;
  perform set_config('app.operations_rpc_write','on',true);
  update public.approval_requests set status=target_decision,decided_by=auth.uid(),decided_at=now(),rationale=btrim(target_rationale) where id=target_request_id;
  insert into public.approvals(organization_id,subject_type,subject_id,subject_sha256,decision,decided_by,rationale,request_id)
  values(target_organization_id,request_record.subject_type,request_record.subject_id,request_record.subject_sha256,target_decision,auth.uid(),btrim(target_rationale),request_record.id)
  returning id into approval_id;
  update public.operational_sla_cases set status=case when status='BREACHED' or due_at<clock_timestamp() then 'BREACHED' else 'MET' end,
    completed_at=now(),completion_evidence_sha256=target_subject_sha256,
    breach_recorded_at=case when status='BREACHED' or due_at<clock_timestamp() then coalesce(breach_recorded_at,now()) else null end,updated_at=now()
  where organization_id=target_organization_id and case_type='APPROVAL_DECISION' and subject_id=request_record.id and status in ('OPEN','BREACHED');
  insert into public.event_outbox(organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json)
  values(target_organization_id,'approval_request',request_record.id,'approval.decided','approval-decision:'||approval_id,
    jsonb_build_object('approval_request_id',request_record.id,'approval_id',approval_id,'decision',target_decision)) on conflict do nothing;
  response:=jsonb_build_object('status',target_decision,'request_id',request_record.id,'approval_id',approval_id,'correlation_id',request_record.correlation_id);
  return app.operations_command_finish(target_organization_id,'decide_operational_approval',target_idempotency_key,response);
end $$;

create or replace function app.open_meeting_outcome_sla()
returns trigger language plpgsql security definer set search_path=public,app,pg_temp as $$
declare assignment public.operational_assignments%rowtype;
begin
  select * into assignment from public.operational_assignments where organization_id=new.organization_id and status='ACTIVE'
    and app.operations_assignment_is_active(new.organization_id);
  perform set_config('app.operations_rpc_write','on',true);
  insert into public.operational_sla_cases(
    organization_id,case_type,subject_type,subject_id,severity,owner_user_id,backup_user_id,due_at
  ) values (
    new.organization_id,'MEETING_OUTCOME','meeting',new.id,'P2',assignment.primary_user_id,assignment.backup_user_id,new.scheduled_at+interval '24 hours'
  ) on conflict do nothing;
  insert into public.event_outbox(organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json)
  values(new.organization_id,'meeting',new.id,'meeting.outcome_due','meeting-outcome-due:'||new.id,
    jsonb_build_object('meeting_id',new.id,'due_at',new.scheduled_at+interval '24 hours')) on conflict do nothing;
  return new;
end $$;
drop trigger if exists meetings_open_outcome_sla on public.meetings;
create trigger meetings_open_outcome_sla after insert on public.meetings
for each row execute function app.open_meeting_outcome_sla();
select set_config('app.operations_rpc_write','on',true);
insert into public.operational_sla_cases(
  organization_id,case_type,subject_type,subject_id,severity,owner_user_id,backup_user_id,due_at
)
select m.organization_id,'MEETING_OUTCOME','meeting',m.id,'P2',a.primary_user_id,a.backup_user_id,m.scheduled_at+interval '24 hours'
from public.meetings m left join public.operational_assignments a on a.organization_id=m.organization_id and a.status='ACTIVE'
where m.outcome_status='SCHEDULED'
on conflict do nothing;
insert into public.event_outbox(organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json)
select m.organization_id,'meeting',m.id,'meeting.outcome_due','meeting-outcome-due:'||m.id,
  jsonb_build_object('meeting_id',m.id,'due_at',m.scheduled_at+interval '24 hours')
from public.meetings m where m.outcome_status='SCHEDULED'
on conflict do nothing;

create or replace function app.assign_operational_task(
  target_organization_id uuid,target_task_id uuid,target_owner_user_id uuid,target_backup_user_id uuid,
  target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; response jsonb;
begin
  perform app.operations_assert_operator(target_organization_id);
  if target_owner_user_id=target_backup_user_id then raise exception 'TASK_OWNER_BACKUP_MUST_DIFFER'; end if;
  if (select count(*) from public.organization_users where organization_id=target_organization_id
      and user_id in (target_owner_user_id,target_backup_user_id) and active
      and role in ('ennco_admin','ennco_operator','teckel_admin','teckel_operator'))<>2
  then raise exception 'TASK_OPERATIONAL_ASSIGNEES_REQUIRED'; end if;
  replay:=app.operations_command_begin(target_organization_id,'assign_operational_task',target_idempotency_key,
    jsonb_build_object('task_id',target_task_id,'owner_user_id',target_owner_user_id,'backup_user_id',target_backup_user_id));
  if replay is not null then return replay; end if;
  perform set_config('app.operations_rpc_write','on',true);
  update public.tasks set owner_user_id=target_owner_user_id,backup_user_id=target_backup_user_id
  where organization_id=target_organization_id and id=target_task_id and status='OPEN';
  if not found then raise exception 'OPEN_TASK_NOT_FOUND'; end if;
  update public.operational_sla_cases set owner_user_id=target_owner_user_id,backup_user_id=target_backup_user_id,updated_at=now()
  where organization_id=target_organization_id and subject_type='task' and subject_id=target_task_id and status in ('OPEN','BREACHED');
  response:=jsonb_build_object('status','ASSIGNED','task_id',target_task_id,'owner_user_id',target_owner_user_id,'backup_user_id',target_backup_user_id,'correlation_id',coalesce((select correlation_id from public.tasks where id=target_task_id),gen_random_uuid()));
  return app.operations_command_finish(target_organization_id,'assign_operational_task',target_idempotency_key,response);
end $$;

create or replace function app.complete_operational_task_v2(
  target_organization_id uuid,target_task_id uuid,target_completion_evidence_sha256 text,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; task_record public.tasks%rowtype; response jsonb;
begin
  perform app.operations_assert_operator(target_organization_id);
  if target_completion_evidence_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'TASK_COMPLETION_EVIDENCE_INVALID'; end if;
  replay:=app.operations_command_begin(target_organization_id,'complete_operational_task_v2',target_idempotency_key,
    jsonb_build_object('task_id',target_task_id,'evidence_sha256',target_completion_evidence_sha256));
  if replay is not null then return replay; end if;
  select * into task_record from public.tasks where organization_id=target_organization_id and id=target_task_id for update;
  if not found or task_record.status<>'OPEN' then raise exception 'OPEN_TASK_NOT_FOUND'; end if;
  if task_record.owner_user_id is null then raise exception 'TASK_OWNER_REQUIRED'; end if;
  if auth.uid() not in (task_record.owner_user_id,task_record.backup_user_id) and not app.has_role(target_organization_id,array['ennco_admin'::public.user_role,'teckel_admin'::public.user_role]) then
    raise exception 'TASK_ASSIGNEE_REQUIRED';
  end if;
  perform set_config('app.operations_rpc_write','on',true);
  update public.tasks set status='DONE',completed_at=now(),completed_by=auth.uid(),completion_evidence_sha256=target_completion_evidence_sha256 where id=target_task_id;
  update public.operational_sla_cases set status=case when status='BREACHED' or due_at<clock_timestamp() then 'BREACHED' else 'MET' end,
    completed_at=now(),completion_evidence_sha256=target_completion_evidence_sha256,
    breach_recorded_at=case when status='BREACHED' or due_at<clock_timestamp() then coalesce(breach_recorded_at,now()) else null end,updated_at=now()
  where organization_id=target_organization_id and subject_type='task' and subject_id=target_task_id and status in ('OPEN','BREACHED');
  response:=jsonb_build_object('status','DONE','task_id',target_task_id,'correlation_id',coalesce(task_record.correlation_id,gen_random_uuid()));
  return app.operations_command_finish(target_organization_id,'complete_operational_task_v2',target_idempotency_key,response);
end $$;

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
    due_value:=app.operations_business_deadline(target_organization_id,(event_record.observed_at at time zone 'America/Mexico_City')::date,0,'18:00');
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

create or replace function app.record_meeting_outcome_v2(
  target_organization_id uuid,target_meeting_id uuid,target_outcome_status text,target_occurred_at timestamptz,
  target_outcome_notes text,target_evidence_sha256 text,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; meeting_record public.meetings%rowtype; response jsonb;
begin
  perform app.operations_assert_operator(target_organization_id);
  if target_outcome_status not in ('HELD','NO_SHOW','CANCELLED','RESCHEDULED') or target_evidence_sha256 !~ '^[a-f0-9]{64}$'
    or char_length(btrim(coalesce(target_outcome_notes,''))) not between 3 and 10000 then raise exception 'MEETING_OUTCOME_INPUT_INVALID'; end if;
  replay:=app.operations_command_begin(target_organization_id,'record_meeting_outcome_v2',target_idempotency_key,
    jsonb_build_object('meeting_id',target_meeting_id,'outcome_status',target_outcome_status,'occurred_at',target_occurred_at,'notes',target_outcome_notes,'evidence_sha256',target_evidence_sha256));
  if replay is not null then return replay; end if;
  select * into meeting_record from public.meetings where organization_id=target_organization_id and id=target_meeting_id for update;
  if not found then raise exception 'MEETING_NOT_FOUND'; end if;
  if meeting_record.outcome_status<>'SCHEDULED' then raise exception 'MEETING_OUTCOME_ALREADY_RECORDED'; end if;
  if target_occurred_at is null then raise exception 'MEETING_OUTCOME_TIME_REQUIRED'; end if;
  if target_occurred_at>clock_timestamp()+interval '5 minutes' then raise exception 'MEETING_OUTCOME_FUTURE_INVALID'; end if;
  if target_outcome_status in ('HELD','NO_SHOW') and target_occurred_at<meeting_record.scheduled_at then
    raise exception 'MEETING_OUTCOME_BEFORE_SCHEDULE_INVALID';
  end if;
  perform set_config('app.operations_rpc_write','on',true);
  update public.meetings set outcome_status=target_outcome_status,outcome_recorded_at=now(),outcome_recorded_by=auth.uid(),
    outcome_evidence_sha256=target_evidence_sha256,outcome_notes=btrim(target_outcome_notes),
    held_at=case when target_outcome_status='HELD' then target_occurred_at else null end,
    attendance_verified=(target_outcome_status='HELD') where id=target_meeting_id;
  if target_outcome_status='HELD' then
    update public.opportunities set stage='DISCOVERY_HELD',updated_at=now()
    where organization_id=target_organization_id and id=meeting_record.opportunity_id and stage='MEETING_CONFIRMED';
  end if;
  update public.operational_sla_cases set status=case when status='BREACHED' or due_at<clock_timestamp() then 'BREACHED' else 'MET' end,
    completed_at=now(),completion_evidence_sha256=target_evidence_sha256,
    breach_recorded_at=case when status='BREACHED' or due_at<clock_timestamp() then coalesce(breach_recorded_at,now()) else null end,updated_at=now()
  where organization_id=target_organization_id and case_type='MEETING_OUTCOME' and subject_id=target_meeting_id and status in ('OPEN','BREACHED');
  response:=jsonb_build_object('status','RECORDED','meeting_id',target_meeting_id,'outcome_status',target_outcome_status,
    'opportunity_id',meeting_record.opportunity_id,'correlation_id',gen_random_uuid());
  return app.operations_command_finish(target_organization_id,'record_meeting_outcome_v2',target_idempotency_key,response);
end $$;

create or replace function app.open_operational_incident(
  target_organization_id uuid,target_incident_key text,target_severity public.incident_severity,target_title text,target_correlation_id uuid default null
) returns uuid language plpgsql security definer set search_path=public,app,pg_temp as $$
declare incident_id uuid; existing_incident public.incidents%rowtype; outbox_id uuid; ack_deadline timestamptz; containment_deadline timestamptz; assignment public.operational_assignments%rowtype;
begin
  if current_user<>'service_role'
    and not pg_has_role(current_user,'pg_database_owner','USAGE')
    and coalesce(current_setting('app.operations_watchdog',true),'off')<>'on'
  then raise exception 'INCIDENT_SERVICE_ROLE_REQUIRED'; end if;
  if char_length(btrim(coalesce(target_incident_key,''))) not between 3 and 300 or char_length(btrim(coalesce(target_title,''))) not between 3 and 500 then raise exception 'INCIDENT_INPUT_INVALID'; end if;
  ack_deadline:=now()+case when target_severity='P0' then interval '15 minutes' else interval '60 minutes' end;
  containment_deadline:=now()+case when target_severity='P0' then interval '30 minutes' when target_severity='P1' then interval '60 minutes' else interval '1 day' end;
  select * into assignment from public.operational_assignments where organization_id=target_organization_id and status='ACTIVE'
    and app.operations_assignment_is_active(target_organization_id);
  perform set_config('app.operations_rpc_write','on',true);
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':incident:'||target_incident_key,0));
  select * into existing_incident from public.incidents
  where organization_id=target_organization_id and incident_key=target_incident_key for update;
  if found and existing_incident.status not in ('RESOLVED','REVIEWED') then return existing_incident.id; end if;
  if found then
    update public.incidents set incident_key=target_incident_key||':superseded:'||id::text where id=existing_incident.id;
  end if;
  insert into public.incidents(organization_id,severity,title,status,correlation_id,owner_user_id,incident_key,ack_due_at,containment_due_at,next_update_due_at)
  values(target_organization_id,target_severity,btrim(target_title),'OPEN',target_correlation_id,assignment.primary_user_id,target_incident_key,ack_deadline,containment_deadline,ack_deadline)
  returning id into incident_id;
  insert into public.operational_sla_cases(organization_id,case_type,subject_type,subject_id,severity,owner_user_id,backup_user_id,due_at)
  values(target_organization_id,'INCIDENT_ACK','incident',incident_id,target_severity,assignment.primary_user_id,assignment.backup_user_id,ack_deadline)
  on conflict do nothing;
  insert into public.event_outbox(organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json)
  values(target_organization_id,'incident',incident_id,'incident.opened','incident-opened:'||incident_id,
    jsonb_build_object('incident_id',incident_id,'severity',target_severity,'ack_due_at',ack_deadline,'required_audiences',jsonb_build_array('CLIENT','TECKEL')))
  returning id into outbox_id;
  if target_severity in ('P0','P1') then
    insert into public.incident_alert_requirements(organization_id,incident_id,outbox_event_id,audience,required_channel) values
      (target_organization_id,incident_id,outbox_id,'CLIENT','EMAIL'),
      (target_organization_id,incident_id,outbox_id,'TECKEL','TELEGRAM');
  end if;
  if target_severity='P0' then
    update public.runtime_controls set global_kill_switch=true,external_send_allowed=false,updated_at=now()
    where organization_id=target_organization_id;
  end if;
  return incident_id;
end $$;

create or replace function app.transition_operational_incident(
  target_organization_id uuid,target_incident_id uuid,target_action text,target_evidence_sha256 text,
  target_detail text,target_recovery_test_passed boolean,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; incident_record public.incidents%rowtype; next_status text; response jsonb;
begin
  perform app.operations_assert_operator(target_organization_id);
  if target_action not in ('ACKNOWLEDGE','CONTAIN','RECOVER','MONITOR','RESOLVE','REVIEW') or target_evidence_sha256 !~ '^[a-f0-9]{64}$'
    or char_length(btrim(coalesce(target_detail,''))) not between 3 and 4000 then raise exception 'INCIDENT_TRANSITION_INPUT_INVALID'; end if;
  replay:=app.operations_command_begin(target_organization_id,'transition_operational_incident',target_idempotency_key,
    jsonb_build_object('incident_id',target_incident_id,'action',target_action,'evidence_sha256',target_evidence_sha256,'detail',target_detail,'recovery_test_passed',target_recovery_test_passed));
  if replay is not null then return replay; end if;
  select * into incident_record from public.incidents where organization_id=target_organization_id and id=target_incident_id for update;
  if not found then raise exception 'INCIDENT_NOT_FOUND'; end if;
  next_status:=case
    when target_action='ACKNOWLEDGE' and incident_record.status='OPEN' then 'ACKNOWLEDGED'
    when target_action='CONTAIN' and incident_record.status='ACKNOWLEDGED' then 'CONTAINED'
    when target_action='RECOVER' and incident_record.status='CONTAINED' then 'RECOVERING'
    when target_action='MONITOR' and incident_record.status='RECOVERING' then 'MONITORING'
    when target_action='RESOLVE' and incident_record.status='MONITORING' and target_recovery_test_passed then 'RESOLVED'
    when target_action='REVIEW' and incident_record.status='RESOLVED' then 'REVIEWED'
    else null end;
  if next_status is null then raise exception 'INCIDENT_TRANSITION_INVALID'; end if;
  perform set_config('app.operations_rpc_write','on',true);
  update public.incidents set status=next_status,owner_user_id=coalesce(owner_user_id,auth.uid()),evidence_sha256=target_evidence_sha256,
    acknowledged_at=case when next_status='ACKNOWLEDGED' then now() else acknowledged_at end,
    acknowledged_by=case when next_status='ACKNOWLEDGED' then auth.uid() else acknowledged_by end,
    contained_at=case when next_status='CONTAINED' then now() else contained_at end,
    contained_by=case when next_status='CONTAINED' then auth.uid() else contained_by end,
    recovering_at=case when next_status='RECOVERING' then now() else recovering_at end,
    recovering_by=case when next_status='RECOVERING' then auth.uid() else recovering_by end,
    monitoring_at=case when next_status='MONITORING' then now() else monitoring_at end,
    monitoring_by=case when next_status='MONITORING' then auth.uid() else monitoring_by end,
    resolved_at=case when next_status='RESOLVED' then now() else resolved_at end,
    resolved_by=case when next_status='RESOLVED' then auth.uid() else resolved_by end,
    reviewed_at=case when next_status='REVIEWED' then now() else reviewed_at end,
    reviewed_by=case when next_status='REVIEWED' then auth.uid() else reviewed_by end,
    root_cause=case when next_status='RESOLVED' then btrim(target_detail) else root_cause end,
    resolution=case when next_status in ('CONTAINED','RECOVERING','MONITORING','RESOLVED') then btrim(target_detail) else resolution end,
    recovery_test_passed=case when next_status='RESOLVED' then true else recovery_test_passed end,
    next_update_due_at=case when next_status in ('RESOLVED','REVIEWED') then null else now()+interval '60 minutes' end
  where id=target_incident_id;
  if next_status='ACKNOWLEDGED' then
    update public.operational_sla_cases set status=case when status='BREACHED' or due_at<clock_timestamp() then 'BREACHED' else 'MET' end,
      completed_at=now(),completion_evidence_sha256=target_evidence_sha256,
      breach_recorded_at=case when status='BREACHED' or due_at<clock_timestamp() then coalesce(breach_recorded_at,now()) else null end,updated_at=now()
    where organization_id=target_organization_id and case_type='INCIDENT_ACK' and subject_id=target_incident_id and status in ('OPEN','BREACHED');
    insert into public.operational_sla_cases(organization_id,case_type,subject_type,subject_id,severity,owner_user_id,due_at)
    values(target_organization_id,'INCIDENT_CONTAINMENT','incident',target_incident_id,incident_record.severity,auth.uid(),incident_record.containment_due_at)
    on conflict do nothing;
  elsif next_status='CONTAINED' then
    update public.operational_sla_cases set status=case when status='BREACHED' or due_at<clock_timestamp() then 'BREACHED' else 'MET' end,
      completed_at=now(),completion_evidence_sha256=target_evidence_sha256,
      breach_recorded_at=case when status='BREACHED' or due_at<clock_timestamp() then coalesce(breach_recorded_at,now()) else null end,updated_at=now()
    where organization_id=target_organization_id and case_type='INCIDENT_CONTAINMENT' and subject_id=target_incident_id and status in ('OPEN','BREACHED');
  end if;
  insert into public.event_outbox(organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json)
  values(target_organization_id,'incident',target_incident_id,'incident.'||lower(next_status),'incident:'||target_incident_id||':'||lower(next_status),
    jsonb_build_object('incident_id',target_incident_id,'status',next_status)) on conflict do nothing;
  response:=jsonb_build_object('status',next_status,'incident_id',target_incident_id,'correlation_id',coalesce(incident_record.correlation_id,gen_random_uuid()));
  return app.operations_command_finish(target_organization_id,'transition_operational_incident',target_idempotency_key,response);
end $$;

create or replace function app.run_operations_watchdog(
  target_organization_id uuid,target_evaluated_at timestamptz,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; finding record; findings integer:=0; created_count integer:=0; incident_id uuid; response jsonb; run_status text:='HEALTHY'; before_count integer;
begin
  if current_user<>'service_role' and not pg_has_role(current_user,'pg_database_owner','USAGE') then raise exception 'WATCHDOG_SERVICE_ROLE_REQUIRED'; end if;
  if target_evaluated_at>now()+interval '5 minutes' or target_evaluated_at<now()-interval '1 day' then raise exception 'WATCHDOG_TIME_INVALID'; end if;
  replay:=app.operations_command_begin(target_organization_id,'run_operations_watchdog',target_idempotency_key,
    jsonb_build_object('evaluated_at',target_evaluated_at));
  if replay is not null then return replay; end if;
  perform set_config('app.operations_watchdog','on',true);

  for finding in
    select 'cursor:'||c.mailbox_id::text as finding_key,'P1'::public.incident_severity as severity,'Sincronización de respuestas vencida' as title
    from public.mailbox_sync_cursors c where c.organization_id=target_organization_id
      and (c.status='ERROR' or c.last_synced_at is null or c.last_synced_at<target_evaluated_at-interval '5 minutes' or c.watch_expires_at is null or c.watch_expires_at<=target_evaluated_at)
    union all
    select 'outbox:'||o.id::text,'P1'::public.incident_severity,'Evento de outbox detenido'
    from public.event_outbox o where o.organization_id=target_organization_id and o.status in ('PENDING','PROCESSING','FAILED')
      and coalesce(o.locked_at,o.created_at)<target_evaluated_at-interval '120 seconds'
    union all
    select 'dead-letter:'||d.id::text,'P1'::public.incident_severity,'Dead letter sin resolver'
    from public.dead_letters d where d.organization_id=target_organization_id and d.resolved_at is null
    union all
    select 'alert-delivery:'||o.id::text,'P0'::public.incident_severity,'Alerta P0 sin entrega en dos minutos'
    from public.event_outbox o join public.incidents i on i.organization_id=o.organization_id and i.id=o.aggregate_id
    where o.organization_id=target_organization_id and o.event_type='incident.opened'
      and o.created_at<target_evaluated_at-interval '2 minutes'
      and i.severity='P0' and coalesce(i.incident_key,'') not like 'alert-delivery:%'
      and exists(
        select 1 from public.incident_alert_requirements r
        where r.organization_id=o.organization_id and r.outbox_event_id=o.id
          and not exists(
            select 1 from public.notification_deliveries n
            where n.organization_id=r.organization_id and n.outbox_event_id=r.outbox_event_id
              and r.required_destination_hash is not null
              and n.channel=r.required_channel and n.destination_hash=r.required_destination_hash and n.status='DELIVERED'
          )
      )
    union all
    select 'sla:'||s.id::text,s.severity,'SLA operativo vencido: '||s.case_type
    from public.operational_sla_cases s where s.organization_id=target_organization_id and s.status='OPEN' and s.due_at<target_evaluated_at
    union all
    select 'meeting:'||m.id::text,'P2'::public.incident_severity,'Resultado de reunión sin registrar en 24 horas'
    from public.meetings m where m.organization_id=target_organization_id and m.outcome_status='SCHEDULED' and m.scheduled_at+interval '24 hours'<target_evaluated_at
  loop
    findings:=findings+1;
    select count(*) into before_count from public.incidents where organization_id=target_organization_id and incident_key=finding.finding_key;
    incident_id:=app.open_operational_incident(target_organization_id,finding.finding_key,finding.severity,finding.title,null);
    if before_count=0 then created_count:=created_count+1; end if;
  end loop;

  perform set_config('app.operations_rpc_write','on',true);
  update public.operational_sla_cases set status='BREACHED',breach_recorded_at=target_evaluated_at,updated_at=target_evaluated_at
  where organization_id=target_organization_id and status='OPEN' and due_at<target_evaluated_at;

  if exists(select 1 from public.incidents where organization_id=target_organization_id and severity='P0' and status='OPEN' and ack_due_at<target_evaluated_at) then
    update public.runtime_controls set global_kill_switch=true,external_send_allowed=false,updated_at=target_evaluated_at where organization_id=target_organization_id;
    insert into public.event_outbox(organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json)
    select target_organization_id,'incident',i.id,'incident.p0_ack_sla_breached','incident-p0-escalation:'||i.id,
      jsonb_build_object('incident_id',i.id,'kill_switch',true)
    from public.incidents i where i.organization_id=target_organization_id and i.severity='P0' and i.status='OPEN' and i.ack_due_at<target_evaluated_at
    on conflict do nothing;
  end if;

  if findings>0 then run_status:='DEGRADED'; end if;
  insert into public.operations_watchdog_runs(organization_id,evaluated_at,status,findings_count,incidents_created,idempotency_key)
  values(target_organization_id,target_evaluated_at,run_status,findings,created_count,target_idempotency_key);
  response:=jsonb_build_object('status',run_status,'watchdog_run_id',(select id from public.operations_watchdog_runs where organization_id=target_organization_id and idempotency_key=target_idempotency_key),
    'evaluated_at',target_evaluated_at,'findings_count',findings,'incidents_created',created_count,'correlation_id',gen_random_uuid());
  return app.operations_command_finish(target_organization_id,'run_operations_watchdog',target_idempotency_key,response);
end $$;

create or replace function app.evaluate_operations_health(target_organization_id uuid,target_evaluated_at timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
declare latest public.operations_watchdog_runs%rowtype; open_p0 integer; open_p1 integer; state text; reason text;
begin
  if not app.is_member(target_organization_id) then raise exception 'OPERATIONS_MEMBER_REQUIRED'; end if;
  select * into latest from public.operations_watchdog_runs where organization_id=target_organization_id order by evaluated_at desc limit 1;
  select count(*) filter(where severity='P0'),count(*) filter(where severity='P1') into open_p0,open_p1
  from public.incidents where organization_id=target_organization_id and status not in ('RESOLVED','REVIEWED');
  if latest.id is null then state:='UNKNOWN'; reason:='WATCHDOG_NEVER_RAN';
  elsif latest.evaluated_at<target_evaluated_at-interval '5 minutes' then state:='UNKNOWN'; reason:='WATCHDOG_HEARTBEAT_STALE';
  elsif not app.operations_assignment_is_active(target_organization_id) then state:='UNKNOWN'; reason:='OPERATOR_ASSIGNMENT_UNKNOWN';
  elsif latest.status<>'HEALTHY' or open_p0>0 or open_p1>0 then state:='DEGRADED'; reason:='OPEN_OPERATIONAL_FINDINGS';
  else state:='HEALTHY'; reason:=null; end if;
  return jsonb_build_object('status','READ_ONLY','state',state,'reason_code',reason,'evaluated_at',target_evaluated_at,
    'last_watchdog_at',latest.evaluated_at,'open_p0',open_p0,'open_p1',open_p1,
    'operator_assignment',case when app.operations_assignment_is_active(target_organization_id) then 'ACTIVE' else 'UNKNOWN' end);
end $$;

create or replace function app.enforce_operations_send_health()
returns trigger language plpgsql security definer set search_path=public,app,pg_temp as $$
declare latest public.operations_watchdog_runs%rowtype;
begin
  if new.direction<>'OUTBOUND' or new.status='DRY_RUN' or (tg_op='UPDATE' and new.status is not distinct from old.status) then return new; end if;
  select * into latest from public.operations_watchdog_runs
  where organization_id=new.organization_id order by evaluated_at desc limit 1;
  if latest.id is null or latest.evaluated_at<clock_timestamp()-interval '5 minutes' or latest.status<>'HEALTHY' then
    raise exception 'OPERATIONS_HEALTH_NOT_HEALTHY';
  end if;
  if not app.operations_assignment_is_active(new.organization_id) then
    raise exception 'OPERATIONS_ASSIGNMENT_NOT_ACTIVE';
  end if;
  if exists(select 1 from public.incidents where organization_id=new.organization_id and severity in ('P0','P1') and status not in ('RESOLVED','REVIEWED')) then
    raise exception 'OPERATIONS_INCIDENT_SEND_HOLD';
  end if;
  return new;
end $$;
drop trigger if exists messages_operations_send_health on public.messages;
create trigger messages_operations_send_health before insert or update of status on public.messages
for each row execute function app.enforce_operations_send_health();

create or replace function app.enforce_canonical_closed_won_approval()
returns trigger language plpgsql set search_path=public,app,pg_temp as $$
declare current_sha text;
begin
  current_sha:=encode(digest(jsonb_build_object(
    'organization_id',new.organization_id,'opportunity_id',new.id,'account_id',new.account_id,'lead_id',new.lead_id,
    'economic_buyer',new.economic_buyer,'active_pain',new.active_pain,'business_impact',new.business_impact,
    'timing_under_90_days',new.timing_under_90_days,'value_mxn',new.value_mxn,
    'next_action',new.next_action,'next_action_at',new.next_action_at
  )::text,'sha256'),'hex');
  if new.stage='CLOSED_WON' and old.stage is distinct from new.stage and not exists(
    select 1 from public.approvals a join public.approval_requests r on r.organization_id=a.organization_id and r.id=a.request_id
    where a.organization_id=new.organization_id and a.subject_type='opportunity_closed_won' and a.subject_id=new.id and a.decision='APPROVED'
      and r.status='APPROVED' and r.subject_sha256=a.subject_sha256 and r.subject_sha256=current_sha and r.due_at>=r.decided_at
  ) then raise exception 'CLOSED_WON_REQUIRES_CANONICAL_APPROVAL'; end if;
  return new;
end $$;
drop trigger if exists opportunities_canonical_closed_won_approval on public.opportunities;
create trigger opportunities_canonical_closed_won_approval before update of stage on public.opportunities
for each row execute function app.enforce_canonical_closed_won_approval();

create or replace function app.prevent_operations_control_direct_write()
returns trigger language plpgsql set search_path=public,app,pg_temp as $$
begin
  if coalesce(current_setting('app.operations_rpc_write',true),'off')<>'on'
    and coalesce(current_setting('app.operations_watchdog',true),'off')<>'on' then
    raise exception 'OPERATIONS_CONTROL_RPC_REQUIRED';
  end if;
  return coalesce(new,old);
end $$;

do $$ declare table_name text; begin
  foreach table_name in array array['operational_assignments','operational_command_ledger','approval_requests','operational_sla_cases','operations_watchdog_runs','incident_alert_requirements'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('drop policy if exists %I_member_read on public.%I',table_name,table_name);
    execute format('create policy %I_member_read on public.%I for select using (app.is_member(organization_id))',table_name,table_name);
    execute format('create trigger %I_rpc_guard before insert or update or delete on public.%I for each row execute function app.prevent_operations_control_direct_write()',table_name,table_name);
  end loop;
end $$;

do $$ declare table_name text; begin
  foreach table_name in array array['operational_assignments','approval_requests','operational_sla_cases','operations_watchdog_runs','incident_alert_requirements'] loop
    execute format('drop trigger if exists %I_operations_audit on public.%I',table_name,table_name);
    execute format('create trigger %I_operations_audit after insert or update or delete on public.%I for each row execute function app.capture_audit_event()',table_name,table_name);
  end loop;
end $$;

drop policy if exists approvals_operator_write on public.approvals;
drop policy if exists incidents_operator_write on public.incidents;
drop policy if exists tasks_operator_write on public.tasks;
drop policy if exists roadmap_milestones_operator_write on public.roadmap_milestones;
drop policy if exists meetings_operator_write on public.meetings;
drop policy if exists provider_events_operator_write on public.provider_events;
drop policy if exists event_outbox_technical_write on public.event_outbox;
drop policy if exists notification_deliveries_technical_write on public.notification_deliveries;
revoke insert,update,delete,truncate on public.approvals,public.incidents,public.tasks,public.roadmap_milestones,public.meetings,public.provider_events from authenticated;
revoke insert,update,delete,truncate on public.event_outbox,public.notification_deliveries from authenticated;
revoke insert,update,delete,truncate on public.operational_assignments,public.operational_command_ledger,public.approval_requests,public.operational_sla_cases,public.operations_watchdog_runs,public.incident_alert_requirements from authenticated;
grant select on public.operational_assignments,public.approval_requests,public.operational_sla_cases,public.operations_watchdog_runs,public.incident_alert_requirements to authenticated;

create or replace function public.request_operational_approval(uuid,text,uuid,text,text,text) returns jsonb
language sql security definer set search_path=app,public,pg_temp as $$ select app.request_operational_approval($1,$2,$3,$4,$5,$6) $$;
create or replace function public.request_closed_won_approval(uuid,uuid,text,text) returns jsonb
language sql security definer set search_path=app,public,pg_temp as $$ select app.request_closed_won_approval($1,$2,$3,$4) $$;
create or replace function public.decide_operational_approval(uuid,uuid,text,text,text,text) returns jsonb
language sql security definer set search_path=app,public,pg_temp as $$ select app.decide_operational_approval($1,$2,$3,$4,$5,$6) $$;
create or replace function public.assign_operational_task(uuid,uuid,uuid,uuid,text) returns jsonb
language sql security definer set search_path=app,public,pg_temp as $$ select app.assign_operational_task($1,$2,$3,$4,$5) $$;
create or replace function public.complete_operational_task_v2(uuid,uuid,text,text) returns jsonb
language sql security definer set search_path=app,public,pg_temp as $$ select app.complete_operational_task_v2($1,$2,$3,$4) $$;
create or replace function public.review_reply_and_route(uuid,uuid,public.reply_classification,text) returns jsonb
language sql security definer set search_path=app,public,pg_temp as $$ select app.review_reply_and_route($1,$2,$3,$4) $$;
create or replace function public.record_meeting_outcome_v2(uuid,uuid,text,timestamptz,text,text,text) returns jsonb
language sql security definer set search_path=app,public,pg_temp as $$ select app.record_meeting_outcome_v2($1,$2,$3,$4,$5,$6,$7) $$;
create or replace function public.transition_operational_incident(uuid,uuid,text,text,text,boolean,text) returns jsonb
language sql security definer set search_path=app,public,pg_temp as $$ select app.transition_operational_incident($1,$2,$3,$4,$5,$6,$7) $$;
create or replace function public.evaluate_operations_health(uuid,timestamptz) returns jsonb
language sql security definer set search_path=app,public,pg_temp as $$ select app.evaluate_operations_health($1,$2) $$;

revoke all on function app.operations_assert_operator(uuid,boolean) from public,authenticated;
revoke all on function app.operations_assignment_is_active(uuid) from public,authenticated;
revoke all on function app.operations_command_begin(uuid,text,text,jsonb) from public,authenticated;
revoke all on function app.operations_command_finish(uuid,text,text,jsonb) from public,authenticated;
revoke all on function app.operations_business_deadline(uuid,date,integer,time) from public,authenticated;
revoke all on function app.canonical_approval_subject_sha256(uuid,text,uuid) from public,authenticated;
revoke all on function app.request_operational_approval(uuid,text,uuid,text,text,text) from public,authenticated;
revoke all on function app.request_closed_won_approval(uuid,uuid,text,text) from public,authenticated;
revoke all on function app.decide_operational_approval(uuid,uuid,text,text,text,text) from public,authenticated;
revoke all on function app.assign_operational_task(uuid,uuid,uuid,uuid,text) from public,authenticated;
revoke all on function app.complete_operational_task_v2(uuid,uuid,text,text) from public,authenticated;
revoke all on function app.review_reply_and_route(uuid,uuid,public.reply_classification,text) from public,authenticated;
revoke all on function app.record_meeting_outcome_v2(uuid,uuid,text,timestamptz,text,text,text) from public,authenticated;
revoke all on function app.open_operational_incident(uuid,text,public.incident_severity,text,uuid) from public,authenticated;
revoke all on function app.transition_operational_incident(uuid,uuid,text,text,text,boolean,text) from public,authenticated;
revoke all on function app.run_operations_watchdog(uuid,timestamptz,text) from public,authenticated;
revoke all on function app.evaluate_operations_health(uuid,timestamptz) from public,authenticated;
revoke all on function app.enforce_operations_send_health() from public,authenticated;
revoke all on function app.open_meeting_outcome_sla() from public,authenticated;
revoke all on function app.enforce_canonical_closed_won_approval() from public,authenticated;
revoke all on function app.prevent_operations_control_direct_write() from public,authenticated;

revoke all on function public.request_operational_approval(uuid,text,uuid,text,text,text) from public;
revoke all on function public.request_closed_won_approval(uuid,uuid,text,text) from public;
revoke all on function public.decide_operational_approval(uuid,uuid,text,text,text,text) from public;
revoke all on function public.assign_operational_task(uuid,uuid,uuid,uuid,text) from public;
revoke all on function public.complete_operational_task_v2(uuid,uuid,text,text) from public;
revoke all on function public.review_reply_and_route(uuid,uuid,public.reply_classification,text) from public;
revoke all on function public.record_meeting_outcome_v2(uuid,uuid,text,timestamptz,text,text,text) from public;
revoke all on function public.transition_operational_incident(uuid,uuid,text,text,text,boolean,text) from public;
revoke all on function public.evaluate_operations_health(uuid,timestamptz) from public;

revoke all on function app.complete_operational_task(uuid,uuid) from authenticated;
revoke all on function app.record_meeting_outcome(uuid,uuid,timestamptz,boolean,text) from authenticated;
revoke all on function app.review_reply_event(uuid,uuid,public.reply_classification) from authenticated;
revoke all on function app.open_operational_incident(uuid,text,public.incident_severity,text,uuid) from public,authenticated;
revoke all on function app.run_operations_watchdog(uuid,timestamptz,text) from public,authenticated;

grant execute on function public.request_operational_approval(uuid,text,uuid,text,text,text) to authenticated;
grant execute on function public.request_closed_won_approval(uuid,uuid,text,text) to authenticated;
grant execute on function public.decide_operational_approval(uuid,uuid,text,text,text,text) to authenticated;
grant execute on function public.assign_operational_task(uuid,uuid,uuid,uuid,text) to authenticated;
grant execute on function public.complete_operational_task_v2(uuid,uuid,text,text) to authenticated;
grant execute on function public.review_reply_and_route(uuid,uuid,public.reply_classification,text) to authenticated;
grant execute on function public.record_meeting_outcome_v2(uuid,uuid,text,timestamptz,text,text,text) to authenticated;
grant execute on function public.transition_operational_incident(uuid,uuid,text,text,text,boolean,text) to authenticated;
grant execute on function public.evaluate_operations_health(uuid,timestamptz) to authenticated;

do $$ begin
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant execute on function app.run_operations_watchdog(uuid,timestamptz,text) to service_role;
    grant select,insert,update on public.operational_command_ledger,public.operational_sla_cases,public.operations_watchdog_runs to service_role;
  end if;
end $$;

commit;
