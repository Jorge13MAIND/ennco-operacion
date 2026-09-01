-- LIMITACION CONOCIDA (documentada 30-ago, precisada 31-ago-2026): esta prueba
-- solo corre los dias 1 a 28 del mes. Usa `extract(day from current_date)` como
-- day_of_month de EXECUTIVE_MONTHLY_REVIEW, y la tabla restringe ese campo a
-- 1..28 para que la fecha exista en todos los meses. Los dias 29, 30 y 31 falla
-- en el insert.
--
-- OJO con la zona horaria: `current_date` usa la del sistema donde corre el
-- Postgres efimero, no UTC. En una Mac en CDMX el gate puede fallar aunque en
-- UTC ya sea dia 1, porque localmente sigue siendo 31. Verificado el 31-ago a
-- las 20:29 CDMX / 02:29 UTC del 1-sep.
-- Acotar con least(...,28) NO sirve: el reconciliador necesita que la
-- ocurrencia mensual caiga en el dia de hoy para generarla, asi que el gate
-- pasa a fallar mas adelante con OCCURRENCE_COVERAGE_INCOMPLETE.
-- El arreglo real es darle a la prueba un reloj propio en vez de current_date.

\set ON_ERROR_STOP on
set timezone='America/Mexico_City';

insert into public.organizations(id,slug,legal_name) values
('22000000-0000-4000-8000-000000000001','m022-a','M022 Synthetic A'),
('22000000-0000-4000-8000-000000000002','m022-b','M022 Synthetic B'),
('22000000-0000-4000-8000-000000000003','m022-no-policy','M022 Synthetic No Policy');
insert into public.organization_users(organization_id,user_id,role) values
('22000000-0000-4000-8000-000000000001','22010000-0000-4000-8000-000000000001','ennco_admin'),
('22000000-0000-4000-8000-000000000001','22010000-0000-4000-8000-000000000002','teckel_admin'),
('22000000-0000-4000-8000-000000000001','22010000-0000-4000-8000-000000000003','ennco_operator'),
('22000000-0000-4000-8000-000000000001','22010000-0000-4000-8000-000000000004','teckel_operator'),
('22000000-0000-4000-8000-000000000002','22010000-0000-4000-8000-000000000005','ennco_admin');
insert into public.runtime_controls(organization_id,global_kill_switch,external_send_allowed) values
('22000000-0000-4000-8000-000000000001',false,true),('22000000-0000-4000-8000-000000000002',true,false);
select set_config('app.operations_rpc_write','on',false);
insert into public.operational_assignments(organization_id,primary_user_id,backup_user_id,status,source_reference,configured_by,configured_at)
values('22000000-0000-4000-8000-000000000001','22010000-0000-4000-8000-000000000003','22010000-0000-4000-8000-000000000002','ACTIVE','synthetic m022','22010000-0000-4000-8000-000000000001',clock_timestamp());
select set_config('app.operations_rpc_write','off',false);

create temporary table m022_commercial_before as select
  (select count(*) from public.leads) leads,
  (select count(*) from public.opportunities) opportunities,
  (select count(*) from public.proposals) proposals,
  (select count(*) from public.payments) payments,
  (select count(*) from public.commissions) commissions;

do $$ begin
  if (select array_agg(x order by x) from (
    select distinct unnest(regexp_matches(pg_get_constraintdef(oid),'(CONTROL_ROOM_DAILY_UPDATE|INTERNAL_DAILY_REVIEW|STAGING_WEEKLY_DEMO|ENNCO_TECKEL_WEEKLY_MEETING|EXECUTIVE_MONTHLY_REVIEW)','g')) x
    from pg_constraint where conrelid='public.control_cadence_policy_items'::regclass and contype='c'
  ) s) is null then raise exception 'M022_CANONICAL_CODE_CONSTRAINT_MISSING'; end if;
  if to_regprocedure('public.evaluate_control_cadence_health(uuid,timestamptz)') is null then raise exception 'M022_READ_RPC_MISSING'; end if;
end $$;

set request.jwt.claim.sub='22010000-0000-4000-8000-000000000001';
set request.jwt.claim.aal='aal2';
set role authenticated;
select public.create_control_cadence_policy(
  '22000000-0000-4000-8000-000000000001',1,'live',60,
  jsonb_build_array(jsonb_build_object('code','CONTROL_ROOM_DAILY_UPDATE','config_state','UNKNOWN')),
  repeat('1',64)
);
do $$ declare policy_id uuid; begin
  select id into policy_id from public.control_cadence_policy_versions where organization_id='22000000-0000-4000-8000-000000000001' and version=1;
  begin perform public.activate_control_cadence_policy('22000000-0000-4000-8000-000000000001',policy_id,repeat('2',64),repeat('2',64));
    raise exception 'M022_INCOMPLETE_POLICY_ACTIVATED'; exception when others then if sqlerrm='M022_INCOMPLETE_POLICY_ACTIVATED' then raise; end if; end;
  begin perform public.create_control_cadence_policy(
    '22000000-0000-4000-8000-000000000001',2,'live',60,
    jsonb_build_array(
      jsonb_build_object('code','ENNCO_TECKEL_WEEKLY_MEETING','config_state','VERIFIED','owner_user_id','22010000-0000-4000-8000-000000000001','local_time','00:01:00','day_of_week',extract(isodow from current_date)::integer,'duration_minutes',30,'due_offset_minutes',1440,'requires_checklist',true,'requires_delivery',false,'delivery_channels',jsonb_build_array(),'config_evidence_sha256',repeat('3',64))
    ),repeat('3',64));
    raise exception 'M022_NON_45_MEETING_CREATED'; exception when others then if sqlerrm='M022_NON_45_MEETING_CREATED' then raise; end if; end;
end $$;

select public.create_control_cadence_policy(
  '22000000-0000-4000-8000-000000000001',3,'live',60,
  jsonb_build_array(
    jsonb_build_object('code','CONTROL_ROOM_DAILY_UPDATE','config_state','VERIFIED','owner_user_id','22010000-0000-4000-8000-000000000003','local_time','00:01:00','duration_minutes',30,'due_offset_minutes',1440,'requires_checklist',false,'requires_delivery',false,'delivery_channels',jsonb_build_array(),'config_evidence_sha256',repeat('a',64)),
    jsonb_build_object('code','INTERNAL_DAILY_REVIEW','config_state','VERIFIED','owner_user_id','22010000-0000-4000-8000-000000000003','local_time','00:01:00','duration_minutes',30,'due_offset_minutes',1440,'requires_checklist',true,'requires_delivery',false,'delivery_channels',jsonb_build_array(),'config_evidence_sha256',repeat('b',64)),
    jsonb_build_object('code','STAGING_WEEKLY_DEMO','config_state','VERIFIED','owner_user_id','22010000-0000-4000-8000-000000000004','local_time','00:01:00','day_of_week',extract(isodow from current_date)::integer,'duration_minutes',60,'due_offset_minutes',1440,'requires_checklist',true,'requires_delivery',true,'delivery_channels',jsonb_build_array('PORTAL'),'config_evidence_sha256',repeat('c',64)),
    jsonb_build_object('code','ENNCO_TECKEL_WEEKLY_MEETING','config_state','VERIFIED','owner_user_id','22010000-0000-4000-8000-000000000001','local_time','00:01:00','day_of_week',extract(isodow from current_date)::integer,'duration_minutes',45,'due_offset_minutes',1440,'requires_checklist',true,'requires_delivery',false,'delivery_channels',jsonb_build_array(),'config_evidence_sha256',repeat('d',64)),
    jsonb_build_object('code','EXECUTIVE_MONTHLY_REVIEW','config_state','VERIFIED','owner_user_id','22010000-0000-4000-8000-000000000001','local_time','00:01:00','day_of_month',extract(day from current_date)::integer,'duration_minutes',60,'due_offset_minutes',120,'requires_checklist',true,'requires_delivery',false,'delivery_channels',jsonb_build_array(),'config_evidence_sha256',repeat('e',64))
  ),repeat('4',64)
);
do $$ declare policy_id uuid; result jsonb; begin
  select id into policy_id from public.control_cadence_policy_versions where organization_id='22000000-0000-4000-8000-000000000001' and version=3;
  result:=public.activate_control_cadence_policy('22000000-0000-4000-8000-000000000001',policy_id,repeat('5',64),repeat('5',64));
  if result->>'status'<>'ACTIVE' or result->>'cadence_count'<>'5' then raise exception 'M022_POLICY_ACTIVATION_RESPONSE_INVALID'; end if;
end $$;
reset role;

set session_replication_role=replica;
update public.control_cadence_policy_versions set activated_at=(current_date at time zone 'America/Mexico_City')
where organization_id='22000000-0000-4000-8000-000000000001' and version=3;
set session_replication_role=origin;

set request.jwt.claim.sub='22010000-0000-4000-8000-000000000005';
set request.jwt.claim.aal='aal2';
set role authenticated;
select public.create_control_cadence_policy(
  '22000000-0000-4000-8000-000000000002',1,'synthetic_demo',60,
  jsonb_build_array(
    jsonb_build_object('code','CONTROL_ROOM_DAILY_UPDATE','config_state','VERIFIED','owner_user_id','22010000-0000-4000-8000-000000000005','local_time','00:01:00','duration_minutes',30,'due_offset_minutes',1440,'requires_checklist',false,'requires_delivery',false,'delivery_channels',jsonb_build_array(),'config_evidence_sha256',repeat('1',64)),
    jsonb_build_object('code','INTERNAL_DAILY_REVIEW','config_state','VERIFIED','owner_user_id','22010000-0000-4000-8000-000000000005','local_time','00:01:00','duration_minutes',30,'due_offset_minutes',1440,'requires_checklist',true,'requires_delivery',false,'delivery_channels',jsonb_build_array(),'config_evidence_sha256',repeat('2',64)),
    jsonb_build_object('code','STAGING_WEEKLY_DEMO','config_state','VERIFIED','owner_user_id','22010000-0000-4000-8000-000000000005','local_time','00:01:00','day_of_week',extract(isodow from current_date)::integer,'duration_minutes',60,'due_offset_minutes',1440,'requires_checklist',true,'requires_delivery',true,'delivery_channels',jsonb_build_array('PORTAL'),'config_evidence_sha256',repeat('3',64)),
    jsonb_build_object('code','ENNCO_TECKEL_WEEKLY_MEETING','config_state','VERIFIED','owner_user_id','22010000-0000-4000-8000-000000000005','local_time','00:01:00','day_of_week',extract(isodow from current_date)::integer,'duration_minutes',45,'due_offset_minutes',1440,'requires_checklist',true,'requires_delivery',false,'delivery_channels',jsonb_build_array(),'config_evidence_sha256',repeat('4',64)),
    jsonb_build_object('code','EXECUTIVE_MONTHLY_REVIEW','config_state','VERIFIED','owner_user_id','22010000-0000-4000-8000-000000000005','local_time','00:01:00','day_of_month',extract(day from current_date)::integer,'duration_minutes',60,'due_offset_minutes',1440,'requires_checklist',true,'requires_delivery',false,'delivery_channels',jsonb_build_array(),'config_evidence_sha256',repeat('5',64))
  ),repeat('d',64)
);
do $$ declare policy_id uuid; begin
  select id into policy_id from public.control_cadence_policy_versions where organization_id='22000000-0000-4000-8000-000000000002' and version=1;
  perform public.activate_control_cadence_policy('22000000-0000-4000-8000-000000000002',policy_id,repeat('6',64),repeat('e',64));
end $$;
reset role;
set session_replication_role=replica;
update public.control_cadence_policy_versions set activated_at=(current_date at time zone 'America/Mexico_City') where organization_id='22000000-0000-4000-8000-000000000002';
set session_replication_role=origin;
select app.run_control_cadence_reconciler('22000000-0000-4000-8000-000000000002',clock_timestamp(),repeat('f',64));
set request.jwt.claim.sub='22010000-0000-4000-8000-000000000005'; set request.jwt.claim.aal='aal2'; set role authenticated;
do $$ declare result jsonb; begin
  result:=public.evaluate_control_cadence_health('22000000-0000-4000-8000-000000000002',clock_timestamp());
  if result->>'state'<>'HEALTHY' or result->>'reason_code'<>'SYNTHETIC_EVIDENCE_NOT_LIVE' or result->>'outbound_release'<>'BLOCKED' then raise exception 'M022_SYNTHETIC_POLICY_RELEASED_OUTBOUND: %',result; end if;
end $$;
reset role;

set session_replication_role=replica;
update public.control_cadence_policy_versions set activated_at=((current_date-1) at time zone 'America/Mexico_City') where organization_id='22000000-0000-4000-8000-000000000002';
set session_replication_role=origin;
select app.run_control_cadence_reconciler('22000000-0000-4000-8000-000000000002',clock_timestamp(),repeat('a',64));
do $$ begin
  if (select count(*) from public.control_cadence_occurrences where organization_id='22000000-0000-4000-8000-000000000002')<>7 then raise exception 'M022_DAILY_CATCHUP_WINDOW_MISSING'; end if;
  if (select count(*) from public.control_cadence_breaches where organization_id='22000000-0000-4000-8000-000000000002')<>2 then raise exception 'M022_DAILY_CATCHUP_NOT_BREACHED'; end if;
end $$;

set session_replication_role=replica;
delete from public.control_cadence_delivery_requirements where organization_id='22000000-0000-4000-8000-000000000002';
delete from public.control_cadence_breaches where organization_id='22000000-0000-4000-8000-000000000002';
delete from public.control_cadence_occurrences where organization_id='22000000-0000-4000-8000-000000000002';
update public.control_cadence_policy_versions set activated_at=clock_timestamp() where organization_id='22000000-0000-4000-8000-000000000002';
update public.control_cadence_policy_items set day_of_week=1 where organization_id='22000000-0000-4000-8000-000000000002' and frequency='WEEKLY';
update public.control_cadence_policy_items set day_of_month=1 where organization_id='22000000-0000-4000-8000-000000000002' and frequency='MONTHLY';
set session_replication_role=origin;
select app.run_control_cadence_reconciler('22000000-0000-4000-8000-000000000002',clock_timestamp(),repeat('b',64));
do $$ begin
  if exists(select 1 from public.control_cadence_occurrences where organization_id='22000000-0000-4000-8000-000000000002') then raise exception 'M022_PRE_ACTIVATION_OCCURRENCE_CREATED'; end if;
end $$;
set request.jwt.claim.sub='22010000-0000-4000-8000-000000000005'; set request.jwt.claim.aal='aal2'; set role authenticated;
do $$ declare result jsonb; begin
  result:=public.evaluate_control_cadence_health('22000000-0000-4000-8000-000000000002',clock_timestamp());
  if result->>'state'<>'UNKNOWN' or result->>'reason_code'<>'OCCURRENCE_COVERAGE_INCOMPLETE' or result->>'outbound_release'<>'BLOCKED' then raise exception 'M022_ZERO_OCCURRENCE_FAIL_OPEN'; end if;
end $$;
reset role;

select app.run_control_cadence_reconciler('22000000-0000-4000-8000-000000000001',clock_timestamp(),repeat('6',64));
do $$ begin
  if (select count(*) from public.control_cadence_occurrences where organization_id='22000000-0000-4000-8000-000000000001')<>5 then raise exception 'M022_OCCURRENCE_MATERIALIZATION_INVALID'; end if;
  if (select count(distinct cadence_code) from public.control_cadence_occurrences where organization_id='22000000-0000-4000-8000-000000000001')<>5 then raise exception 'M022_OCCURRENCE_CODE_SET_INVALID'; end if;
  if not exists(select 1 from public.control_cadence_delivery_requirements d join public.control_cadence_occurrences o on o.organization_id=d.organization_id and o.id=d.occurrence_id where o.cadence_code='STAGING_WEEKLY_DEMO' and d.channel='PORTAL' and d.delivery_status='PENDING') then raise exception 'M022_DELIVERY_REQUIREMENT_NOT_MATERIALIZED'; end if;
end $$;

set session_replication_role=replica;
update public.organization_users set active=false where organization_id='22000000-0000-4000-8000-000000000001' and user_id='22010000-0000-4000-8000-000000000004';
set session_replication_role=origin;
set request.jwt.claim.sub='22010000-0000-4000-8000-000000000001'; set request.jwt.claim.aal='aal2'; set role authenticated;
do $$ begin if (public.evaluate_control_cadence_health('22000000-0000-4000-8000-000000000001',clock_timestamp())->>'state')<>'UNKNOWN' then raise exception 'M022_INACTIVE_OWNER_NOT_UNKNOWN'; end if; end $$;
reset role;
set session_replication_role=replica;
update public.organization_users set active=true where organization_id='22000000-0000-4000-8000-000000000001' and user_id='22010000-0000-4000-8000-000000000004';
set session_replication_role=origin;

set request.jwt.claim.sub='22010000-0000-4000-8000-000000000003';
set request.jwt.claim.aal='aal1';
set role authenticated;
do $$ begin
  begin perform public.evaluate_control_cadence_health('22000000-0000-4000-8000-000000000001',clock_timestamp()); raise exception 'M022_AAL1_READ_BYPASS'; exception when others then if sqlerrm='M022_AAL1_READ_BYPASS' then raise; end if; end;
  begin perform public.record_control_cadence_evidence('22000000-0000-4000-8000-000000000001',(select id from public.control_cadence_occurrences limit 1),'wrong','CHECKLIST','COMPLETE','live',repeat('1',64),repeat('7',64)); raise exception 'M022_AAL1_WRITE_BYPASS'; exception when others then if sqlerrm='M022_AAL1_WRITE_BYPASS' then raise; end if; end;
end $$;
reset role;

set request.jwt.claim.sub='22010000-0000-4000-8000-000000000005';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ begin
  if (select count(*) from public.control_cadence_occurrences where organization_id='22000000-0000-4000-8000-000000000001')<>0 then raise exception 'M022_RLS_CROSS_TENANT_READ'; end if;
end $$;
reset role;

set request.jwt.claim.sub='22010000-0000-4000-8000-000000000003';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ declare occurrence_id uuid; window_value text; begin
  select id,window_key into occurrence_id,window_value from public.control_cadence_occurrences where organization_id='22000000-0000-4000-8000-000000000001' and cadence_code='CONTROL_ROOM_DAILY_UPDATE';
  begin perform public.record_control_cadence_evidence('22000000-0000-4000-8000-000000000001',occurrence_id,'WRONG-WINDOW','AUTOMATED_SNAPSHOT','COMPLETE','live',repeat('7',64),repeat('7',64)); raise exception 'M022_WRONG_WINDOW_EVIDENCE_ACCEPTED'; exception when others then if sqlerrm='M022_WRONG_WINDOW_EVIDENCE_ACCEPTED' then raise; end if; end;
  begin perform public.record_control_cadence_evidence('22000000-0000-4000-8000-000000000001',occurrence_id,window_value,'AUTOMATED_SNAPSHOT','COMPLETE','synthetic_demo',repeat('8',64),repeat('8',64)); raise exception 'M022_SYNTHETIC_EVIDENCE_SATISFIED_LIVE'; exception when others then if sqlerrm='M022_SYNTHETIC_EVIDENCE_SATISFIED_LIVE' then raise; end if; end;
  select id,window_key into occurrence_id,window_value from public.control_cadence_occurrences where organization_id='22000000-0000-4000-8000-000000000001' and cadence_code='ENNCO_TECKEL_WEEKLY_MEETING';
  begin perform public.record_control_cadence_session('22000000-0000-4000-8000-000000000001',occurrence_id,window_value,'HELD',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 hour 45 minutes','live',repeat('8',64),repeat('c',64));
    raise exception 'M022_FUTURE_HELD_SESSION_BYPASS'; exception when others then if sqlerrm='M022_FUTURE_HELD_SESSION_BYPASS' then raise; end if; end;
end $$;
reset role;

do $$ declare o public.control_cadence_occurrences%rowtype; session_id uuid; result jsonb; recorded_at timestamptz; begin
  perform set_config('request.jwt.claim.sub','22010000-0000-4000-8000-000000000003',false); perform set_config('request.jwt.claim.aal','aal2',false);
  select * into o from public.control_cadence_occurrences where organization_id='22000000-0000-4000-8000-000000000001' and cadence_code='CONTROL_ROOM_DAILY_UPDATE';
  recorded_at:=o.scheduled_at+interval '15 minutes';
  result:=app.record_control_cadence_evidence(o.organization_id,o.id,o.window_key,'AUTOMATED_SNAPSHOT','COMPLETE','live',repeat('9',64),recorded_at,repeat('9',64));
  result:=app.record_control_cadence_evidence(o.organization_id,o.id,o.window_key,'AUTOMATED_SNAPSHOT','COMPLETE','live',repeat('9',64),recorded_at,repeat('9',64));
  if result->>'replayed'<>'true' then raise exception 'M022_EVIDENCE_REPLAY_INVALID'; end if;

  for o in select * from public.control_cadence_occurrences where organization_id='22000000-0000-4000-8000-000000000001' and cadence_code in ('INTERNAL_DAILY_REVIEW','STAGING_WEEKLY_DEMO','ENNCO_TECKEL_WEEKLY_MEETING') order by cadence_code loop
    result:=app.record_control_cadence_session(o.organization_id,o.id,o.window_key,'HELD',o.scheduled_at,o.scheduled_at+make_interval(mins=>(select duration_minutes from public.control_cadence_policy_items where id=o.policy_item_id)),'live',repeat('a',64),o.scheduled_at+interval '70 minutes',encode(digest(o.id::text||':session','sha256'),'hex'));
    select id into session_id from public.control_cadence_human_sessions where organization_id=o.organization_id and occurrence_id=o.id;
    result:=app.record_control_cadence_evidence(o.organization_id,o.id,o.window_key,'CHECKLIST','COMPLETE','live',repeat('b',64),o.scheduled_at+interval '75 minutes',encode(digest(o.id::text||':checklist','sha256'),'hex'));
    if o.cadence_code='STAGING_WEEKLY_DEMO' then
      begin result:=app.record_control_cadence_delivery(o.organization_id,o.id,o.window_key,'PORTAL','live',repeat('c',64),o.scheduled_at+interval '80 minutes','synthetic portal acknowledgement',false,encode(digest(o.id::text||':delivery-no-ack','sha256'),'hex')); raise exception 'M022_DELIVERY_WITHOUT_ACK_BYPASS'; exception when others then if sqlerrm='M022_DELIVERY_WITHOUT_ACK_BYPASS' then raise; end if; end;
      result:=app.record_control_cadence_delivery(o.organization_id,o.id,o.window_key,'PORTAL','live',repeat('c',64),o.scheduled_at+interval '80 minutes','synthetic portal acknowledgement',true,encode(digest(o.id::text||':delivery','sha256'),'hex'));
    end if;
    if o.cadence_code='ENNCO_TECKEL_WEEKLY_MEETING' then
      result:=app.record_control_cadence_attendance(o.organization_id,session_id,'22010000-0000-4000-8000-000000000001','ATTENDED',repeat('d',64),o.scheduled_at+interval '80 minutes',repeat('d',64));
    end if;
  end loop;
end $$;

select app.run_control_cadence_reconciler('22000000-0000-4000-8000-000000000001',clock_timestamp(),repeat('a',64));
do $$ begin
  if exists(select 1 from public.control_cadence_occurrences where cadence_code='ENNCO_TECKEL_WEEKLY_MEETING' and execution_status='COMPLETED') then raise exception 'M022_UNILATERAL_ATTENDANCE_COMPLETED_MEETING'; end if;
end $$;

do $$ declare o public.control_cadence_occurrences%rowtype; session_id uuid; result jsonb; begin
  perform set_config('request.jwt.claim.sub','22010000-0000-4000-8000-000000000004',false); perform set_config('request.jwt.claim.aal','aal2',false);
  select * into o from public.control_cadence_occurrences where organization_id='22000000-0000-4000-8000-000000000001' and cadence_code='ENNCO_TECKEL_WEEKLY_MEETING';
  select id into session_id from public.control_cadence_human_sessions where organization_id=o.organization_id and occurrence_id=o.id;
  result:=app.record_control_cadence_attendance(o.organization_id,session_id,'22010000-0000-4000-8000-000000000004','ATTENDED',repeat('e',64),o.scheduled_at+interval '85 minutes',repeat('e',64));
end $$;

do $$ declare o public.control_cadence_occurrences%rowtype; result jsonb; begin
  perform set_config('request.jwt.claim.sub','22010000-0000-4000-8000-000000000001',false); perform set_config('request.jwt.claim.aal','aal2',false);
  select * into o from public.control_cadence_occurrences where organization_id='22000000-0000-4000-8000-000000000001' and cadence_code='EXECUTIVE_MONTHLY_REVIEW';
  result:=app.record_control_cadence_session(o.organization_id,o.id,o.window_key,'HELD',o.scheduled_at,o.scheduled_at+interval '60 minutes','live',repeat('f',64),o.scheduled_at+interval '210 minutes',repeat('f',64));
  result:=app.record_control_cadence_evidence(o.organization_id,o.id,o.window_key,'CHECKLIST','COMPLETE','live',repeat('0',64),o.scheduled_at+interval '215 minutes',repeat('0',64));
end $$;

select app.run_control_cadence_reconciler('22000000-0000-4000-8000-000000000001',clock_timestamp(),repeat('b',64));
do $$ begin
  if not exists(select 1 from public.control_cadence_occurrences where cadence_code='ENNCO_TECKEL_WEEKLY_MEETING' and execution_status='COMPLETED' and compliance_status='MET') then raise exception 'M022_BILATERAL_MEETING_NOT_MET'; end if;
  if not exists(select 1 from public.control_cadence_occurrences where cadence_code='EXECUTIVE_MONTHLY_REVIEW' and compliance_status='BREACHED') then raise exception 'M022_OVERDUE_NOT_BREACHED'; end if;
  if (select count(*) from public.control_cadence_breaches where organization_id='22000000-0000-4000-8000-000000000001')<>1 then raise exception 'M022_BREACH_COUNT_INVALID'; end if;
  if not exists(select 1 from public.incidents where organization_id='22000000-0000-4000-8000-000000000001' and incident_key like 'cadence:%') then raise exception 'M022_BREACH_INCIDENT_MISSING'; end if;
  if not exists(select 1 from public.event_outbox where organization_id='22000000-0000-4000-8000-000000000001' and event_type='control_cadence.breached') then raise exception 'M022_BREACH_OUTBOX_MISSING'; end if;
end $$;
select app.run_control_cadence_reconciler('22000000-0000-4000-8000-000000000001',clock_timestamp(),repeat('c',64));
do $$ begin
  if not exists(select 1 from public.control_cadence_occurrences where cadence_code='EXECUTIVE_MONTHLY_REVIEW' and execution_status='COMPLETED' and compliance_status='BREACHED') then raise exception 'M022_LATE_COMPLETION_ERASED_BREACH'; end if;
end $$;

set request.jwt.claim.sub='22010000-0000-4000-8000-000000000001'; set request.jwt.claim.aal='aal2'; set role authenticated;
do $$ declare breach_id uuid; begin
  select id into breach_id from public.control_cadence_breaches where organization_id='22000000-0000-4000-8000-000000000001' and status='OPEN';
  begin perform public.mitigate_control_cadence_breach('22000000-0000-4000-8000-000000000001',breach_id,repeat('1',64),repeat('1',64));
    raise exception 'M022_UNRESOLVED_INCIDENT_MITIGATION_BYPASS'; exception when others then if sqlerrm='M022_UNRESOLVED_INCIDENT_MITIGATION_BYPASS' then raise; end if; end;
end $$;
do $$ declare incident_id uuid; breach_id uuid; result jsonb; begin
  select b.incident_id,b.id into incident_id,breach_id from public.control_cadence_breaches b where b.organization_id='22000000-0000-4000-8000-000000000001' and b.status='OPEN';
  result:=public.transition_operational_incident('22000000-0000-4000-8000-000000000001',incident_id,'ACKNOWLEDGE',repeat('2',64),'synthetic cadence acknowledgement',false,repeat('2',64));
  result:=public.transition_operational_incident('22000000-0000-4000-8000-000000000001',incident_id,'CONTAIN',repeat('3',64),'synthetic cadence containment',false,repeat('3',64));
  result:=public.transition_operational_incident('22000000-0000-4000-8000-000000000001',incident_id,'RECOVER',repeat('4',64),'synthetic cadence recovery',false,repeat('4',64));
  result:=public.transition_operational_incident('22000000-0000-4000-8000-000000000001',incident_id,'MONITOR',repeat('5',64),'synthetic cadence monitoring',false,repeat('5',64));
  result:=public.transition_operational_incident('22000000-0000-4000-8000-000000000001',incident_id,'RESOLVE',repeat('6',64),'synthetic cadence root cause resolved',true,repeat('6',64));
  result:=public.mitigate_control_cadence_breach('22000000-0000-4000-8000-000000000001',breach_id,repeat('7',64),repeat('7',64));
  if result->>'status'<>'MITIGATED' then raise exception 'M022_MITIGATION_RESULT_INVALID'; end if;
end $$;
reset role;
select app.run_control_cadence_reconciler('22000000-0000-4000-8000-000000000001',clock_timestamp(),repeat('8',64));
set request.jwt.claim.sub='22010000-0000-4000-8000-000000000001'; set request.jwt.claim.aal='aal2'; set role authenticated;
do $$ declare result jsonb; begin
  result:=public.evaluate_control_cadence_health('22000000-0000-4000-8000-000000000001',clock_timestamp());
  if result->>'state'<>'HEALTHY' or result->>'outbound_release'<>'ALLOWED' or result->>'open_p1'<>'0' or result->>'breached_occurrences'<>'0'
    or exists(select 1 from jsonb_array_elements(result->'cadences') x where x->>'breach_severity' is not null or x->>'next_action'='MITIGATE_BREACH') then raise exception 'M022_MITIGATION_DID_NOT_RECOVER_HEALTH'; end if;
end $$;
reset role;

create temporary table m022_hash_probe(evaluated_at timestamptz,input_sha256 text);
insert into m022_hash_probe(evaluated_at) values(clock_timestamp());
select app.run_control_cadence_reconciler('22000000-0000-4000-8000-000000000001',(select evaluated_at from m022_hash_probe),repeat('9',64));
update m022_hash_probe set input_sha256=(select r.input_sha256 from public.control_cadence_reconciliation_runs r where r.organization_id='22000000-0000-4000-8000-000000000001' and r.idempotency_key=repeat('9',64));
set session_replication_role=replica;
update public.control_cadence_policy_items set config_evidence_sha256=repeat('9',64) where organization_id='22000000-0000-4000-8000-000000000001' and cadence_code='INTERNAL_DAILY_REVIEW';
set session_replication_role=origin;
select app.run_control_cadence_reconciler('22000000-0000-4000-8000-000000000001',(select evaluated_at from m022_hash_probe),repeat('0',64));
do $$ begin
  if (select input_sha256 from m022_hash_probe)=(select r.input_sha256 from public.control_cadence_reconciliation_runs r where r.organization_id='22000000-0000-4000-8000-000000000001' and r.idempotency_key=repeat('0',64)) then raise exception 'M022_CANONICAL_INPUT_HASH_IGNORED_MATERIAL_DRIFT'; end if;
end $$;
set session_replication_role=replica;
update public.control_cadence_policy_items set config_evidence_sha256=repeat('b',64) where organization_id='22000000-0000-4000-8000-000000000001' and cadence_code='INTERNAL_DAILY_REVIEW';
set session_replication_role=origin;

set request.jwt.claim.sub='22010000-0000-4000-8000-000000000001';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ declare result jsonb; latest_at timestamptz; begin
  select max(heartbeat_at) into latest_at from public.control_cadence_reconciliation_runs where organization_id='22000000-0000-4000-8000-000000000001';
  result:=public.evaluate_control_cadence_health('22000000-0000-4000-8000-000000000001',latest_at+interval '61 minutes');
  if result->>'state'<>'UNKNOWN' or result->>'reason_code'<>'RECONCILER_HEARTBEAT_STALE' or result->>'outbound_release'<>'BLOCKED' then raise exception 'M022_STALE_HEARTBEAT_NOT_UNKNOWN'; end if;
  if not (result ?& array['status','state','reason_code','organization_id','evaluated_at','policy_version_id','policy_version','timezone','cadence_count','required_cadence_count','open_occurrences','breached_occurrences','open_p0','open_p1','last_reconciled_at','heartbeat_state','outbound_release','cadences']) then raise exception 'M022_READ_MODEL_SHAPE_INVALID'; end if;
end $$;
reset role;
set session_replication_role=replica;
update public.control_cadence_reconciliation_runs set heartbeat_at=clock_timestamp()-interval '61 minutes' where organization_id='22000000-0000-4000-8000-000000000001';
set session_replication_role=origin;
do $$ declare latest_at timestamptz; evaluated_at timestamptz:=clock_timestamp(); result jsonb; begin
  select max(heartbeat_at) into latest_at from public.control_cadence_reconciliation_runs where organization_id='22000000-0000-4000-8000-000000000001';
  result:=app.run_control_cadence_heartbeat_watchdog('22000000-0000-4000-8000-000000000001',evaluated_at,repeat('a',64));
  if result->>'state'<>'UNKNOWN' then raise exception 'M022_HEARTBEAT_WATCHDOG_NOT_UNKNOWN'; end if;
  if (select count(*) from public.incidents where organization_id='22000000-0000-4000-8000-000000000001' and incident_key='cadence-heartbeat-stale')<>1 then raise exception 'M022_HEARTBEAT_INCIDENT_COUNT_INVALID'; end if;
  if (select count(*) from public.event_outbox where organization_id='22000000-0000-4000-8000-000000000001' and event_type='control_cadence.heartbeat_stale')<>1 then raise exception 'M022_HEARTBEAT_OUTBOX_COUNT_INVALID'; end if;
  result:=app.run_control_cadence_heartbeat_watchdog('22000000-0000-4000-8000-000000000001',evaluated_at,repeat('a',64));
  if result->>'replayed'<>'true' then raise exception 'M022_HEARTBEAT_WATCHDOG_REPLAY_INVALID'; end if;
end $$;

do $$ declare evaluated_at timestamptz:=clock_timestamp(); result jsonb; begin
  result:=app.run_control_cadence_heartbeat_watchdog('22000000-0000-4000-8000-000000000003',evaluated_at,repeat('c',64));
  if result->>'state'<>'UNKNOWN' or result->'policy_version_id'<>'null'::jsonb or result->'outbox_event_id'='null'::jsonb then raise exception 'M022_NO_POLICY_WATCHDOG_RESPONSE_INVALID'; end if;
  if (select count(*) from public.incidents where organization_id='22000000-0000-4000-8000-000000000003' and incident_key='cadence-heartbeat-stale')<>1 then raise exception 'M022_NO_POLICY_INCIDENT_COUNT_INVALID'; end if;
  if (select count(*) from public.event_outbox where organization_id='22000000-0000-4000-8000-000000000003' and event_type='control_cadence.heartbeat_stale' and idempotency_key='cadence-heartbeat-stale:no-active-policy')<>1 then raise exception 'M022_NO_POLICY_OUTBOX_COUNT_INVALID'; end if;
  if not exists(
    select 1 from public.incident_alert_requirements r join public.incidents i on i.organization_id=r.organization_id and i.id=r.incident_id
    where r.organization_id='22000000-0000-4000-8000-000000000003' and i.incident_key='cadence-heartbeat-stale' and r.audience='CLIENT' and r.required_channel='EMAIL'
  ) or not exists(
    select 1 from public.incident_alert_requirements r join public.incidents i on i.organization_id=r.organization_id and i.id=r.incident_id
    where r.organization_id='22000000-0000-4000-8000-000000000003' and i.incident_key='cadence-heartbeat-stale' and r.audience='TECKEL' and r.required_channel='TELEGRAM'
  ) then raise exception 'M022_NO_POLICY_ALERT_REQUIREMENTS_MISSING'; end if;
  result:=app.run_control_cadence_heartbeat_watchdog('22000000-0000-4000-8000-000000000003',evaluated_at,repeat('c',64));
  if result->>'replayed'<>'true' then raise exception 'M022_NO_POLICY_WATCHDOG_REPLAY_INVALID'; end if;
end $$;

set session_replication_role=replica;
update public.control_cadence_policy_items set config_state='UNKNOWN',config_evidence_sha256=null where cadence_code='INTERNAL_DAILY_REVIEW' and organization_id='22000000-0000-4000-8000-000000000001';
set session_replication_role=origin;
set request.jwt.claim.sub='22010000-0000-4000-8000-000000000001'; set request.jwt.claim.aal='aal2'; set role authenticated;
do $$ begin if (public.evaluate_control_cadence_health('22000000-0000-4000-8000-000000000001',clock_timestamp())->>'state')<>'UNKNOWN' then raise exception 'M022_PARTIAL_POLICY_NOT_UNKNOWN'; end if; end $$;
reset role;
set session_replication_role=replica;
update public.control_cadence_policy_items set config_state='VERIFIED',config_evidence_sha256=repeat('b',64) where cadence_code='INTERNAL_DAILY_REVIEW' and organization_id='22000000-0000-4000-8000-000000000001';
set session_replication_role=origin;

set request.jwt.claim.sub='22010000-0000-4000-8000-000000000003'; set request.jwt.claim.aal='aal2'; set role authenticated;
do $$ begin
  begin insert into public.control_cadence_breaches(organization_id,occurrence_id,breach_kind,severity,detected_at) values('22000000-0000-4000-8000-000000000001',(select id from public.control_cadence_occurrences limit 1),'DELIVERY_INCOMPLETE','P1',clock_timestamp()); raise exception 'M022_AUTH_DML_BYPASS'; exception when others then if sqlerrm='M022_AUTH_DML_BYPASS' then raise; end if; end;
  begin truncate public.control_cadence_evidence_items; raise exception 'M022_AUTH_TRUNCATE_BYPASS'; exception when others then if sqlerrm='M022_AUTH_TRUNCATE_BYPASS' then raise; end if; end;
end $$;
reset role;
set role service_role; select set_config('app.control_cadence_rpc_write','on',false);
do $$ begin
  begin update public.control_cadence_occurrences set compliance_status='MET'; raise exception 'M022_SERVICE_GUC_DML_BYPASS'; exception when others then if sqlerrm='M022_SERVICE_GUC_DML_BYPASS' then raise; end if; end;
  begin delete from public.control_cadence_reconciliation_runs; raise exception 'M022_SERVICE_DELETE_BYPASS'; exception when others then if sqlerrm='M022_SERVICE_DELETE_BYPASS' then raise; end if; end;
end $$;
reset role;

do $$ declare before_row record; begin
  select * into before_row from m022_commercial_before;
  if before_row.leads<>(select count(*) from public.leads) or before_row.opportunities<>(select count(*) from public.opportunities)
    or before_row.proposals<>(select count(*) from public.proposals) or before_row.payments<>(select count(*) from public.payments)
    or before_row.commissions<>(select count(*) from public.commissions) then raise exception 'M022_COMMERCIAL_COUNTER_MUTATION'; end if;
  if exists(select 1 from public.audit_log where record_type like 'control_cadence_%' and (coalesce(old_data::text,'')||coalesce(new_data::text,'')) ~ '(evidence_sha256|idempotency_key|policy_sha256)') then raise exception 'M022_AUDIT_ALLOWLIST_SECRET_LEAK'; end if;
end $$;

insert into public.messages(organization_id,direction,status,idempotency_key,correlation_id)
values('22000000-0000-4000-8000-000000000001','OUTBOUND','DRY_RUN','m022-dry-run-forward','22090000-0000-4000-8000-000000000001');
do $$ begin
  begin insert into public.messages(organization_id,direction,status,idempotency_key,correlation_id) values('22000000-0000-4000-8000-000000000001','OUTBOUND','QUEUED','m022-real-blocked','22090000-0000-4000-8000-000000000002'); raise exception 'M022_REAL_OUTBOUND_BYPASS'; exception when others then if sqlerrm='M022_REAL_OUTBOUND_BYPASS' then raise; end if; end;
end $$;

\echo 'CONTROL_CADENCE_FORWARD_GATE_PASS'
