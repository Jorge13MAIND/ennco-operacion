\set ON_ERROR_STOP on

insert into public.organizations(id,slug,legal_name) values
  ('31000000-0000-4000-8000-000000000001','m031-ennco','ENNCO M031 Synthetic'),
  ('31000000-0000-4000-8000-000000000002','m031-other','M031 Other Tenant');
insert into public.organization_users(organization_id,user_id,role) values
  ('31000000-0000-4000-8000-000000000001','31100000-0000-4000-8000-000000000001','teckel_admin'),
  ('31000000-0000-4000-8000-000000000002','31100000-0000-4000-8000-000000000002','teckel_admin');
insert into public.runtime_controls(organization_id,global_kill_switch,external_send_allowed) values
  ('31000000-0000-4000-8000-000000000001',true,false),
  ('31000000-0000-4000-8000-000000000002',true,false);
insert into public.suppression_manifests(
  id,organization_id,annex_id,snapshot_sha256,scope_statement,confirmed_at,
  entry_count,alias_count,domain_count,status,evidence_class,imported_by
) values (
  '31200000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001',
  'ENNCO-ANNEX-A-2026-08-13','8e986eff74dee10d3f619f7562ee6b7d18207c3c5e080cd82656cc0e88d46af1',
  'ONLY_THESE_THREE_COMPANIES_AS_OF_CONFIRMATION','2026-08-13T20:24:24Z',3,12,6,'ACTIVE','live',
  '31100000-0000-4000-8000-000000000001'
);
insert into public.suppression_manifest_identities(
  organization_id,manifest_id,entry_ordinal,identity_ordinal,identity_type,identity_hmac,source_entry_sha256
)
select '31000000-0000-4000-8000-000000000001','31200000-0000-4000-8000-000000000001',
  1,ordinal,case when ordinal<=12 then 'NAME' else 'DOMAIN' end,
  encode(digest('m031-identity-'||ordinal::text,'sha256'),'hex'),repeat('a',64)
from generate_series(1,18) ordinal;

create or replace function app.m031_mailbox(target_email text,target_domain text,target_evidence text)
returns jsonb
language sql
volatile
set search_path=pg_catalog
as $$
  select jsonb_build_object(
    'normalized_email',target_email,'domain',target_domain,'domain_ready_at',current_date::timestamptz-interval '43 days',
    'auth_spf',true,'auth_dkim',true,'auth_dmarc',true,'auth_tls',true,'health_status','HEALTHY',
    'kill_switch',false,'provider_external_ref_sha256',target_evidence,'ownership_status','TECKEL_OWNED',
    'credential_status','OAUTH_CONNECTED','warmup_started_at',current_date::timestamptz-interval '43 days',
    'warmup_status','HEALTHY','sender_identity_verified',true,'gmail_seed_verified',true,
    'outlook_seed_verified',true,'yahoo_seed_verified',true,'reply_sync_verified',true,
    'list_unsubscribe_verified',true,'one_click_unsubscribe_verified',true,
    'provider_evidence_sha256',target_evidence,'provider_daily_limit',10,
    'last_provider_health_at',current_date::timestamptz
  )
$$;

create or replace function app.m031_snapshot(
  target_team_sha text default repeat('1',64),
  target_research_cap integer default 300
)
returns jsonb
language sql
volatile
set search_path=public,app,pg_temp
as $$
  select jsonb_build_object(
    'account',jsonb_build_object(
      'provider_code','APOLLO','environment','PRODUCTION','ownership_status','TECKEL_OWNED',
      'terms_status','VERIFIED','plan_name','Professional','legal_owner','TECKEL',
      'custody_model','TECKEL_MANAGED_FOR_ENNCO','workspace_mode','ENNCO_DEDICATED',
      'sender_identity','FRANCISCO_CUELLAR','terms_risk','ACCEPTED_BY_TECKEL',
      'legacy_teckel_assets','ARCHIVED','legacy_contact_count',192,'legacy_sequence_count',13,
      'active_sequence_count',0,'teckel_mailbox_active_count',0,'primary_mailbox_connected',true,
      'primary_mailbox_ref_sha256',repeat('2',64),'team_ref_sha256',target_team_sha,
      'admin_email_sha256',repeat('3',64),'seat_count',1,'billing_frequency','MONTHLY',
      'external_account_ref_sha256',repeat('4',64),'mfa_status','ENABLED','recovery_status','VERIFIED',
      'monthly_budget_mxn',0,'hard_cap_mxn',0,'evidence_sha256',repeat('5',64),
      'renewal_at',current_date::timestamptz+interval '30 days','delivery_status','READY',
      'last_audited_at',current_date::timestamptz,'verified_at',current_date::timestamptz,'active',true
    ),
    'budget',jsonb_build_object(
      'cycle_start',(current_date-1)::text,'cycle_end',(current_date+30)::text,
      'credit_limit',4010,'credits_consumed',3600,'research_credit_cap',target_research_cap,
      'infrastructure_credit_spend',3600,'minimum_credit_buffer',110,
      'phone_enrichment_allowed',false,'status','ACTIVE','evidence_sha256',repeat('6',64),
      'observed_at',current_date::timestamptz
    ),
    'domains',jsonb_build_array(
      jsonb_build_object('normalized_domain','enncoindustrial.com','asset_source','APOLLO_GENERATED',
        'ownership_status','TECKEL_OWNED','lifecycle_status','READY','auth_spf',true,'auth_dkim',true,
        'auth_dmarc',true,'auth_tls',true,'postmaster_verified',true,'reputation_status','HEALTHY',
        'registered_at',current_date::timestamptz-interval '43 days','expires_at',current_date::timestamptz+interval '300 days',
        'evidence_sha256',repeat('7',64),'verified_at',current_date::timestamptz),
      jsonb_build_object('normalized_domain','enncoenergia.com','asset_source','APOLLO_GENERATED',
        'ownership_status','TECKEL_OWNED','lifecycle_status','READY','auth_spf',true,'auth_dkim',true,
        'auth_dmarc',true,'auth_tls',true,'postmaster_verified',true,'reputation_status','HEALTHY',
        'registered_at',current_date::timestamptz-interval '43 days','expires_at',current_date::timestamptz+interval '300 days',
        'evidence_sha256',repeat('8',64),'verified_at',current_date::timestamptz)
    ),
    'mailboxes',jsonb_build_array(
      app.m031_mailbox('francisco@enncoindustrial.com','enncoindustrial.com',repeat('9',64)),
      app.m031_mailbox('fcuellar@enncoindustrial.com','enncoindustrial.com',repeat('a',64)),
      app.m031_mailbox('francisco@enncoenergia.com','enncoenergia.com',repeat('b',64))
    ),
    'gates',(select jsonb_agg(jsonb_build_object(
      'gate_code',gate_code,'status','PASS','evidence_sha256',repeat('c',64),
      'evidence_class','live','recorded_at',current_date::timestamptz,'expires_at',null
    ) order by gate_code) from unnest(array[
      'CONTRACT_ARCHIVED','PRIVACY_APPROVED','APOLLO_TERMS_ACCEPTED','APOLLO_TECKEL_MANAGED_ACCEPTED',
      'MFA_RECOVERY','BUDGET_APPROVED','GOOGLE_CLOUD_READY','RESEND_READY','SENTRY_READY',
      'CHECKLY_READY','OPERATOR_PRIMARY','OPERATOR_COVERAGE','ANEXO_A_BOUND','COPY_APPROVED','PILOT_APPROVED'
    ]::text[]) gate_code)
  )
$$;

create or replace function app.m031_mailbox(target_email text,target_domain text,target_evidence text)
returns jsonb
language sql
volatile
set search_path=pg_catalog
as $$
  select jsonb_build_object(
    'normalized_email',target_email,'domain',target_domain,'domain_ready_at',current_date::timestamptz-interval '43 days',
    'auth_spf',true,'auth_dkim',true,'auth_dmarc',true,'auth_tls',true,'health_status','HEALTHY',
    'kill_switch',false,'provider_external_ref_sha256',target_evidence,'ownership_status','TECKEL_OWNED',
    'credential_status','OAUTH_CONNECTED','warmup_started_at',current_date::timestamptz-interval '43 days',
    'warmup_status','HEALTHY','sender_identity_verified',true,'gmail_seed_verified',true,
    'outlook_seed_verified',true,'yahoo_seed_verified',true,'reply_sync_verified',true,
    'list_unsubscribe_verified',true,'one_click_unsubscribe_verified',true,
    'provider_evidence_sha256',target_evidence,'provider_daily_limit',10,
    'last_provider_health_at',current_date::timestamptz
  )
$$;

set request.jwt.claim.sub='31100000-0000-4000-8000-000000000001';
set request.jwt.claim.aal='aal1';
set role authenticated;
do $$ begin
  begin
    perform public.apply_apollo_dedicated_provider_snapshot(
      '31000000-0000-4000-8000-000000000001',app.m031_snapshot(),repeat('d',64));
    raise exception 'EXPECTED_M031_AAL1_REJECTION';
  exception when others then
    if sqlerrm<>'PROVIDER_SNAPSHOT_ADMIN_AAL2_REQUIRED' then raise; end if;
  end;
end $$;
reset role;

set request.jwt.claim.aal='aal2';
set role authenticated;
select public.apply_apollo_dedicated_provider_snapshot(
  '31000000-0000-4000-8000-000000000001',app.m031_snapshot(),repeat('d',64));
reset role;

do $$ declare result jsonb; begin
  result:=app.evaluate_outbound_provider_readiness_as_system(
    '31000000-0000-4000-8000-000000000001',clock_timestamp());
  if result->>'state'<>'READY' or result->>'release_state'<>'READY_FOR_CANARY'
    or result->>'custody_model'<>'TECKEL_MANAGED_FOR_ENNCO'
    or result->>'workspace_mode'<>'ENNCO_DEDICATED'
    or result->>'sender_identity'<>'FRANCISCO_CUELLAR'
    or result->>'terms_risk'<>'ACCEPTED_BY_TECKEL'
    or result->>'legacy_teckel_assets'<>'ARCHIVED'
    or (result->>'legacy_contact_count')::integer<>192
    or (result->>'legacy_sequence_count')::integer<>13
    or (result->>'active_sequence_count')::integer<>0
    or (result->>'teckel_mailbox_active_count')::integer<>0
    or not (result->>'primary_mailbox_connected')::boolean
    or not (result->>'team_bound')::boolean
    or (result->>'domains_ready')::integer<>2 or (result->>'mailboxes_ready')::integer<>3
    or (result->>'credits_remaining')::integer<>410
    or (result->>'research_credit_cap')::integer<>300
    or (result->>'infrastructure_credit_spend')::integer<>3600
    or (result->>'minimum_credit_buffer')::integer<>110
  then raise exception 'M031_READY_CONTRACT_INVALID:%',result; end if;
end $$;

do $$ begin
  if (select global_kill_switch from public.runtime_controls where organization_id='31000000-0000-4000-8000-000000000001')<>true
    or (select external_send_allowed from public.runtime_controls where organization_id='31000000-0000-4000-8000-000000000001')<>false
  then raise exception 'M031_RUNTIME_HOLD_MUTATED'; end if;
  if (select count(*) from public.mailboxes where organization_id='31000000-0000-4000-8000-000000000001'
      and provider='apollo_shared_smtp' and custody_status='APOLLO_PROVISIONED_TECKEL_CUSTODY')<>3
  then raise exception 'M031_ISOLATED_MAILBOX_BINDING_INVALID'; end if;
  if has_function_privilege('authenticated','public.apply_outbound_provider_snapshot(uuid,jsonb,text)','EXECUTE')
  then raise exception 'M031_LEGACY_SNAPSHOT_RPC_EXPOSED'; end if;
  if not has_function_privilege('authenticated','public.apply_apollo_dedicated_provider_snapshot(uuid,jsonb,text)','EXECUTE')
  then raise exception 'M031_DEDICATED_SNAPSHOT_RPC_NOT_EXPOSED'; end if;
  if has_table_privilege('authenticated','public.provider_accounts','INSERT')
    or has_table_privilege('authenticated','public.provider_accounts','UPDATE')
    or has_table_privilege('authenticated','public.provider_accounts','DELETE')
    or has_table_privilege('authenticated','public.provider_credit_budgets','UPDATE')
  then raise exception 'M031_DIRECT_DML_EXPOSED'; end if;
end $$;

set role authenticated;
do $$ begin
  begin
    perform public.apply_apollo_dedicated_provider_snapshot(
      '31000000-0000-4000-8000-000000000001',app.m031_snapshot(repeat('e',64),300),repeat('e',64));
    raise exception 'EXPECTED_M031_TEAM_DRIFT_REJECTION';
  exception when others then if sqlerrm<>'APOLLO_TEAM_IDENTITY_DRIFT' then raise; end if; end;
  begin
    perform public.apply_apollo_dedicated_provider_snapshot(
      '31000000-0000-4000-8000-000000000001',app.m031_snapshot(repeat('1',64),301),repeat('f',64));
    raise exception 'EXPECTED_M031_BUDGET_REJECTION';
  exception when others then if sqlerrm<>'APOLLO_DEDICATED_BUDGET_INVALID' then raise; end if; end;
  begin
    perform public.apply_apollo_dedicated_provider_snapshot(
      '31000000-0000-4000-8000-000000000002',app.m031_snapshot(),repeat('0',64));
    raise exception 'EXPECTED_M031_CROSS_TENANT_REJECTION';
  exception when others then if sqlerrm<>'PROVIDER_SNAPSHOT_ADMIN_AAL2_REQUIRED' then raise; end if; end;
end $$;
reset role;

select 'APOLLO_TECKEL_DEDICATED_FORWARD_GATE_PASS' as result;
