\set ON_ERROR_STOP on
begin;
set local session_replication_role=replica;
insert into auth.users(id,email) values('61000000-0000-4000-8000-000000000005','operator@example.test');
insert into public.organization_users(organization_id,user_id,role)
  values('61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000005','teckel_admin');
insert into public.accounts(id,organization_id,legal_name,normalized_name,state)
  values('61000000-0000-4000-8000-000000000003','61000000-0000-4000-8000-000000000001','Synthetic plant','synthetic plant','Querétaro');
insert into public.contacts(id,organization_id,account_id,full_name,role_title,normalized_email,verified,verified_at)
  values('61000000-0000-4000-8000-000000000004','61000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000003','Synthetic Buyer','Maintenance','buyer@example.test',true,now());
insert into public.email_recovery_review(id,organization_id,mailbox_id,provider_message_id,provider_thread_id,normalized_from,subject,body_text)
values('61000000-0000-4000-8000-000000000081','61000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000002','unmatched-synthetic','thread-unmatched-synthetic',
  'buyer@example.test','Synthetic reply','I need context');
insert into public.reporting_calendar_days(organization_id,calendar_date,is_business_day,evidence_class,source_sha256,recorded_by)
  select '61000000-0000-4000-8000-000000000001',d::date,extract(isodow from d)<6,'live',repeat('c',64),
    '61000000-0000-4000-8000-000000000005'
  from generate_series('2026-09-23'::date,'2026-09-29'::date,'1 day') d;
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000005',true);

do $$
declare org uuid:='61000000-0000-4000-8000-000000000001'; contact uuid:='61000000-0000-4000-8000-000000000004';
begin
  if app.email_contact_is_ready(org,contact) then raise exception 'IMPORTED_EMAIL_IS_NOT_READY'; end if;
  begin
    perform public.review_email_contact_clearance(org,contact,'READY','QUERETARO',
      'https://example.test/plant','https://example.test/role',
      'Responsible for the target plant purchasing process.',now()+interval '30 days',repeat('a',64));
    raise exception 'UNRESEARCHED_CONTACT_APPROVED';
  exception when others then
    if sqlerrm<>'EMAIL_CLEARANCE_RESEARCH_INCOMPLETE' then raise; end if;
  end;
  if app.reply_response_deadline(org,'2026-09-23T22:00:00Z')<>'2026-09-24T00:00:00Z'::timestamptz then
    raise exception 'BEFORE_18_DEADLINE_WRONG'; end if;
  if app.reply_response_deadline(org,'2026-09-24T00:00:00Z')<>'2026-09-24T18:00:00Z'::timestamptz then
    raise exception 'AT_18_MUST_BE_NEXT_NOON'; end if;
  if app.reply_response_deadline(org,'2026-09-27T16:00:00Z')<>'2026-09-28T18:00:00Z'::timestamptz then
    raise exception 'WEEKEND_MUST_BE_MONDAY_NOON'; end if;
end $$;

do $$
declare org uuid:='61000000-0000-4000-8000-000000000001'; review_id uuid:='61000000-0000-4000-8000-000000000081'; r jsonb;
begin
  if jsonb_array_length(public.read_email_recovery_overview(org)->'unmatched')<>1 then
    raise exception 'UNMATCHED_REPLY_NOT_IN_TRIAGE'; end if;
  r:=public.review_unmatched_email(org,review_id,'NEEDS_CONTEXT','Find the original Gmail thread',repeat('d',64));
  if r->>'status'<>'NEEDS_CONTEXT' then raise exception 'UNMATCHED_CONTEXT_NOT_RECORDED'; end if;
  r:=public.review_unmatched_email(org,review_id,'NEEDS_CONTEXT','Find the original Gmail thread',repeat('d',64));
  if r->>'replayed'<>'true' then raise exception 'UNMATCHED_IDEMPOTENCY_FAILED'; end if;
  r:=public.review_unmatched_email(org,review_id,'REVIEWED','Original thread was read and routed',repeat('e',64));
  if r->>'status'<>'REVIEWED' or jsonb_array_length(public.read_email_recovery_overview(org)->'unmatched')<>0 then
    raise exception 'UNMATCHED_REVIEW_STILL_PENDING'; end if;
end $$;

set local session_replication_role=replica;
update public.accounts set research_status='VERIFIED',research_verified_at=now(),
  research_verified_by='61000000-0000-4000-8000-000000000005'
  where id='61000000-0000-4000-8000-000000000003';
insert into public.research_contact_candidates(organization_id,account_id,full_name,role_title,role_category,
  normalized_email,research_status,promoted_contact_id,idempotency_key,created_by,verified_by,verified_at)
values('61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000003',
  'Synthetic Buyer','Maintenance','MAINTENANCE','buyer@example.test','PROMOTED',
  '61000000-0000-4000-8000-000000000004',repeat('b',64),
  '61000000-0000-4000-8000-000000000005','61000000-0000-4000-8000-000000000005',now());
set local session_replication_role=origin;

do $$
declare org uuid:='61000000-0000-4000-8000-000000000001'; contact uuid:='61000000-0000-4000-8000-000000000004';
  r jsonb; expiry timestamptz:=date_trunc('second',now()+interval '30 days');
begin
  r:=public.review_email_contact_clearance(org,contact,'READY','QUERETARO',
    'https://example.test/plant','https://example.test/role',
    'Responsible for the target plant purchasing process.',expiry,repeat('a',64));
  if r->>'status'<>'READY' or not app.email_contact_is_ready(org,contact) then
    raise exception 'VERIFIED_CONTACT_NOT_READY'; end if;
  if public.read_email_contact_inventory(org)->>'ready'<>'1' then raise exception 'READY_INVENTORY_NOT_VISIBLE'; end if;
  r:=public.review_email_contact_clearance(org,contact,'READY','QUERETARO',
    'https://example.test/plant','https://example.test/role',
    'Responsible for the target plant purchasing process.',expiry,repeat('a',64));
  if r->>'replayed'<>'true' then raise exception 'IDEMPOTENCY_REPLAY_FAILED'; end if;
  begin
    perform public.review_email_contact_clearance(org,contact,'HELD',null,null,null,null,null,repeat('a',64));
    raise exception 'IDEMPOTENCY_REUSE_ACCEPTED';
  exception when others then if sqlerrm<>'EMAIL_CLEARANCE_IDEMPOTENCY_REUSE' then raise; end if; end;
  perform public.review_email_contact_clearance(org,contact,'HELD',null,null,null,null,null,repeat('c',64));
  if app.email_contact_is_ready(org,contact) then raise exception 'HELD_CONTACT_STILL_READY'; end if;
  r:=public.review_email_contact_clearance(org,contact,'READY','QUERETARO',
    'https://example.test/plant','https://example.test/role',
    'Responsible for the target plant purchasing process.',expiry,repeat('a',64));
  if r->>'status'<>'READY' or r->>'replayed'<>'true' or app.email_contact_is_ready(org,contact) then
    raise exception 'HISTORICAL_REPLAY_CHANGED_CURRENT_DECISION'; end if;
end $$;
rollback;
select 'EMAIL_CONTACT_RESEARCH_CLEARANCE_IDEMPOTENCY_SLA_PASS' as result;
