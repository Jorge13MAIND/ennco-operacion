\set ON_ERROR_STOP on

insert into public.organizations(id,slug,legal_name) values
  ('24000000-0000-4000-8000-000000000001','m024-ennco','ENNCO Synthetic Infrastructure'),
  ('24000000-0000-4000-8000-000000000002','m024-other','Other Synthetic Organization'),
  ('24000000-0000-4000-8000-000000000003','m024-snapshot','Snapshot Synthetic Organization');

insert into public.organization_users(organization_id,user_id,role) values
  ('24000000-0000-4000-8000-000000000001','24100000-0000-4000-8000-000000000001','ennco_admin'),
  ('24000000-0000-4000-8000-000000000001','24100000-0000-4000-8000-000000000002','ennco_operator'),
  ('24000000-0000-4000-8000-000000000001','24100000-0000-4000-8000-000000000003','auditor_readonly'),
  ('24000000-0000-4000-8000-000000000002','24200000-0000-4000-8000-000000000001','ennco_admin'),
  ('24000000-0000-4000-8000-000000000003','24300000-0000-4000-8000-000000000003','ennco_admin');

do $$
declare result jsonb;
begin
  result:=app.evaluate_outbound_provider_readiness_as_system(
    '24000000-0000-4000-8000-000000000001','2026-10-03T16:00:00Z'
  );
  if result->>'state'<>'UNKNOWN' or result->>'release_state'<>'HOLD'
    or not (result->'blockers' ? 'APOLLO_ACCOUNT_NOT_CONFIGURED')
  then raise exception 'M024_MISSING_ACCOUNT_DID_NOT_FAIL_CLOSED'; end if;
end $$;

insert into public.provider_accounts(
  id,organization_id,provider_code,environment,ownership_status,terms_status,plan_name,
  legal_owner,seat_count,billing_frequency,mfa_status,recovery_status,monthly_budget_mxn,
  hard_cap_mxn,evidence_sha256,renewal_at,delivery_status,last_audited_at,verified_by,verified_at,active
) values (
  '24300000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001',
  'APOLLO','PRODUCTION','ENNCO_OWNED','VERIFIED','Professional','ENNCO',1,'MONTHLY',
  'ENABLED','VERIFIED',1782,1782,repeat('a',64),'2026-11-01T00:00:00Z','READY',
  '2026-10-03T15:00:00Z','24100000-0000-4000-8000-000000000001','2026-10-03T15:00:00Z',true
),(
  '24300000-0000-4000-8000-000000000002','24000000-0000-4000-8000-000000000002',
  'APOLLO','PRODUCTION','ENNCO_OWNED','VERIFIED','Professional','ENNCO',1,'MONTHLY',
  'ENABLED','VERIFIED',1782,1782,repeat('b',64),'2026-11-01T00:00:00Z','READY',
  '2026-10-03T15:00:00Z','24200000-0000-4000-8000-000000000001','2026-10-03T15:00:00Z',true
);

insert into public.provider_credit_budgets(
  id,organization_id,provider_account_id,cycle_start,cycle_end,credit_limit,credits_consumed,
  research_credit_cap,infrastructure_credit_spend,phone_enrichment_allowed,status,evidence_sha256,observed_at
) values (
  '24400000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001',
  '24300000-0000-4000-8000-000000000001','2026-10-01','2026-11-01',500,10,500,0,false,
  'ACTIVE',repeat('c',64),'2026-10-03T15:00:00Z'
);

insert into public.outreach_domains(
  id,organization_id,provider_account_id,normalized_domain,asset_source,ownership_status,
  lifecycle_status,auth_spf,auth_dkim,auth_dmarc,auth_tls,postmaster_verified,reputation_status,
  registered_at,expires_at,evidence_sha256,verified_at
) values
  ('24500000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001',
   '24300000-0000-4000-8000-000000000001','enncoindustrial.invalid','INDEPENDENT_REGISTRAR',
   'ENNCO_OWNED','READY',true,true,true,true,true,'HEALTHY','2026-08-20T00:00:00Z',
   '2027-08-20T00:00:00Z',repeat('d',64),'2026-10-03T15:00:00Z'),
  ('24500000-0000-4000-8000-000000000002','24000000-0000-4000-8000-000000000001',
   '24300000-0000-4000-8000-000000000001','enncoenergia.invalid','INDEPENDENT_REGISTRAR',
   'ENNCO_OWNED','READY',true,true,true,true,true,'HEALTHY','2026-08-20T00:00:00Z',
   '2027-08-20T00:00:00Z',repeat('e',64),'2026-10-03T15:00:00Z');

insert into public.mailboxes(
  id,organization_id,normalized_email,domain,sender_name,provider,domain_ready_at,
  auth_spf,auth_dkim,auth_dmarc,auth_tls,health_status,kill_switch,provider_account_id,
  outreach_domain_id,provider_external_ref_sha256,ownership_status,credential_status,
  warmup_started_at,warmup_status,sender_identity_verified,gmail_seed_verified,
  outlook_seed_verified,yahoo_seed_verified,reply_sync_verified,list_unsubscribe_verified,
  one_click_unsubscribe_verified,provider_evidence_sha256,provider_daily_limit,last_provider_health_at
) values
  ('24600000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001',
   'francisco@enncoindustrial.invalid','enncoindustrial.invalid','Francisco Cuellar','gmail',
   '2026-08-23T16:00:00Z',true,true,true,true,'HEALTHY',false,
   '24300000-0000-4000-8000-000000000001','24500000-0000-4000-8000-000000000001',repeat('1',64),
   'ENNCO_OWNED','OAUTH_CONNECTED','2026-08-23T16:00:00Z','HEALTHY',true,true,true,true,true,true,true,
   repeat('f',64),2,'2026-10-03T15:30:00Z'),
  ('24600000-0000-4000-8000-000000000002','24000000-0000-4000-8000-000000000001',
   'fcuellar@enncoindustrial.invalid','enncoindustrial.invalid','Francisco Cuellar','gmail',
   '2026-08-23T16:00:00Z',true,true,true,true,'HEALTHY',false,
   '24300000-0000-4000-8000-000000000001','24500000-0000-4000-8000-000000000001',repeat('2',64),
   'ENNCO_OWNED','OAUTH_CONNECTED','2026-08-23T16:00:00Z','HEALTHY',true,true,true,true,true,true,true,
   repeat('f',64),2,'2026-10-03T15:30:00Z'),
  ('24600000-0000-4000-8000-000000000003','24000000-0000-4000-8000-000000000001',
   'francisco@enncoenergia.invalid','enncoenergia.invalid','Francisco Cuellar','gmail',
   '2026-08-23T16:00:00Z',true,true,true,true,'HEALTHY',false,
   '24300000-0000-4000-8000-000000000001','24500000-0000-4000-8000-000000000002',repeat('3',64),
   'ENNCO_OWNED','OAUTH_CONNECTED','2026-08-23T16:00:00Z','HEALTHY',true,true,true,true,true,true,true,
   repeat('f',64),2,'2026-10-03T15:30:00Z'),
  ('24600000-0000-4000-8000-000000000004','24000000-0000-4000-8000-000000000001',
   'fcuellar@enncoenergia.invalid','enncoenergia.invalid','Francisco Cuellar','gmail',
   '2026-08-23T16:00:00Z',true,true,true,true,'HEALTHY',false,
   '24300000-0000-4000-8000-000000000001','24500000-0000-4000-8000-000000000002',repeat('4',64),
   'ENNCO_OWNED','OAUTH_CONNECTED','2026-08-23T16:00:00Z','HEALTHY',true,true,true,true,true,true,true,
   repeat('f',64),2,'2026-10-03T15:30:00Z');

insert into public.provider_activation_gates(
  organization_id,provider_account_id,gate_code,status,evidence_sha256,evidence_class,recorded_by,recorded_at
)
select '24000000-0000-4000-8000-000000000001','24300000-0000-4000-8000-000000000001',
  gate_code,'PASS',encode(digest('m024:'||gate_code,'sha256'),'hex'),'live',
  '24100000-0000-4000-8000-000000000001','2026-10-03T15:00:00Z'
from unnest(app.provider_control_requirements()) gate_code;

do $$
declare result jsonb;
begin
  result:=app.evaluate_outbound_provider_readiness_as_system(
    '24000000-0000-4000-8000-000000000001','2026-10-03T16:00:00Z'
  );
  if result->>'state'<>'WARMING' or result->>'release_state'<>'HOLD'
    or (result->>'warmup_days')::integer<>41
    or not (result->'blockers' ? 'APOLLO_WARMUP_UNDER_42_DAYS')
  then raise exception 'M024_41_DAY_WARMUP_FALSE_RESULT:%',result; end if;

  update public.mailboxes
  set warmup_started_at='2026-08-20T16:00:00Z',domain_ready_at='2026-08-20T16:00:00Z'
  where organization_id='24000000-0000-4000-8000-000000000001';

  result:=app.evaluate_outbound_provider_readiness_as_system(
    '24000000-0000-4000-8000-000000000001','2026-10-03T16:00:00Z'
  );
  if result->>'state'<>'READY' or result->>'release_state'<>'READY_FOR_CANARY'
    or (result->>'domains_ready')::integer<>2 or (result->>'mailboxes_ready')::integer<>4
    or (result->>'activation_gates_passed')::integer<>15
    or (result->>'live_gates_passed')::integer<>15
    or jsonb_array_length(result->'blockers')<>0
  then raise exception 'M024_READY_CONTRACT_FAILED:%',result; end if;

  update public.outreach_domains set asset_source='APOLLO_GENERATED'
  where id='24500000-0000-4000-8000-000000000001';
  result:=app.evaluate_outbound_provider_readiness_as_system(
    '24000000-0000-4000-8000-000000000001','2026-10-03T16:00:00Z'
  );
  if result->>'release_state'<>'HOLD' or not (result->'blockers' ? 'OUTREACH_DOMAINS_NOT_READY')
  then raise exception 'M024_APOLLO_GENERATED_DOMAIN_FALSE_PASS'; end if;
  update public.outreach_domains set asset_source='INDEPENDENT_REGISTRAR'
  where id='24500000-0000-4000-8000-000000000001';

  update public.provider_credit_budgets set phone_enrichment_allowed=true
  where id='24400000-0000-4000-8000-000000000001';
  result:=app.evaluate_outbound_provider_readiness_as_system(
    '24000000-0000-4000-8000-000000000001','2026-10-03T16:00:00Z'
  );
  if result->>'release_state'<>'HOLD' or not (result->'blockers' ? 'APOLLO_CREDIT_BUDGET_INVALID')
  then raise exception 'M024_PHONE_ENRICHMENT_FALSE_PASS'; end if;
  update public.provider_credit_budgets set phone_enrichment_allowed=false
  where id='24400000-0000-4000-8000-000000000001';
end $$;

insert into public.messages(organization_id,direction,status,idempotency_key,correlation_id)
values ('24000000-0000-4000-8000-000000000001','OUTBOUND','DRY_RUN','m024-dry-run',gen_random_uuid());

update public.provider_accounts set active=false where id='24300000-0000-4000-8000-000000000001';
do $$ begin
  begin
    insert into public.messages(organization_id,mailbox_id,direction,status,idempotency_key,correlation_id)
    values ('24000000-0000-4000-8000-000000000001','24600000-0000-4000-8000-000000000001',
      'OUTBOUND','QUEUED','m024-real-blocked',gen_random_uuid());
    raise exception 'M024_EXPECTED_REAL_OUTBOUND_HOLD';
  exception when others then
    if sqlerrm<>'PROVIDER_INFRASTRUCTURE_NOT_READY' then raise; end if;
  end;
end $$;
update public.provider_accounts set active=true where id='24300000-0000-4000-8000-000000000001';

set request.jwt.claim.sub='24100000-0000-4000-8000-000000000001';
set request.jwt.claim.aal='aal2';
set role authenticated;

do $$
declare result jsonb;
begin
  result:=public.evaluate_outbound_provider_readiness(
    '24000000-0000-4000-8000-000000000001','2026-10-03T16:00:00Z'
  );
  if result->>'state'<>'READY' then raise exception 'M024_AUTHENTICATED_READ_FAILED'; end if;
  if (select count(*) from public.provider_accounts where organization_id='24000000-0000-4000-8000-000000000002')<>0
  then raise exception 'M024_CROSS_TENANT_RLS_READ'; end if;
  begin
    insert into public.provider_accounts(
      organization_id,provider_code,environment,evidence_sha256
    ) values ('24000000-0000-4000-8000-000000000001','RESEND','PRODUCTION',repeat('9',64));
    raise exception 'M024_EXPECTED_DIRECT_DML_DENIAL';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

set request.jwt.claim.sub='24300000-0000-4000-8000-000000000003';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$
declare
  snapshot jsonb:=jsonb_build_object(
    'account',jsonb_build_object(
      'provider_code','APOLLO','environment','PRODUCTION','ownership_status','ENNCO_OWNED',
      'terms_status','VERIFIED','plan_name','Professional','legal_owner','ENNCO','seat_count',1,
      'billing_frequency','MONTHLY','external_account_ref_sha256','',
      'mfa_status','ENABLED','recovery_status','VERIFIED','monthly_budget_mxn',1782,
      'hard_cap_mxn',1782,'evidence_sha256',repeat('6',64),'renewal_at','2026-09-01T00:00:00Z',
      'delivery_status','BLOCKED','last_audited_at','2026-08-20T20:00:00Z',
      'verified_at','2026-08-20T20:00:00Z','active',false
    ),
    'budget',jsonb_build_object(
      'cycle_start','2026-08-01','cycle_end','2026-09-01','credit_limit',500,
      'credits_consumed',0,'research_credit_cap',500,'infrastructure_credit_spend',0,
      'phone_enrichment_allowed',false,'status','ACTIVE','evidence_sha256',repeat('7',64),
      'observed_at','2026-08-20T20:00:00Z'
    ),
    'domains','[]'::jsonb,'mailboxes','[]'::jsonb,'gates','[]'::jsonb
  );
  created jsonb;
  replay jsonb;
begin
  created:=public.apply_outbound_provider_snapshot(
    '24000000-0000-4000-8000-000000000003',snapshot,repeat('8',64)
  );
  replay:=public.apply_outbound_provider_snapshot(
    '24000000-0000-4000-8000-000000000003',snapshot,repeat('8',64)
  );
  if created->>'status'<>'CREATED' or replay->>'status'<>'DUPLICATE'
    or (created->>'domains_recorded')::integer<>0
    or (select count(*) from public.provider_control_commands
        where organization_id='24000000-0000-4000-8000-000000000003')<>1
  then raise exception 'M024_PROVIDER_SNAPSHOT_IDEMPOTENCY_FAILED'; end if;
  begin
    perform public.apply_outbound_provider_snapshot(
      '24000000-0000-4000-8000-000000000003',
      jsonb_set(snapshot,'{account,plan_name}','"Basic"'::jsonb),repeat('8',64)
    );
    raise exception 'M024_EXPECTED_SNAPSHOT_IDEMPOTENCY_DRIFT';
  exception when others then
    if sqlerrm<>'PROVIDER_SNAPSHOT_IDEMPOTENCY_DRIFT' then raise; end if;
  end;
end $$;
reset role;

set request.jwt.claim.aal='aal1';
set role authenticated;
do $$ begin
  begin
    perform public.evaluate_outbound_provider_readiness(
      '24000000-0000-4000-8000-000000000001','2026-10-03T16:00:00Z'
    );
    raise exception 'M024_EXPECTED_AAL1_DENIAL';
  exception when others then
    if sqlerrm<>'PROVIDER_READ_AAL2_REQUIRED' then raise; end if;
  end;
end $$;
reset role;

select 'PROVIDER_INFRASTRUCTURE_CONTROL_GATE_PASS' as result;
