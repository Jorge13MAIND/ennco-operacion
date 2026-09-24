\set ON_ERROR_STOP on
-- This test runs only in the disposable local database. No provider is contacted.
begin;
set local session_replication_role=replica;
insert into auth.users values ('61000000-0000-4000-8000-000000000005','operator@example.test'),('61000000-0000-4000-8000-000000000006','backup@example.test');
insert into public.organization_users(organization_id,user_id,role) values
('61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000005','teckel_admin'),
('61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000006','teckel_admin');
insert into public.operational_assignments(organization_id,primary_user_id,backup_user_id,status,configured_by,configured_at)
values('61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000005','61000000-0000-4000-8000-000000000006','ACTIVE','61000000-0000-4000-8000-000000000005',now());
insert into public.accounts(id,organization_id,legal_name,normalized_name) values('61000000-0000-4000-8000-000000000003','61000000-0000-4000-8000-000000000001','Synthetic plant','synthetic plant');
insert into public.contacts(id,organization_id,account_id,full_name,role_title,normalized_email) values('61000000-0000-4000-8000-000000000004','61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000003','Synthetic Buyer','Maintenance','buyer@example.test');
insert into public.campaigns(id,organization_id,name,manifest_json,manifest_sha256) values('61000000-0000-4000-8000-000000000050','61000000-0000-4000-8000-000000000001','Commercial synthetic','{}',repeat('5',64));
insert into public.campaign_enrollments(id,organization_id,campaign_id,sequence_version_id,account_id,contact_id,mailbox_id,status)
values('61000000-0000-4000-8000-000000000110','61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000050','61000000-0000-4000-8000-000000000051','61000000-0000-4000-8000-000000000003','61000000-0000-4000-8000-000000000004','61000000-0000-4000-8000-000000000002','REPLIED');
update public.messages set normalized_from='buyer@example.test',normalized_to='sender@example.test',subject='Context',provider_thread_id='thread-synthetic' where id='61000000-0000-4000-8000-000000000030';
insert into public.event_outbox(organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json) values('61000000-0000-4000-8000-000000000001','provider_events','61000000-0000-4000-8000-000000000040','gmail.reply','synthetic-alert','{}');
insert into public.runtime_controls(organization_id,global_kill_switch,external_send_allowed) values('61000000-0000-4000-8000-000000000001',false,true) on conflict(organization_id) do update set global_kill_switch=false,external_send_allowed=true;
insert into public.reporting_calendar_days(organization_id,calendar_date,is_business_day,evidence_class,source_sha256,recorded_by)
select '61000000-0000-4000-8000-000000000001',d::date,extract(isodow from d)<6,'live',repeat('c',64),'61000000-0000-4000-8000-000000000005'
from generate_series('2026-09-23'::date,'2026-10-15'::date,'1 day') d;
set local session_replication_role=origin;
insert into app.email_sdr_settings(organization_id,service_secret,campaign_ids,auto_intents,acceptance_evidence)
values('61000000-0000-4000-8000-000000000001',repeat('s',64),array['61000000-0000-4000-8000-000000000050'::uuid],array['CONTEXT'],'{"tests_passed":true,"pause_resume_verified":true}');
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000005',true);
create function pg_temp.sdr(p jsonb) returns jsonb language plpgsql as $$
declare org uuid:='61000000-0000-4000-8000-000000000001'; nonce uuid:=gen_random_uuid(); expires timestamptz:=date_trunc('second',clock_timestamp()+interval '4 minutes'); sha text; sig text;
begin
 sha:=encode(digest(convert_to(concat_ws(E'\n','email_sdr_command',org::text,encode(digest(convert_to(p::text,'utf8'),'sha256'),'hex')),'utf8'),'sha256'),'hex');
 sig:=encode(app.hmac(convert_to(concat_ws(E'\n',org::text,'email_sdr_command:'||nonce,nonce::text,to_char(expires at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),sha),'utf8'),convert_to(repeat('s',64),'utf8'),'sha256'),'hex');
 return public.email_sdr_command(org,p::text,'email_sdr_command:'||nonce,nonce,expires,sig);
end $$;
-- Existing transport guards are independently covered by 068. Only the SQL SDR
-- enqueue gate is isolated here; synthetic sender receipts are never live proof.
alter table public.messages disable trigger user;
do $$
declare r jsonb; org uuid:='61000000-0000-4000-8000-000000000001'; cid uuid; mid uuid; dec jsonb:='{"intent":"CONTEXT","eligible":true,"gates":[],"evidence":["Necesito contexto del servicio"],"draft":"approved template"}';
begin
 if has_table_privilege('anon','app.email_sdr_settings','select') or has_table_privilege('service_role','public.email_sdr_cases','insert') then raise exception 'SDR_PRIVILEGE_LEAK'; end if;
 begin perform public.email_sdr_command(org,'{}','x',gen_random_uuid(),now()+interval '1 minute','fake'); raise exception 'UNSIGNED_ACCEPTED'; exception when others then if sqlerrm<>'SDR_UNAUTHORIZED' then raise; end if; end;
 r:=pg_temp.sdr('{"op":"WORK"}');
 if r->>'count'<>'1' then raise exception 'WORK_NOT_SCOPED %',r; end if;
 if r->'cases'->0->>'campaign_name'<>'Commercial synthetic'
   or r->'cases'->0->>'account_name'<>'Synthetic plant'
   or r->'cases'->0->>'contact_role'<>'Maintenance' then
   raise exception 'SDR_COMMERCIAL_CONTEXT_MISSING'; end if;
 cid:=(r->'cases'->0->>'case_id')::uuid;
 if (select count(*) from public.notification_deliveries where organization_id=org and channel='CONTROL_ROOM' and status='PENDING')<>1 then raise exception 'ALERT_NOT_ROUTED'; end if;
 r:=pg_temp.sdr('{"op":"WORK"}'); if r->>'count'<>'0' then raise exception 'LEASE_REPEATED'; end if;
 r:=pg_temp.sdr('{"op":"MODEL_SLOT"}'); if r->>'allowed'<>'false' then raise exception 'MODEL_SPEND_WITHOUT_BUDGET'; end if;
 perform pg_temp.sdr(jsonb_build_object('op','DECIDE','case_id',cid,'policy_version','ennco-email-v1-2026-09-23','state','REVIEW','thread_hash',repeat('a',64),'next_action','Review context, not a lead','decision',dec));
 r:=pg_temp.sdr(jsonb_build_object('op','QUEUE','case_id',cid,'thread_hash',repeat('a',64)));
 if r->>'reason'<>'FIVE_REVIEWED_CANARIES_REQUIRED' then raise exception 'UNREVIEWED_SEND_ALLOWED %',r; end if;
 begin perform public.set_email_sdr_mode(org,'AUTO'); raise exception 'AUTO_WITHOUT_CANARIES'; exception when others then if sqlerrm<>'SDR_FIVE_REVIEWED_CANARIES_REQUIRED' then raise; end if; end;
 perform public.review_email_sdr_case(org,cid,repeat('a',64),'APPROVE','Synthetic first eligible reply reviewed');
 perform public.set_email_sdr_mode(org,'PAUSED');
 r:=pg_temp.sdr(jsonb_build_object('op','QUEUE','case_id',cid,'thread_hash',repeat('a',64))); if r->>'reason'<>'SDR_PAUSED' then raise exception 'PAUSE_IGNORED'; end if;
 perform public.set_email_sdr_mode(org,'REVIEW');
 r:=pg_temp.sdr(jsonb_build_object('op','QUEUE','case_id',cid,'thread_hash',repeat('b',64))); if r->>'reason'<>'CONVERSATION_NOT_ELIGIBLE' then raise exception 'STALE_THREAD_APPROVED'; end if;
 r:=pg_temp.sdr(jsonb_build_object('op','QUEUE','case_id',cid,'thread_hash',repeat('a',64)));
 if r->>'status'<>'QUEUED' then raise exception 'REVIEWED_REPLY_NOT_QUEUED %',r; end if;
 mid:=(r->>'message_id')::uuid;
 if (select normalized_to from public.messages where id=mid)<>'buyer@example.test' or (select provider_thread_id from public.messages where id=mid)<>'thread-synthetic' then raise exception 'WRONG_RECIPIENT_OR_THREAD'; end if;
 r:=pg_temp.sdr(jsonb_build_object('op','QUEUE','case_id',cid,'thread_hash',repeat('a',64))); if r->>'status'<>'DUPLICATE' then raise exception 'DUPLICATE_ENQUEUED'; end if;
 if (select count(*) from public.messages where reply_to_provider_event_id='61000000-0000-4000-8000-000000000040')<>1 then raise exception 'DUPLICATE_MESSAGE'; end if;
 perform public.set_email_sdr_mode(org,'PAUSED');
 r:=pg_temp.sdr(jsonb_build_object('op','SEND_CONTEXT','case_id',cid,'message_id',mid)); if r->>'status'<>'HOLD' then raise exception 'PAUSE_BEFORE_SEND_IGNORED'; end if;
 perform public.set_email_sdr_mode(org,'REVIEW');
 r:=pg_temp.sdr(jsonb_build_object('op','SEND_CONTEXT','case_id',cid,'message_id',mid)); if r->>'status'<>'SEND_CONTEXT' then raise exception 'RESUME_FAILED'; end if;
 perform public.configure_email_sdr_backup(org,'61000000-0000-4000-8000-000000000006',repeat('d',64));
 update public.notification_deliveries set created_at=now()-interval '31 minutes'
   where organization_id=org and channel='CONTROL_ROOM' and status='PENDING';
 r:=pg_temp.sdr('{"op":"ALERT_WORK"}');
 if r->'alerts'->0->>'stage'<>'BACKUP' then raise exception 'BACKUP_ALERT_NOT_CLAIMED %',r; end if;
 if r->'alerts'->0->>'owner_email'<>'operator@example.test' or r->'alerts'->0->>'backup_email'<>'backup@example.test' then
   raise exception 'ALERT_RECIPIENTS_NOT_ASSIGNED'; end if;
 perform pg_temp.sdr(jsonb_build_object('op','ALERT_SETTLE','case_id',cid,'stage','BACKUP','accepted',true));
 r:=pg_temp.sdr('{"op":"ALERT_WORK"}');
 if jsonb_array_length(r->'alerts')<>0 then raise exception 'PROVIDER_ALERT_DUPLICATED'; end if;
 if (select status from public.notification_deliveries where organization_id=org and channel='CONTROL_ROOM')<>'PENDING' then
   raise exception 'PROVIDER_ACCEPTANCE_COUNTED_AS_HUMAN_ACK'; end if;
 update public.notification_deliveries set created_at=now()-interval '2 hours 1 minute'
   where organization_id=org and channel='CONTROL_ROOM' and status='PENDING';
 r:=pg_temp.sdr('{"op":"ALERT_WORK"}');
 if r->'alerts'->0->>'stage'<>'OVERDUE' or
   (select new_contacts_paused from public.campaigns where id='61000000-0000-4000-8000-000000000050') is distinct from true then
   raise exception 'OVERDUE_ALERT_DID_NOT_PAUSE_NEW_CONTACTS %',r; end if;
 perform pg_temp.sdr(jsonb_build_object('op','ALERT_SETTLE','case_id',cid,'stage','OVERDUE','accepted',null));
 if not exists(select 1 from app.email_sdr_alert_dispatch where organization_id=org and case_id=cid
   and stage='OVERDUE' and uncertain_at is not null and provider_accepted_at is null) then
   raise exception 'AMBIGUOUS_ALERT_NOT_QUARANTINED'; end if;
 r:=pg_temp.sdr('{"op":"ALERT_WORK"}');
 if jsonb_array_length(r->'alerts')<>0 then raise exception 'AMBIGUOUS_ALERT_RETRIED_BLINDLY'; end if;
 perform set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000006',true);
 if (public.read_email_sdr_cases(org)->0->>'can_ack')<>'true' then raise exception 'BACKUP_CANNOT_SEE_ACK'; end if;
 perform public.ack_email_sdr_alert(org,cid);
 perform set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000005',true);
 perform public.ack_email_sdr_alert(org,cid);
 if (select count(*) from public.notification_deliveries where organization_id=org and status='DELIVERED' and attempt_count=1)<>1 then raise exception 'ACK_NOT_IDEMPOTENT'; end if;
 if exists(select 1 from public.leads where organization_id=org) then raise exception 'SDR_CREATED_CONTRACTUAL_LEAD'; end if;
 if app.email_sdr_followup_due(org,'2026-09-23T17:00:00Z',3)<>'2026-09-28T16:00:00Z'::timestamptz or app.email_sdr_followup_due(org,'2026-09-23T17:00:00Z',7)<>'2026-10-02T16:00:00Z'::timestamptz then raise exception 'BUSINESS_DAY_OFFSETS_WRONG'; end if;
 insert into public.reporting_calendar_days(organization_id,calendar_date,is_business_day,evidence_class,source_sha256,recorded_by)
 select org,d::date,true,'live',repeat('c',64),'61000000-0000-4000-8000-000000000005' from unnest(array['2027-01-05','2027-01-07','2027-01-08']) d;
 if app.email_sdr_followup_due(org,'2027-01-04T17:00:00Z',3) is not null then raise exception 'INCOMPLETE_CALENDAR_NOT_HELD'; end if;
 r:=public.read_email_sdr_status(org); if r->>'reviewed_canaries'<>'0' then raise exception 'QUEUED_COUNTED_AS_SENT'; end if;
 if jsonb_array_length(public.read_email_sdr_cases(org))<>1 then raise exception 'CASE_OVERVIEW_FAILED'; end if;
end $$;
alter table public.messages enable trigger user;
rollback;
select 'SDR_AUTH_TENANT_REVIEW_DUPLICATE_PAUSE_RECIPIENT_THREAD_ALERT_CALENDAR_PASS' as result;
