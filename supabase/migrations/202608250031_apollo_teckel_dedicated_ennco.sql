begin;

drop trigger if exists messages_aaa_m031_rollback_fail_closed on public.messages;
drop function if exists app.block_m031_rollback_outbound();

alter table public.provider_accounts
  add column if not exists custody_model text not null default 'UNKNOWN',
  add column if not exists workspace_mode text not null default 'UNKNOWN',
  add column if not exists sender_identity text not null default 'UNKNOWN',
  add column if not exists terms_risk text not null default 'UNKNOWN',
  add column if not exists legacy_teckel_assets text not null default 'UNKNOWN',
  add column if not exists legacy_contact_count integer not null default 0,
  add column if not exists legacy_sequence_count integer not null default 0,
  add column if not exists active_sequence_count integer not null default 0,
  add column if not exists teckel_mailbox_active_count integer not null default 0,
  add column if not exists primary_mailbox_connected boolean not null default false,
  add column if not exists primary_mailbox_ref_sha256 text,
  add column if not exists team_ref_sha256 text,
  add column if not exists admin_email_sha256 text;

alter table public.provider_accounts
  drop constraint if exists provider_accounts_custody_model_check,
  drop constraint if exists provider_accounts_workspace_mode_check,
  drop constraint if exists provider_accounts_sender_identity_check,
  drop constraint if exists provider_accounts_terms_risk_check,
  drop constraint if exists provider_accounts_legacy_teckel_assets_check,
  drop constraint if exists provider_accounts_legacy_contact_count_check,
  drop constraint if exists provider_accounts_legacy_sequence_count_check,
  drop constraint if exists provider_accounts_active_sequence_count_check,
  drop constraint if exists provider_accounts_teckel_mailbox_active_count_check,
  drop constraint if exists provider_accounts_primary_mailbox_ref_sha256_check,
  drop constraint if exists provider_accounts_team_ref_sha256_check,
  drop constraint if exists provider_accounts_admin_email_sha256_check;

alter table public.provider_accounts
  add constraint provider_accounts_custody_model_check
    check (custody_model in ('UNKNOWN','TECKEL_MANAGED_FOR_ENNCO')),
  add constraint provider_accounts_workspace_mode_check
    check (workspace_mode in ('UNKNOWN','ENNCO_DEDICATED')),
  add constraint provider_accounts_sender_identity_check
    check (sender_identity in ('UNKNOWN','FRANCISCO_CUELLAR')),
  add constraint provider_accounts_terms_risk_check
    check (terms_risk in ('UNKNOWN','ACCEPTED_BY_TECKEL','BLOCKED')),
  add constraint provider_accounts_legacy_teckel_assets_check
    check (legacy_teckel_assets in ('UNKNOWN','ARCHIVED','ACTIVE')),
  add constraint provider_accounts_legacy_contact_count_check check (legacy_contact_count between 0 and 1000000),
  add constraint provider_accounts_legacy_sequence_count_check check (legacy_sequence_count between 0 and 100000),
  add constraint provider_accounts_active_sequence_count_check check (active_sequence_count between 0 and 100000),
  add constraint provider_accounts_teckel_mailbox_active_count_check check (teckel_mailbox_active_count between 0 and 100),
  add constraint provider_accounts_primary_mailbox_ref_sha256_check
    check (primary_mailbox_ref_sha256 is null or primary_mailbox_ref_sha256 ~ '^[a-f0-9]{64}$'),
  add constraint provider_accounts_team_ref_sha256_check
    check (team_ref_sha256 is null or team_ref_sha256 ~ '^[a-f0-9]{64}$'),
  add constraint provider_accounts_admin_email_sha256_check
    check (admin_email_sha256 is null or admin_email_sha256 ~ '^[a-f0-9]{64}$');

alter table public.provider_credit_budgets
  add column if not exists minimum_credit_buffer integer not null default 110;
alter table public.provider_credit_budgets
  drop constraint if exists provider_credit_budgets_minimum_credit_buffer_check;
alter table public.provider_credit_budgets
  add constraint provider_credit_budgets_minimum_credit_buffer_check
    check (minimum_credit_buffer between 110 and 1000000);

lock table public.provider_activation_gates in share row exclusive mode;
alter table public.provider_activation_gates
  drop constraint if exists provider_activation_gates_gate_code_check;
update public.provider_activation_gates
set gate_code='APOLLO_TECKEL_MANAGED_ACCEPTED'
where gate_code='APOLLO_OWNERSHIP_ENNCO';
alter table public.provider_activation_gates
  add constraint provider_activation_gates_gate_code_check check (gate_code in (
    'CONTRACT_ARCHIVED','PRIVACY_APPROVED','APOLLO_TERMS_ACCEPTED','APOLLO_TECKEL_MANAGED_ACCEPTED',
    'MFA_RECOVERY','BUDGET_APPROVED','GOOGLE_CLOUD_READY','RESEND_READY','SENTRY_READY',
    'CHECKLY_READY','OPERATOR_PRIMARY','OPERATOR_COVERAGE','ANEXO_A_BOUND','COPY_APPROVED','PILOT_APPROVED'
  ));

create or replace function app.provider_control_requirements()
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select array[
    'CONTRACT_ARCHIVED','PRIVACY_APPROVED','APOLLO_TERMS_ACCEPTED','APOLLO_TECKEL_MANAGED_ACCEPTED',
    'MFA_RECOVERY','BUDGET_APPROVED','GOOGLE_CLOUD_READY','RESEND_READY','SENTRY_READY',
    'CHECKLY_READY','OPERATOR_PRIMARY','OPERATOR_COVERAGE','ANEXO_A_BOUND','COPY_APPROVED','PILOT_APPROVED'
  ]::text[]
$$;

create or replace function app.provider_mailbox_is_ready(
  target_organization_id uuid,
  target_mailbox_id uuid,
  target_evaluated_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select exists (
    select 1
    from public.mailboxes m
    join public.provider_accounts pa
      on pa.organization_id=m.organization_id and pa.id=m.provider_account_id
    join public.outreach_domains d
      on d.organization_id=m.organization_id and d.id=m.outreach_domain_id
    where m.organization_id=target_organization_id and m.id=target_mailbox_id
      and pa.provider_code='APOLLO' and pa.environment='PRODUCTION'
      and pa.ownership_status='TECKEL_OWNED' and pa.legal_owner='TECKEL'
      and pa.custody_model='TECKEL_MANAGED_FOR_ENNCO' and pa.workspace_mode='ENNCO_DEDICATED'
      and pa.sender_identity='FRANCISCO_CUELLAR' and pa.terms_risk='ACCEPTED_BY_TECKEL'
      and pa.legacy_teckel_assets='ARCHIVED' and pa.active_sequence_count=0
      and pa.teckel_mailbox_active_count=0 and pa.primary_mailbox_connected
      and pa.primary_mailbox_ref_sha256 is not null and pa.team_ref_sha256 is not null
      and pa.admin_email_sha256 is not null and pa.terms_status='VERIFIED'
      and pa.seat_count=1 and pa.billing_frequency in ('MONTHLY','ANNUAL')
      and pa.mfa_status='ENABLED' and pa.recovery_status='VERIFIED' and pa.active
      and pa.delivery_status='READY' and pa.last_audited_at is not null
      and d.asset_source='APOLLO_GENERATED' and d.ownership_status='TECKEL_OWNED'
      and d.normalized_domain in ('enncoindustrial.com','enncoenergia.com')
      and d.lifecycle_status='READY' and d.reputation_status='HEALTHY'
      and d.auth_spf and d.auth_dkim and d.auth_dmarc and d.auth_tls and d.postmaster_verified
      and m.normalized_email in (
        'francisco@enncoindustrial.com','fcuellar@enncoindustrial.com','francisco@enncoenergia.com'
      )
      and m.ownership_status='TECKEL_OWNED' and m.credential_status='OAUTH_CONNECTED'
      and m.warmup_status='HEALTHY' and m.warmup_started_at is not null
      and m.warmup_started_at <= target_evaluated_at - interval '42 days'
      and m.warmup_minimum_days=42 and m.sender_name='Francisco Cuellar'
      and m.sender_identity_verified and m.gmail_seed_verified and m.outlook_seed_verified
      and m.yahoo_seed_verified and m.reply_sync_verified
      and m.list_unsubscribe_verified and m.one_click_unsubscribe_verified
      and m.auth_spf and m.auth_dkim and m.auth_dmarc and m.auth_tls
      and m.health_status='HEALTHY' and not m.kill_switch
      and m.provider_daily_limit between 1 and 20
      and m.last_provider_health_at is not null
      and m.last_provider_health_at >= target_evaluated_at - interval '24 hours'
  )
$$;

create or replace function app.evaluate_outbound_provider_readiness_as_system(
  target_organization_id uuid,
  target_evaluated_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  apollo public.provider_accounts%rowtype;
  budget public.provider_credit_budgets%rowtype;
  domains_total integer:=0;
  domains_ready integer:=0;
  mailboxes_total integer:=0;
  mailboxes_ready integer:=0;
  minimum_warmup_days integer:=0;
  required_gate_count integer:=cardinality(app.provider_control_requirements());
  passed_gate_count integer:=0;
  live_passed_gate_count integer:=0;
  credits_remaining integer;
  blockers text[]:=array[]::text[];
  provider_state text:='UNKNOWN';
  release_state text:='HOLD';
begin
  if target_organization_id is null or target_evaluated_at is null then
    return jsonb_build_object('status','READ_ONLY','state','UNKNOWN','release_state','HOLD',
      'organization_id',target_organization_id,'evaluated_at',target_evaluated_at,
      'blockers',array['INPUT_INVALID']);
  end if;

  select * into apollo from public.provider_accounts
  where organization_id=target_organization_id and provider_code='APOLLO' and environment='PRODUCTION';
  if not found then blockers:=array_append(blockers,'APOLLO_ACCOUNT_NOT_CONFIGURED'); end if;

  if apollo.id is not null then
    if apollo.ownership_status<>'TECKEL_OWNED' or apollo.legal_owner<>'TECKEL'
      or apollo.custody_model<>'TECKEL_MANAGED_FOR_ENNCO' or apollo.workspace_mode<>'ENNCO_DEDICATED'
      or apollo.terms_risk<>'ACCEPTED_BY_TECKEL'
    then blockers:=array_append(blockers,'APOLLO_CUSTODY_MODEL_INVALID'); end if;
    if apollo.team_ref_sha256 is null or apollo.admin_email_sha256 is null
    then blockers:=array_append(blockers,'APOLLO_TEAM_BINDING_INVALID'); end if;
    if apollo.sender_identity<>'FRANCISCO_CUELLAR'
    then blockers:=array_append(blockers,'APOLLO_SENDER_IDENTITY_INVALID'); end if;
    if apollo.legacy_teckel_assets<>'ARCHIVED' or apollo.active_sequence_count<>0
      or apollo.teckel_mailbox_active_count<>0
    then blockers:=array_append(blockers,'APOLLO_LEGACY_ASSETS_NOT_ARCHIVED'); end if;
    if not apollo.primary_mailbox_connected or apollo.primary_mailbox_ref_sha256 is null
    then blockers:=array_append(blockers,'APOLLO_PRIMARY_MAILBOX_NOT_CONNECTED'); end if;
    if apollo.seat_count<>1 then blockers:=array_append(blockers,'APOLLO_OWNER_OR_SEAT_INVALID'); end if;
    if apollo.terms_status<>'VERIFIED' then blockers:=array_append(blockers,'APOLLO_TERMS_NOT_VERIFIED'); end if;
    if apollo.plan_name='UNKNOWN' or apollo.billing_frequency not in ('MONTHLY','ANNUAL')
    then blockers:=array_append(blockers,'APOLLO_PLAN_NOT_ELIGIBLE'); end if;
    if apollo.mfa_status<>'ENABLED' or apollo.recovery_status<>'VERIFIED'
    then blockers:=array_append(blockers,'APOLLO_MFA_RECOVERY_INCOMPLETE'); end if;
    if apollo.delivery_status<>'READY' or apollo.last_audited_at is null
    then blockers:=array_append(blockers,'APOLLO_DELIVERY_STATUS_NOT_READY'); end if;
    if not apollo.active then blockers:=array_append(blockers,'APOLLO_ACCOUNT_INACTIVE'); end if;
  end if;

  select count(*),count(*) filter (where
    normalized_domain in ('enncoindustrial.com','enncoenergia.com')
    and asset_source='APOLLO_GENERATED' and ownership_status='TECKEL_OWNED'
    and lifecycle_status='READY' and reputation_status='HEALTHY'
    and auth_spf and auth_dkim and auth_dmarc and auth_tls and postmaster_verified)
  into domains_total,domains_ready from public.outreach_domains
  where organization_id=target_organization_id and (apollo.id is null or provider_account_id=apollo.id);
  if domains_total<>2 then blockers:=array_append(blockers,'OUTREACH_DOMAIN_COUNT_NOT_TWO');
  elsif domains_ready<>2 then blockers:=array_append(blockers,'OUTREACH_DOMAINS_NOT_READY'); end if;

  select count(*),count(*) filter (where app.provider_mailbox_is_ready(organization_id,id,target_evaluated_at)),
    coalesce(min(greatest(0,floor(extract(epoch from (target_evaluated_at-warmup_started_at))/86400)::integer)),0)
  into mailboxes_total,mailboxes_ready,minimum_warmup_days from public.mailboxes
  where organization_id=target_organization_id and (apollo.id is null or provider_account_id=apollo.id);
  if mailboxes_total<>3 then blockers:=array_append(blockers,'OUTREACH_MAILBOX_COUNT_NOT_THREE');
  elsif mailboxes_ready<>3 then
    if minimum_warmup_days<42 then blockers:=array_append(blockers,'APOLLO_WARMUP_UNDER_42_DAYS');
    else blockers:=array_append(blockers,'OUTREACH_MAILBOXES_NOT_READY'); end if;
  end if;

  if apollo.id is not null then
    select * into budget from public.provider_credit_budgets
    where organization_id=target_organization_id and provider_account_id=apollo.id
      and cycle_start<=target_evaluated_at::date and cycle_end>target_evaluated_at::date
    order by cycle_start desc limit 1;
    if not found then blockers:=array_append(blockers,'APOLLO_CREDIT_BUDGET_MISSING');
    else
      credits_remaining:=budget.credit_limit-budget.credits_consumed;
      if budget.status<>'ACTIVE' or budget.research_credit_cap>300
        or budget.infrastructure_credit_spend<>3600 or budget.minimum_credit_buffer<>110
        or budget.phone_enrichment_allowed
        or budget.infrastructure_credit_spend+budget.research_credit_cap+budget.minimum_credit_buffer>budget.credit_limit
        or credits_remaining<budget.minimum_credit_buffer
      then blockers:=array_append(blockers,'APOLLO_CREDIT_BUDGET_INVALID'); end if;
    end if;

    select count(*) filter (where status='PASS' and (expires_at is null or expires_at>target_evaluated_at)),
      count(*) filter (where status='PASS' and evidence_class='live' and (expires_at is null or expires_at>target_evaluated_at))
    into passed_gate_count,live_passed_gate_count from public.provider_activation_gates
    where organization_id=target_organization_id and provider_account_id=apollo.id
      and gate_code=any(app.provider_control_requirements());
    if passed_gate_count<>required_gate_count then blockers:=array_append(blockers,'PROVIDER_ACTIVATION_GATES_INCOMPLETE'); end if;
    if live_passed_gate_count<>required_gate_count then blockers:=array_append(blockers,'PROVIDER_LIVE_EVIDENCE_INCOMPLETE'); end if;
  end if;

  if cardinality(blockers)=0 then provider_state:='READY'; release_state:='READY_FOR_CANARY';
  elsif 'APOLLO_WARMUP_UNDER_42_DAYS'=any(blockers) then provider_state:='WARMING';
  elsif apollo.id is null then provider_state:='UNKNOWN';
  else provider_state:='BLOCKED'; end if;

  return jsonb_build_object(
    'status','READ_ONLY','state',provider_state,'release_state',release_state,
    'organization_id',target_organization_id,'evaluated_at',target_evaluated_at,
    'provider','Apollo','provider_account_id',apollo.id,'plan',coalesce(apollo.plan_name,'UNKNOWN'),
    'ownership',coalesce(apollo.ownership_status,'UNKNOWN'),
    'custody_model',coalesce(apollo.custody_model,'UNKNOWN'),
    'workspace_mode',coalesce(apollo.workspace_mode,'UNKNOWN'),
    'sender_identity',coalesce(apollo.sender_identity,'UNKNOWN'),
    'terms_risk',coalesce(apollo.terms_risk,'UNKNOWN'),
    'legacy_teckel_assets',coalesce(apollo.legacy_teckel_assets,'UNKNOWN'),
    'legacy_contact_count',coalesce(apollo.legacy_contact_count,0),
    'legacy_sequence_count',coalesce(apollo.legacy_sequence_count,0),
    'active_sequence_count',coalesce(apollo.active_sequence_count,0),
    'teckel_mailbox_active_count',coalesce(apollo.teckel_mailbox_active_count,0),
    'primary_mailbox_connected',coalesce(apollo.primary_mailbox_connected,false),
    'team_bound',(apollo.team_ref_sha256 is not null and apollo.admin_email_sha256 is not null),
    'domains_ready',domains_ready,'domains_target',2,'mailboxes_ready',mailboxes_ready,'mailboxes_target',3,
    'warmup_days',minimum_warmup_days,'warmup_required_days',42,
    'activation_gates_passed',passed_gate_count,'activation_gates_required',required_gate_count,
    'live_gates_passed',live_passed_gate_count,
    'credit_limit',budget.credit_limit,'credits_consumed',budget.credits_consumed,
    'credits_remaining',credits_remaining,'research_credit_cap',budget.research_credit_cap,
    'infrastructure_credit_spend',budget.infrastructure_credit_spend,
    'minimum_credit_buffer',budget.minimum_credit_buffer,'blockers',blockers
  );
exception when others then
  return jsonb_build_object(
    'status','READ_ONLY','state','UNKNOWN','release_state','HOLD',
    'organization_id',target_organization_id,'evaluated_at',target_evaluated_at,
    'provider','Apollo','provider_account_id',null,'plan','UNKNOWN','ownership','UNKNOWN',
    'custody_model','UNKNOWN','workspace_mode','UNKNOWN','sender_identity','UNKNOWN','terms_risk','UNKNOWN',
    'legacy_teckel_assets','UNKNOWN','legacy_contact_count',0,'legacy_sequence_count',0,
    'active_sequence_count',0,'teckel_mailbox_active_count',0,'primary_mailbox_connected',false,'team_bound',false,
    'domains_ready',0,'domains_target',2,'mailboxes_ready',0,'mailboxes_target',3,
    'warmup_days',0,'warmup_required_days',42,'activation_gates_passed',0,
    'activation_gates_required',cardinality(app.provider_control_requirements()),'live_gates_passed',0,
    'credit_limit',null,'credits_consumed',null,'credits_remaining',null,'research_credit_cap',null,
    'infrastructure_credit_spend',null,'minimum_credit_buffer',null,
    'blockers',array['PROVIDER_READ_MODEL_UNAVAILABLE']
  );
end;
$$;

create or replace function public.apply_apollo_dedicated_provider_snapshot(
  target_organization_id uuid,
  target_snapshot jsonb,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  account_record jsonb;
  budget_record jsonb;
  existing_account public.provider_accounts%rowtype;
  base_result jsonb;
  apollo_id uuid;
  domain_count integer;
  mailbox_count integer;
begin
  if not app.has_role(target_organization_id,array['ennco_admin'::public.user_role,'teckel_admin'::public.user_role])
  then raise exception 'PROVIDER_SNAPSHOT_ADMIN_AAL2_REQUIRED'; end if;
  if target_snapshot is null or jsonb_typeof(target_snapshot)<>'object'
    or target_idempotency_key is null or target_idempotency_key !~ '^[a-f0-9]{64}$'
  then raise exception 'APOLLO_DEDICATED_SNAPSHOT_INPUT_INVALID'; end if;
  if exists(select 1 from jsonb_object_keys(target_snapshot) key
    where key not in ('account','budget','domains','mailboxes','gates'))
    or not (target_snapshot ?& array['account','budget','domains','mailboxes','gates'])
  then raise exception 'APOLLO_DEDICATED_SNAPSHOT_SHAPE_INVALID'; end if;
  if jsonb_typeof(target_snapshot->'account')<>'object'
    or jsonb_typeof(target_snapshot->'budget')<>'object'
    or jsonb_typeof(target_snapshot->'domains')<>'array'
    or jsonb_typeof(target_snapshot->'mailboxes')<>'array'
    or jsonb_typeof(target_snapshot->'gates')<>'array'
  then raise exception 'APOLLO_DEDICATED_SNAPSHOT_SHAPE_INVALID'; end if;

  account_record:=target_snapshot->'account';
  budget_record:=target_snapshot->'budget';
  domain_count:=jsonb_array_length(target_snapshot->'domains');
  mailbox_count:=jsonb_array_length(target_snapshot->'mailboxes');

  if account_record->>'provider_code'<>'APOLLO' or account_record->>'environment'<>'PRODUCTION'
    or account_record->>'ownership_status'<>'TECKEL_OWNED' or account_record->>'legal_owner'<>'TECKEL'
    or account_record->>'custody_model'<>'TECKEL_MANAGED_FOR_ENNCO'
    or account_record->>'workspace_mode'<>'ENNCO_DEDICATED'
    or account_record->>'sender_identity'<>'FRANCISCO_CUELLAR'
    or account_record->>'terms_risk'<>'ACCEPTED_BY_TECKEL'
    or account_record->>'legacy_teckel_assets'<>'ARCHIVED'
    or (account_record->>'legacy_contact_count')::integer<>192
    or (account_record->>'legacy_sequence_count')::integer<>13
    or (account_record->>'active_sequence_count')::integer<>0
    or (account_record->>'teckel_mailbox_active_count')::integer<>0
    or not (account_record->>'primary_mailbox_connected')::boolean
    or coalesce(account_record->>'primary_mailbox_ref_sha256','') !~ '^[a-f0-9]{64}$'
    or coalesce(account_record->>'team_ref_sha256','') !~ '^[a-f0-9]{64}$'
    or coalesce(account_record->>'admin_email_sha256','') !~ '^[a-f0-9]{64}$'
  then raise exception 'APOLLO_DEDICATED_ACCOUNT_CONTRACT_INVALID'; end if;

  if (budget_record->>'research_credit_cap')::integer>300
    or (budget_record->>'infrastructure_credit_spend')::integer<>3600
    or (budget_record->>'minimum_credit_buffer')::integer<>110
    or (budget_record->>'phone_enrichment_allowed')::boolean
    or (budget_record->>'infrastructure_credit_spend')::integer
       +(budget_record->>'research_credit_cap')::integer
       +(budget_record->>'minimum_credit_buffer')::integer>(budget_record->>'credit_limit')::integer
    or (budget_record->>'credit_limit')::integer-(budget_record->>'credits_consumed')::integer<110
  then raise exception 'APOLLO_DEDICATED_BUDGET_INVALID'; end if;
  if domain_count>2 or mailbox_count>3 then raise exception 'APOLLO_DEDICATED_CARDINALITY_INVALID'; end if;
  if exists(select 1 from jsonb_array_elements(target_snapshot->'domains') d where
      d->>'normalized_domain' not in ('enncoindustrial.com','enncoenergia.com')
      or d->>'asset_source'<>'APOLLO_GENERATED' or d->>'ownership_status'<>'TECKEL_OWNED')
  then raise exception 'APOLLO_DEDICATED_DOMAIN_INVALID'; end if;
  if exists(select 1 from jsonb_array_elements(target_snapshot->'mailboxes') m where
      m->>'normalized_email' not in (
        'francisco@enncoindustrial.com','fcuellar@enncoindustrial.com','francisco@enncoenergia.com'
      ) or m->>'ownership_status'<>'TECKEL_OWNED')
  then raise exception 'APOLLO_DEDICATED_MAILBOX_INVALID'; end if;

  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':apollo-dedicated',0));
  select * into existing_account from public.provider_accounts
  where organization_id=target_organization_id and provider_code='APOLLO' and environment='PRODUCTION'
  for update;
  if found and (
    (existing_account.team_ref_sha256 is not null and existing_account.team_ref_sha256<>account_record->>'team_ref_sha256')
    or (existing_account.admin_email_sha256 is not null and existing_account.admin_email_sha256<>account_record->>'admin_email_sha256')
  ) then raise exception 'APOLLO_TEAM_IDENTITY_DRIFT'; end if;

  base_result:=public.apply_outbound_provider_snapshot(target_organization_id,target_snapshot,target_idempotency_key);
  apollo_id:=(base_result->>'provider_account_id')::uuid;

  update public.provider_accounts set
    custody_model=account_record->>'custody_model',workspace_mode=account_record->>'workspace_mode',
    sender_identity=account_record->>'sender_identity',terms_risk=account_record->>'terms_risk',
    legacy_teckel_assets=account_record->>'legacy_teckel_assets',
    legacy_contact_count=(account_record->>'legacy_contact_count')::integer,
    legacy_sequence_count=(account_record->>'legacy_sequence_count')::integer,
    active_sequence_count=(account_record->>'active_sequence_count')::integer,
    teckel_mailbox_active_count=(account_record->>'teckel_mailbox_active_count')::integer,
    primary_mailbox_connected=(account_record->>'primary_mailbox_connected')::boolean,
    primary_mailbox_ref_sha256=account_record->>'primary_mailbox_ref_sha256',
    team_ref_sha256=account_record->>'team_ref_sha256',admin_email_sha256=account_record->>'admin_email_sha256',
    updated_at=clock_timestamp()
  where organization_id=target_organization_id and id=apollo_id;

  update public.provider_credit_budgets set
    minimum_credit_buffer=(budget_record->>'minimum_credit_buffer')::integer
  where organization_id=target_organization_id and provider_account_id=apollo_id
    and cycle_start=(budget_record->>'cycle_start')::date;

  update public.mailboxes set
    provider='apollo_shared_smtp',eligibility_route='NEW_ISOLATED_MAILBOX_WARMUP',
    domain_role='OUTREACH_ISOLATED',custody_status='APOLLO_PROVISIONED_TECKEL_CUSTODY'
  where organization_id=target_organization_id and provider_account_id=apollo_id
    and normalized_email in (
      'francisco@enncoindustrial.com','fcuellar@enncoindustrial.com','francisco@enncoenergia.com'
    );

  return base_result || jsonb_build_object(
    'readiness',app.evaluate_outbound_provider_readiness_as_system(target_organization_id,clock_timestamp())
  );
end;
$$;

revoke all on function public.apply_outbound_provider_snapshot(uuid,jsonb,text)
  from public,anon,authenticated,service_role;
revoke all on function public.apply_apollo_dedicated_provider_snapshot(uuid,jsonb,text)
  from public,anon,service_role;
grant execute on function public.apply_apollo_dedicated_provider_snapshot(uuid,jsonb,text) to authenticated;

commit;
