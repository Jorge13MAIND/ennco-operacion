\set ON_ERROR_STOP on
-- Base efímera del runner. Los únicos bypass son para cargar fixtures.
insert into public.organizations(id,slug,legal_name)
values ('61000000-0000-4000-8000-000000000001','safety-fixture','Synthetic Safety');
insert into app.private_runtime_config(organization_id,prequote_ingest_secret,suppression_hmac_secret,dispatch_secret)
values ('61000000-0000-4000-8000-000000000001',repeat('p',64),repeat('a',64),'synthetic-dispatch-secret-for-test-only');

set session_replication_role=replica;
insert into public.mailboxes(id,organization_id,normalized_email,domain,sender_name,direct_lane_status)
values ('61000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000001','sender@example.test','example.test','Synthetic','CONNECTED');
insert into public.messages(id,organization_id,mailbox_id,enrollment_id,contact_id,lane,direction,status,touch_number,idempotency_key,correlation_id,created_at,sent_at,updated_at)
select ('61000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002',
 ('61000000-0000-4000-8000-'||lpad((n+100)::text,12,'0'))::uuid,'61000000-0000-4000-8000-000000000004',
 'DIRECT','OUTBOUND',s::public.message_status,1,'synthetic-'||n,gen_random_uuid(),
 case when n=11 then now()-interval '1 day' else now() end,
 case when s in ('SENT','DELIVERED','BOUNCED') then now() else null end,
 case when n=15 then now()-interval '20 minutes' else now() end
from (values (10,'SENT'),(11,'BOUNCED'),(12,'QUARANTINED'),(13,'DRY_RUN'),(14,'FAILED'),(15,'SENDING')) v(n,s);
set session_replication_role=origin;

do $$
begin
 if app.direct_lane_sent_today('61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002')<>4 then
   raise exception 'COUNT_MUST_INCLUDE_BOUNCE_QUARANTINE_AND_SENT_DATE'; end if;
 if app.direct_lane_new_today('61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002')<>4 then
   raise exception 'FIRST_TOUCH_COUNT_DRIFT'; end if;
 if app.direct_lane_sent_today(gen_random_uuid(),'61000000-0000-4000-8000-000000000002')<>0 then
   raise exception 'TENANT_COUNT_LEAK'; end if;
 if has_function_privilege('anon','app.direct_lane_sent_today(uuid,uuid)','execute') then
   raise exception 'COUNTER_PRIVILEGE_EXPANSION'; end if;
end $$;

-- Firma real con secreto sintético. No se sustituye verify_dispatch_proof.
create function pg_temp.proof(target_org uuid,target_command text,target_parts text[],
 out command_id text,out nonce uuid,out expires_at timestamptz,out signature text)
language plpgsql set search_path=public,app,extensions,pg_temp as $$
declare payload text; secret text;
begin
 select dispatch_secret into secret from app.private_runtime_config where organization_id=target_org;
 nonce:=gen_random_uuid(); expires_at:=date_trunc('second',clock_timestamp()+interval '5 minutes');
 command_id:=target_command||':'||nonce;
 payload:=encode(digest(convert_to(array_to_string(array[target_command]||target_parts,E'\n'),'utf8'),'sha256'),'hex');
 signature:=encode(app.hmac(convert_to(concat_ws(E'\n',target_org::text,command_id,nonce::text,
 to_char(expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),payload),'UTF8'),convert_to(secret,'UTF8'),'sha256'),'hex');
end $$;

do $$
declare p record; r jsonb; org uuid:='61000000-0000-4000-8000-000000000001';
 mid uuid:='61000000-0000-4000-8000-000000000015';
begin
 select * into p from pg_temp.proof(org,'settle_direct_lane_dispatch',array[org::text,mid::text,'AMBIGUOUS','','','','TIMEOUT']);
 r:=public.settle_direct_lane_dispatch(org,mid,'AMBIGUOUS',null,null,null,'TIMEOUT',p.command_id,p.nonce,p.expires_at,p.signature);
 if r->>'outcome'<>'AMBIGUOUS' then raise exception 'AMBIGUOUS_NOT_SETTLED %',r; end if;
 if (select status from public.messages where id=mid)<>'QUARANTINED' then raise exception 'AMBIGUOUS_RETRYABLE'; end if;
 if (select direct_lane_status from public.mailboxes where id='61000000-0000-4000-8000-000000000002')<>'PAUSED' then raise exception 'MAILBOX_NOT_PAUSED'; end if;
 if app.direct_lane_sent_today(org,'61000000-0000-4000-8000-000000000002')<>4 then raise exception 'QUOTA_REFUNDED'; end if;
 select * into p from pg_temp.proof(org,'settle_direct_lane_dispatch',array[org::text,mid::text,'FAILED','','','','TIMEOUT']);
 r:=public.settle_direct_lane_dispatch(org,mid,'FAILED',null,null,null,'TIMEOUT',p.command_id,p.nonce,p.expires_at,p.signature);
 if r->>'status'<>'BLOCKED' then raise exception 'QUARANTINE_CAN_BECOME_FAILED'; end if;
end $$;
select 'COUNTS_TENANT_PERMISSIONS_AMBIGUITY_PASS' as result;
