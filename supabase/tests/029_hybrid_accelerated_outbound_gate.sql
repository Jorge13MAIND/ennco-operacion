\set ON_ERROR_STOP on

insert into public.organizations(id,slug,legal_name) values
  ('29000000-0000-4000-8000-000000000001','m029-ennco','ENNCO M029 Synthetic'),
  ('29000000-0000-4000-8000-000000000002','m029-other','M029 Other Tenant');
insert into public.organization_users(organization_id,user_id,role) values
  ('29000000-0000-4000-8000-000000000001','29100000-0000-4000-8000-000000000001','teckel_admin'),
  ('29000000-0000-4000-8000-000000000001','29100000-0000-4000-8000-000000000002','teckel_operator'),
  ('29000000-0000-4000-8000-000000000002','29100000-0000-4000-8000-000000000003','teckel_admin');
insert into public.runtime_controls(organization_id,global_kill_switch,external_send_allowed) values
  ('29000000-0000-4000-8000-000000000001',true,false),
  ('29000000-0000-4000-8000-000000000002',true,false);
insert into app.private_runtime_config(organization_id,prequote_ingest_secret,suppression_hmac_secret) values
  ('29000000-0000-4000-8000-000000000001',repeat('p',64),repeat('a',64)),
  ('29000000-0000-4000-8000-000000000002',repeat('q',64),repeat('b',64));

do $$ begin
  perform set_config('app.research_rpc_write','true',true);
  insert into public.accounts(id,organization_id,legal_name,normalized_name,primary_domain,tier,evidence_class,source_confidence) values
    ('29200000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001','Synthetic Tier 1','synthetic-tier-1','synthetic-tier1.invalid',1,'live','VERIFIED');
  insert into public.contacts(id,organization_id,account_id,full_name,role_title,normalized_email,verified,verified_at,source_confidence) values
    ('29300000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001','29200000-0000-4000-8000-000000000001','Synthetic Buyer','Compras','buyer@synthetic-tier1.invalid',true,clock_timestamp(),'VERIFIED');
end $$;
insert into public.campaigns(id,organization_id,name,status,manifest_json,manifest_sha256,approved_by,approved_at) values
  ('29400000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001','M029 Synthetic','APPROVED',
   jsonb_build_object('hybrid',jsonb_build_object(
     'copy_sha256',repeat('2',64),'sequence_sha256',repeat('2',64),
     'envelopes',jsonb_build_array(
       jsonb_build_object('enrollment_id','29600000-0000-4000-8000-000000000001','touch_number',1,
         'normalized_to','buyer@synthetic-tier1.invalid',
         'subject_sha256',encode(digest('Rango preliminar','sha256'),'hex'),
         'body_sha256',encode(digest('Hola. Preparé un rango preliminar de ahorro para su planta. ¿Te interesa revisarlo?','sha256'),'hex'))
     )
   )),repeat('1',64),'29100000-0000-4000-8000-000000000001',clock_timestamp());
insert into public.sequence_versions(id,organization_id,campaign_id,version,sender_name,sender_title,content_sha256,approved_by,approved_at) values
  ('29500000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001','29400000-0000-4000-8000-000000000001',1,'Francisco Cuellar','ENNCO',repeat('2',64),'29100000-0000-4000-8000-000000000001',clock_timestamp());

create or replace function app.m029_test_mailbox_snapshot(
  target_email text,target_domain text,target_route text,target_registered_at timestamptz,target_warmup_at timestamptz
) returns jsonb language sql volatile set search_path=pg_catalog as $$
  select jsonb_build_object(
    'normalized_email',target_email,'domain',target_domain,'eligibility_route',target_route,
    'domain_role',case when target_route='EXISTING_PRIMARY_GMAIL_RAMP' then 'PRIMARY_CORPORATE' else 'OUTREACH_ISOLATED' end,
    'custody_status',case when target_route='EXISTING_PRIMARY_GMAIL_RAMP' then 'TECKEL_MANAGED_FOR_ENNCO' else 'APOLLO_PROVISIONED_TECKEL_CUSTODY' end,
    'provider',case when target_route='EXISTING_PRIMARY_GMAIL_RAMP' then 'gmail' else 'apollo_shared_smtp' end,
    'domain_ready_at',target_registered_at,'domain_registered_at',target_registered_at,
    'warmup_started_at',target_warmup_at,'warmup_status',case when target_route='EXISTING_PRIMARY_GMAIL_RAMP' then 'NOT_STARTED' else 'HEALTHY' end,
    'auth_spf',true,'auth_dkim',true,'auth_dmarc',true,'auth_tls',true,'health_status','HEALTHY','kill_switch',false,
    'credential_status','OAUTH_CONNECTED','sender_identity_verified',true,'gmail_seed_verified',true,
    'outlook_seed_verified',true,'yahoo_seed_verified',true,'reply_sync_verified',true,
    'human_history_verified',target_route='EXISTING_PRIMARY_GMAIL_RAMP','blocklist_status','CLEAR',
    'route_evidence_sha256',repeat('a',64),'route_evidence_at',clock_timestamp(),
    'provider_daily_limit',case when target_route='EXISTING_PRIMARY_GMAIL_RAMP' then 20 else 5 end,
    'last_provider_health_at',clock_timestamp()
  )
$$;

create or replace function app.m029_test_observation(
  target_valid integer,target_attempted integer,target_bounces integer,target_complaints integer,target_observed_at timestamptz
) returns jsonb language sql immutable set search_path=pg_catalog as $$
  select jsonb_build_object(
    'valid_deliveries',target_valid,'attempted_deliveries',target_attempted,
    'hard_bounces',target_bounces,'spam_complaints',target_complaints,
    'delivery_rate',case when target_attempted=0 then null else round(target_valid::numeric/target_attempted::numeric,6) end,
    'reply_sync_p95_seconds',60,'positive_reply_sla_breaches',0,
    'provider_reconciled',true,'suppression_reconciled',true,'identity_unambiguous',true,
    'evidence_sha256',repeat('b',64),'evidence_class','live','observed_at',target_observed_at
  )
$$;

set request.jwt.claim.sub='29100000-0000-4000-8000-000000000001';
set request.jwt.claim.aal='aal1';
set role authenticated;
do $$ begin
  begin
    perform public.evaluate_hybrid_outbound_readiness('29000000-0000-4000-8000-000000000001',clock_timestamp());
    raise exception 'EXPECTED_M029_AAL1_REJECTION';
  exception when others then if sqlerrm<>'HYBRID_OUTBOUND_READ_AAL2_REQUIRED' then raise; end if; end;
end $$;
reset role;

set request.jwt.claim.aal='aal2';
set role authenticated;
select public.apply_hybrid_mailbox_snapshot(
  '29000000-0000-4000-8000-000000000001',
  app.m029_test_mailbox_snapshot('contacto@ennco.com.mx','ennco.com.mx','EXISTING_PRIMARY_GMAIL_RAMP',clock_timestamp()-interval '179 days',null),
  repeat('1',64)
);
reset role;

set request.jwt.claim.aal='aal2';
set role authenticated;
select public.record_hybrid_mailbox_observation(
  '29000000-0000-4000-8000-000000000001',
  (select id from public.mailboxes where organization_id='29000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx'),
  app.m029_test_observation(0,0,0,0,clock_timestamp()),repeat('2',64)
);
reset role;

do $$ declare result jsonb; begin
  select app.evaluate_hybrid_mailbox_as_system(
    '29000000-0000-4000-8000-000000000001',id,clock_timestamp()) into result
  from public.mailboxes where organization_id='29000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx';
  if result->>'state'<>'BLOCKED' or not (result->'blockers' ? 'PRIMARY_DOMAIN_UNDER_180_DAYS')
    then raise exception 'M029_179_DAY_PRIMARY_ACCEPTED:%',result; end if;
end $$;

set role authenticated;
select public.apply_hybrid_mailbox_snapshot(
  '29000000-0000-4000-8000-000000000001',
  app.m029_test_mailbox_snapshot('contacto@ennco.com.mx','ennco.com.mx','EXISTING_PRIMARY_GMAIL_RAMP',clock_timestamp()-interval '180 days 1 hour',null),
  repeat('3',64)
);
reset role;

do $$ declare result jsonb; begin
  select app.evaluate_hybrid_mailbox_as_system('29000000-0000-4000-8000-000000000001',id,clock_timestamp()) into result
  from public.mailboxes where organization_id='29000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx';
  if result->>'state'<>'READY' or result->>'effective_release'<>'READY_FOR_CANARY' or (result->>'daily_cap')::integer<>5
    then raise exception 'M029_PRIMARY_FIVE_CANARY_NOT_READY:%',result; end if;
end $$;

alter table public.campaign_enrollments disable trigger campaign_enrollments_aaa_annex_a_suppression;
insert into public.campaign_enrollments(id,organization_id,campaign_id,sequence_version_id,account_id,contact_id,mailbox_id,status) values
  ('29600000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001','29400000-0000-4000-8000-000000000001',
   '29500000-0000-4000-8000-000000000001','29200000-0000-4000-8000-000000000001','29300000-0000-4000-8000-000000000001',
   (select id from public.mailboxes where organization_id='29000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx'),'PENDING');

set role authenticated;
do $$ declare mailbox_id_value uuid; begin
  select id into mailbox_id_value from public.mailboxes where organization_id='29000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx';
  begin
    perform public.create_hybrid_outbound_release(
      '29000000-0000-4000-8000-000000000001',mailbox_id_value,'29400000-0000-4000-8000-000000000001','ACCELERATED_TIER1_CANARY',
      repeat('1',64),repeat('4',64),repeat('2',64),repeat('2',64),clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 day',
      array['29600000-0000-4000-8000-000000000001'::uuid,'29600000-0000-4000-8000-000000000002','29600000-0000-4000-8000-000000000003','29600000-0000-4000-8000-000000000004','29600000-0000-4000-8000-000000000005','29600000-0000-4000-8000-000000000006'],repeat('4',64));
    raise exception 'EXPECTED_M029_FIVE_CANARY_CAP';
  exception when others then if sqlerrm<>'HYBRID_RELEASE_DAILY_CAP_EXCEEDED' then raise; end if; end;
  perform public.create_hybrid_outbound_release(
    '29000000-0000-4000-8000-000000000001',mailbox_id_value,'29400000-0000-4000-8000-000000000001','ACCELERATED_TIER1_CANARY',
    repeat('1',64),repeat('8',64),repeat('2',64),repeat('2',64),clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 day',
    array['29600000-0000-4000-8000-000000000001'::uuid],repeat('5',64));
end $$;
reset role;

update public.campaign_enrollments set status='ACTIVE' where id='29600000-0000-4000-8000-000000000001';
alter table public.campaign_enrollments enable trigger campaign_enrollments_aaa_annex_a_suppression;
update public.runtime_controls set global_kill_switch=false,external_send_allowed=true where organization_id='29000000-0000-4000-8000-000000000001';
alter table public.messages disable trigger messages_operations_send_health;
alter table public.messages disable trigger messages_control_cadence_send_health;
alter table public.messages disable trigger messages_aaa_m025_annex_a_release;

insert into public.messages(
  id,organization_id,enrollment_id,mailbox_id,contact_id,direction,status,touch_number,normalized_to,normalized_from,subject,body_text,idempotency_key,correlation_id
) values (
  '29700000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001','29600000-0000-4000-8000-000000000001',
  (select id from public.mailboxes where organization_id='29000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx'),
  '29300000-0000-4000-8000-000000000001','OUTBOUND','QUEUED',1,'buyer@synthetic-tier1.invalid','contacto@ennco.com.mx',
  'Rango preliminar','Hola. Preparé un rango preliminar de ahorro para su planta. ¿Te interesa revisarlo?','m029-valid-message','29700000-0000-4000-8000-000000000099'
);

do $$ begin
  begin
    insert into public.messages(organization_id,enrollment_id,mailbox_id,contact_id,direction,status,touch_number,normalized_to,normalized_from,subject,body_text,idempotency_key,correlation_id)
    select '29000000-0000-4000-8000-000000000001','29600000-0000-4000-8000-000000000001',id,'29300000-0000-4000-8000-000000000001',
      'OUTBOUND','QUEUED',1,'buyer@synthetic-tier1.invalid','contacto@ennco.com.mx','Link','Visita https://synthetic.invalid','m029-link-message',gen_random_uuid()
    from public.mailboxes where organization_id='29000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx';
    raise exception 'EXPECTED_M029_FIRST_TOUCH_LINK_REJECTION';
  exception when others then if sqlerrm<>'HYBRID_FIRST_TOUCH_LINK_OR_PDF_FORBIDDEN' then raise; end if; end;
  begin
    insert into public.messages(organization_id,enrollment_id,mailbox_id,contact_id,direction,status,touch_number,normalized_to,normalized_from,subject,body_text,idempotency_key,correlation_id)
    select '29000000-0000-4000-8000-000000000001','29600000-0000-4000-8000-000000000001',id,'29300000-0000-4000-8000-000000000001',
      'OUTBOUND','QUEUED',4,'buyer@synthetic-tier1.invalid','contacto@ennco.com.mx','Cuarto','Seguimiento cuatro','m029-touch-four',gen_random_uuid()
    from public.mailboxes where organization_id='29000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx';
    raise exception 'EXPECTED_M029_TOUCH_LIMIT_REJECTION';
  exception when others then if sqlerrm<>'HYBRID_TOUCH_LIMIT_EXCEEDED' then raise; end if; end;
  begin
    insert into public.messages(organization_id,enrollment_id,mailbox_id,contact_id,direction,status,touch_number,normalized_to,normalized_from,subject,body_text,idempotency_key,correlation_id)
    select '29000000-0000-4000-8000-000000000001','29600000-0000-4000-8000-000000000001',id,'29300000-0000-4000-8000-000000000001',
      'OUTBOUND','QUEUED',1,'other@synthetic-tier1.invalid','contacto@ennco.com.mx','Rango preliminar',
      'Hola. Preparé un rango preliminar de ahorro para su planta. ¿Te interesa revisarlo?','m029-to-drift',gen_random_uuid()
    from public.mailboxes where organization_id='29000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx';
    raise exception 'EXPECTED_M029_TO_IDENTITY_REJECTION';
  exception when others then if sqlerrm<>'HYBRID_TO_IDENTITY_DRIFT' then raise; end if; end;
  begin
    insert into public.messages(organization_id,enrollment_id,mailbox_id,contact_id,direction,status,touch_number,normalized_to,normalized_from,subject,body_text,idempotency_key,correlation_id)
    select '29000000-0000-4000-8000-000000000001','29600000-0000-4000-8000-000000000001',id,'29300000-0000-4000-8000-000000000001',
      'OUTBOUND','QUEUED',1,'buyer@synthetic-tier1.invalid','contacto@ennco.com.mx','Rango preliminar',
      'Cuerpo distinto no aprobado','m029-body-drift',gen_random_uuid()
    from public.mailboxes where organization_id='29000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx';
    raise exception 'EXPECTED_M029_RENDERED_MESSAGE_REJECTION';
  exception when others then if sqlerrm<>'HYBRID_RENDERED_MESSAGE_MANIFEST_DRIFT' then raise; end if; end;
end $$;

alter table public.messages enable trigger messages_operations_send_health;
alter table public.messages enable trigger messages_control_cadence_send_health;
alter table public.messages enable trigger messages_aaa_m025_annex_a_release;

set request.jwt.claim.aal='aal2';
set role authenticated;
select public.record_hybrid_mailbox_observation('29000000-0000-4000-8000-000000000001',
  (select id from public.mailboxes where organization_id='29000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx'),
  app.m029_test_observation(20,20,0,0,clock_timestamp()),repeat('6',64));
reset role;
do $$ declare result jsonb; begin
  select app.evaluate_hybrid_mailbox_as_system('29000000-0000-4000-8000-000000000001',id,clock_timestamp()) into result from public.mailboxes where normalized_email='contacto@ennco.com.mx';
  if (result->>'daily_cap')::integer<>10 then raise exception 'M029_RAMP_20_CAP_INVALID:%',result; end if;
end $$;

set role authenticated;
select public.record_hybrid_mailbox_observation('29000000-0000-4000-8000-000000000001',
  (select id from public.mailboxes where organization_id='29000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx'),
  app.m029_test_observation(50,50,0,0,clock_timestamp()+interval '1 second'),repeat('7',64));
reset role;
do $$ declare result jsonb; begin
  select app.evaluate_hybrid_mailbox_as_system('29000000-0000-4000-8000-000000000001',id,clock_timestamp()+interval '2 seconds') into result from public.mailboxes where normalized_email='contacto@ennco.com.mx';
  if (result->>'daily_cap')::integer<>15 then raise exception 'M029_RAMP_50_CAP_INVALID:%',result; end if;
end $$;

set role authenticated;
select public.record_hybrid_mailbox_observation('29000000-0000-4000-8000-000000000001',
  (select id from public.mailboxes where organization_id='29000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx'),
  app.m029_test_observation(100,100,0,0,clock_timestamp()+interval '2 seconds'),repeat('8',64));
reset role;
do $$ declare result jsonb; begin
  select app.evaluate_hybrid_mailbox_as_system('29000000-0000-4000-8000-000000000001',id,clock_timestamp()+interval '3 seconds') into result from public.mailboxes where normalized_email='contacto@ennco.com.mx';
  if (result->>'daily_cap')::integer<>20 or result->>'effective_release'<>'SCALE_ALLOWED' then raise exception 'M029_RAMP_100_CAP_INVALID:%',result; end if;
end $$;

set role authenticated;
do $$ declare mailbox_id_value uuid; begin
  select id into mailbox_id_value from public.mailboxes where organization_id='29000000-0000-4000-8000-000000000001' and normalized_email='contacto@ennco.com.mx';
  begin
    perform public.record_hybrid_mailbox_observation('29000000-0000-4000-8000-000000000001',mailbox_id_value,
      app.m029_test_observation(99,100,0,0,clock_timestamp()+interval '3 seconds'),repeat('9',64));
    raise exception 'EXPECTED_M029_COUNTER_REGRESSION_REJECTION';
  exception when others then if sqlerrm<>'HYBRID_OBSERVATION_COUNTER_OR_TIME_REGRESSION' then raise; end if; end;
  perform public.record_hybrid_mailbox_observation('29000000-0000-4000-8000-000000000001',mailbox_id_value,
    app.m029_test_observation(100,101,0,1,clock_timestamp()+interval '4 seconds'),repeat('a',64));
end $$;
reset role;
do $$ declare result jsonb; begin
  select app.evaluate_hybrid_mailbox_as_system('29000000-0000-4000-8000-000000000001',id,clock_timestamp()+interval '5 seconds') into result from public.mailboxes where normalized_email='contacto@ennco.com.mx';
  if result->>'effective_release'<>'KILLED' or (result->>'daily_cap')::integer<>0 then raise exception 'M029_COMPLAINT_DID_NOT_KILL:%',result; end if;
end $$;

set role authenticated;
select public.apply_hybrid_mailbox_snapshot('29000000-0000-4000-8000-000000000001',
  app.m029_test_mailbox_snapshot('francisco@enncoindustrial.com','enncoindustrial.com','NEW_ISOLATED_MAILBOX_WARMUP',clock_timestamp()-interval '50 days',clock_timestamp()-interval '41 days'),repeat('b',64));
reset role;
set role authenticated;
select public.record_hybrid_mailbox_observation('29000000-0000-4000-8000-000000000001',
  (select id from public.mailboxes where organization_id='29000000-0000-4000-8000-000000000001' and normalized_email='francisco@enncoindustrial.com'),
  app.m029_test_observation(0,0,0,0,clock_timestamp()),repeat('c',64));
reset role;
do $$ declare result jsonb; begin
  select app.evaluate_hybrid_mailbox_as_system('29000000-0000-4000-8000-000000000001',id,clock_timestamp()) into result from public.mailboxes where normalized_email='francisco@enncoindustrial.com';
  if result->>'state'<>'WARMING' then raise exception 'M029_ISOLATED_41_DAY_ACCEPTED:%',result; end if;
end $$;
set role authenticated;
select public.apply_hybrid_mailbox_snapshot('29000000-0000-4000-8000-000000000001',
  app.m029_test_mailbox_snapshot('francisco@enncoindustrial.com','enncoindustrial.com','NEW_ISOLATED_MAILBOX_WARMUP',clock_timestamp()-interval '50 days',clock_timestamp()-interval '42 days 1 hour'),repeat('d',64));
reset role;
do $$ declare result jsonb; begin
  select app.evaluate_hybrid_mailbox_as_system('29000000-0000-4000-8000-000000000001',id,clock_timestamp()) into result from public.mailboxes where normalized_email='francisco@enncoindustrial.com';
  if result->>'state'<>'READY' or (result->>'daily_cap')::integer<>5 then raise exception 'M029_ISOLATED_42_DAY_NOT_READY:%',result; end if;
end $$;

set request.jwt.claim.sub='29100000-0000-4000-8000-000000000003';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ begin
  begin
    perform public.evaluate_hybrid_outbound_readiness('29000000-0000-4000-8000-000000000001',clock_timestamp());
    raise exception 'EXPECTED_M029_CROSS_TENANT_REJECTION';
  exception when others then if sqlerrm<>'HYBRID_OUTBOUND_READ_AAL2_REQUIRED' then raise; end if; end;
  if has_table_privilege('authenticated','public.hybrid_mailbox_observations','INSERT')
    or has_table_privilege('authenticated','public.hybrid_outbound_releases','UPDATE')
    or has_table_privilege('authenticated','public.hybrid_outbound_release_enrollments','DELETE')
    or has_table_privilege('authenticated','public.hybrid_outbound_command_ledger','TRUNCATE')
  then raise exception 'M029_AUTHENTICATED_DIRECT_DML_PRESENT'; end if;
end $$;
reset role;

do $$ declare result jsonb; begin
  result:=app.evaluate_hybrid_outbound_as_system('29000000-0000-4000-8000-000000000001',clock_timestamp());
  if (result->'inventory'->>'minimum_accounts')::integer<>75
    or (result->'inventory'->>'minimum_contacts')::integer<>150
    or (result->'inventory'->>'operational_accounts')::integer<>150
    or (result->'inventory'->>'operational_contacts')::integer<>300
  then raise exception 'M029_INVENTORY_TARGETS_INVALID:%',result; end if;
end $$;

drop function app.m029_test_mailbox_snapshot(text,text,text,timestamptz,timestamptz);
drop function app.m029_test_observation(integer,integer,integer,integer,timestamptz);

select 'HYBRID_ACCELERATED_OUTBOUND_GATE_PASS' as result;
