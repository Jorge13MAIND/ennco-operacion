begin;

drop trigger if exists messages_aaa_m024_rollback_fail_closed on public.messages;
drop function if exists app.block_m024_rollback_outbound();

create table if not exists public.provider_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider_code text not null check (provider_code in (
    'APOLLO','GOOGLE_WORKSPACE','VERCEL','SUPABASE','GOOGLE_CLOUD','RESEND',
    'SENTRY','CHECKLY','DOMAIN_REGISTRAR','POSTMASTER','TELEGRAM'
  )),
  environment text not null check (environment in ('SHARED','STAGING','PRODUCTION')),
  ownership_status text not null default 'UNKNOWN'
    check (ownership_status in ('UNKNOWN','ENNCO_OWNED','TECKEL_OWNED','THIRD_PARTY')),
  terms_status text not null default 'UNKNOWN'
    check (terms_status in ('UNKNOWN','VERIFIED','BLOCKED')),
  plan_name text not null default 'UNKNOWN' check (octet_length(plan_name) between 1 and 120),
  legal_owner text not null default 'UNKNOWN'
    check (legal_owner in ('UNKNOWN','ENNCO','TECKEL','THIRD_PARTY')),
  seat_count integer not null default 0 check (seat_count between 0 and 100),
  billing_frequency text not null default 'UNKNOWN'
    check (billing_frequency in ('UNKNOWN','FREE','MONTHLY','ANNUAL','USAGE')),
  external_account_ref_sha256 text
    check (external_account_ref_sha256 is null or external_account_ref_sha256 ~ '^[a-f0-9]{64}$'),
  mfa_status text not null default 'UNKNOWN'
    check (mfa_status in ('UNKNOWN','ENABLED','DISABLED')),
  recovery_status text not null default 'UNKNOWN'
    check (recovery_status in ('UNKNOWN','VERIFIED','INCOMPLETE')),
  monthly_budget_mxn numeric(12,2) not null default 0 check (monthly_budget_mxn >= 0),
  hard_cap_mxn numeric(12,2) not null default 0 check (hard_cap_mxn >= monthly_budget_mxn),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  renewal_at timestamptz,
  delivery_status text not null default 'BLOCKED'
    check (delivery_status in ('BLOCKED','READY','SUSPENDED','CANCELLED')),
  last_audited_at timestamptz,
  verified_by uuid,
  verified_at timestamptz,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider_code, environment),
  unique (organization_id, id),
  check ((verified_by is null) = (verified_at is null))
);

create index if not exists provider_accounts_readiness_idx
on public.provider_accounts (organization_id, provider_code, environment, active);

create table if not exists public.provider_credit_budgets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider_account_id uuid not null,
  cycle_start date not null,
  cycle_end date not null check (cycle_end > cycle_start),
  credit_limit integer not null check (credit_limit between 0 and 1000000),
  credits_consumed integer not null default 0 check (credits_consumed between 0 and credit_limit),
  research_credit_cap integer not null default 500 check (research_credit_cap between 0 and credit_limit),
  infrastructure_credit_spend integer not null default 0
    check (infrastructure_credit_spend >= 0 and infrastructure_credit_spend <= credit_limit),
  phone_enrichment_allowed boolean not null default false,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','EXHAUSTED','BLOCKED','CLOSED')),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (organization_id, provider_account_id, cycle_start),
  unique (organization_id, id),
  constraint provider_credit_budgets_account_tenant_fkey
    foreign key (organization_id, provider_account_id)
    references public.provider_accounts (organization_id, id)
);

create index if not exists provider_credit_budgets_current_idx
on public.provider_credit_budgets (organization_id, provider_account_id, cycle_end desc);

create table if not exists public.outreach_domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider_account_id uuid not null,
  normalized_domain text not null check (
    normalized_domain = lower(normalized_domain)
    and normalized_domain !~ '^www\\.'
    and normalized_domain ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
  ),
  asset_source text not null check (asset_source in ('INDEPENDENT_REGISTRAR','APOLLO_GENERATED')),
  ownership_status text not null default 'UNKNOWN'
    check (ownership_status in ('UNKNOWN','ENNCO_OWNED','TECKEL_OWNED','THIRD_PARTY')),
  lifecycle_status text not null default 'CANDIDATE'
    check (lifecycle_status in ('CANDIDATE','REGISTERED','DNS_CONFIGURED','AUTHENTICATED','WARMING','READY','QUARANTINED')),
  auth_spf boolean not null default false,
  auth_dkim boolean not null default false,
  auth_dmarc boolean not null default false,
  auth_tls boolean not null default false,
  postmaster_verified boolean not null default false,
  reputation_status text not null default 'UNKNOWN'
    check (reputation_status in ('UNKNOWN','HEALTHY','DEGRADED','BLOCKED')),
  registered_at timestamptz,
  expires_at timestamptz,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, normalized_domain),
  unique (organization_id, id),
  constraint outreach_domains_provider_account_tenant_fkey
    foreign key (organization_id, provider_account_id)
    references public.provider_accounts (organization_id, id),
  check (expires_at is null or registered_at is null or expires_at > registered_at)
);

create index if not exists outreach_domains_readiness_idx
on public.outreach_domains (organization_id, lifecycle_status, reputation_status);

alter table public.mailboxes
  add column if not exists provider_account_id uuid,
  add column if not exists outreach_domain_id uuid,
  add column if not exists provider_external_ref_sha256 text,
  add column if not exists ownership_status text not null default 'UNKNOWN',
  add column if not exists credential_status text not null default 'UNKNOWN',
  add column if not exists warmup_started_at timestamptz,
  add column if not exists warmup_minimum_days integer not null default 42,
  add column if not exists warmup_status text not null default 'NOT_STARTED',
  add column if not exists sender_identity_verified boolean not null default false,
  add column if not exists gmail_seed_verified boolean not null default false,
  add column if not exists outlook_seed_verified boolean not null default false,
  add column if not exists yahoo_seed_verified boolean not null default false,
  add column if not exists reply_sync_verified boolean not null default false,
  add column if not exists list_unsubscribe_verified boolean not null default false,
  add column if not exists one_click_unsubscribe_verified boolean not null default false,
  add column if not exists provider_evidence_sha256 text;

alter table public.mailboxes
  add column if not exists provider_daily_limit integer not null default 0,
  add column if not exists last_provider_health_at timestamptz;

alter table public.mailboxes
  drop constraint if exists mailboxes_provider_external_ref_sha256_check,
  drop constraint if exists mailboxes_ownership_status_check,
  drop constraint if exists mailboxes_credential_status_check,
  drop constraint if exists mailboxes_warmup_minimum_days_check,
  drop constraint if exists mailboxes_warmup_status_check,
  drop constraint if exists mailboxes_provider_evidence_sha256_check,
  drop constraint if exists mailboxes_provider_daily_limit_check,
  drop constraint if exists mailboxes_provider_account_tenant_fkey,
  drop constraint if exists mailboxes_outreach_domain_tenant_fkey;

alter table public.mailboxes
  add constraint mailboxes_provider_external_ref_sha256_check check (
    provider_external_ref_sha256 is null or provider_external_ref_sha256 ~ '^[a-f0-9]{64}$'
  ),
  add constraint mailboxes_ownership_status_check check (
    ownership_status in ('UNKNOWN','ENNCO_OWNED','TECKEL_OWNED','THIRD_PARTY')
  ),
  add constraint mailboxes_credential_status_check check (
    credential_status in ('UNKNOWN','OAUTH_CONNECTED','ERROR','REVOKED')
  ),
  add constraint mailboxes_warmup_minimum_days_check check (warmup_minimum_days = 42),
  add constraint mailboxes_warmup_status_check check (
    warmup_status in ('NOT_STARTED','WARMING','HEALTHY','DEGRADED','BLOCKED')
  ),
  add constraint mailboxes_provider_evidence_sha256_check check (
    provider_evidence_sha256 is null or provider_evidence_sha256 ~ '^[a-f0-9]{64}$'
  ),
  add constraint mailboxes_provider_daily_limit_check check (
    provider_daily_limit between 0 and 10
  ),
  add constraint mailboxes_provider_account_tenant_fkey
    foreign key (organization_id, provider_account_id)
    references public.provider_accounts (organization_id, id),
  add constraint mailboxes_outreach_domain_tenant_fkey
    foreign key (organization_id, outreach_domain_id)
    references public.outreach_domains (organization_id, id);

create index if not exists mailboxes_provider_account_idx
on public.mailboxes (organization_id, provider_account_id);
create index if not exists mailboxes_outreach_domain_idx
on public.mailboxes (organization_id, outreach_domain_id);

update public.mailboxes
set warmup_started_at = domain_ready_at
where warmup_started_at is null and domain_ready_at is not null;

create table if not exists public.provider_activation_gates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider_account_id uuid not null,
  gate_code text not null check (gate_code in (
    'CONTRACT_ARCHIVED','PRIVACY_APPROVED','APOLLO_TERMS_ACCEPTED','APOLLO_OWNERSHIP_ENNCO',
    'MFA_RECOVERY','BUDGET_APPROVED','GOOGLE_CLOUD_READY','RESEND_READY','SENTRY_READY',
    'CHECKLY_READY','OPERATOR_PRIMARY','OPERATOR_BACKUP','ANEXO_A_BOUND','COPY_APPROVED','PILOT_APPROVED'
  )),
  status text not null default 'UNKNOWN' check (status in ('UNKNOWN','PASS','FAIL')),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_class text not null default 'synthetic_demo'
    check (evidence_class in ('synthetic_demo','live')),
  recorded_by uuid not null,
  recorded_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (organization_id, provider_account_id, gate_code),
  unique (organization_id, id),
  constraint provider_activation_gates_account_tenant_fkey
    foreign key (organization_id, provider_account_id)
    references public.provider_accounts (organization_id, id),
  check (expires_at is null or expires_at > recorded_at)
);

create index if not exists provider_activation_gates_status_idx
on public.provider_activation_gates (organization_id, provider_account_id, status, gate_code);

create table if not exists public.provider_control_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  command_type text not null check (command_type in (
    'PROVIDER_ACCOUNT','CREDIT_BUDGET','OUTREACH_DOMAIN','OUTREACH_MAILBOX','ACTIVATION_GATE'
  )),
  idempotency_key_sha256 text not null check (idempotency_key_sha256 ~ '^[a-f0-9]{64}$'),
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  target_id uuid,
  result_status text not null check (result_status in ('CREATED','UPDATED','DUPLICATE')),
  actor_user_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key_sha256)
);

create index if not exists provider_control_commands_target_idx
on public.provider_control_commands (organization_id, command_type, target_id, created_at desc);

create or replace function app.provider_control_requirements()
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select array[
    'CONTRACT_ARCHIVED','PRIVACY_APPROVED','APOLLO_TERMS_ACCEPTED','APOLLO_OWNERSHIP_ENNCO',
    'MFA_RECOVERY','BUDGET_APPROVED','GOOGLE_CLOUD_READY','RESEND_READY','SENTRY_READY',
    'CHECKLY_READY','OPERATOR_PRIMARY','OPERATOR_BACKUP','ANEXO_A_BOUND','COPY_APPROVED','PILOT_APPROVED'
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
      and pa.ownership_status='ENNCO_OWNED' and pa.terms_status='VERIFIED'
      and pa.plan_name='Professional' and pa.billing_frequency='MONTHLY'
      and pa.legal_owner='ENNCO' and pa.seat_count=1
      and pa.mfa_status='ENABLED' and pa.recovery_status='VERIFIED' and pa.active
      and pa.delivery_status='READY' and pa.last_audited_at is not null
      and d.asset_source='INDEPENDENT_REGISTRAR' and d.ownership_status='ENNCO_OWNED'
      and d.lifecycle_status='READY' and d.reputation_status='HEALTHY'
      and d.auth_spf and d.auth_dkim and d.auth_dmarc and d.auth_tls and d.postmaster_verified
      and m.ownership_status='ENNCO_OWNED' and m.credential_status='OAUTH_CONNECTED'
      and m.warmup_status='HEALTHY' and m.warmup_started_at is not null
      and m.warmup_started_at <= target_evaluated_at - interval '42 days'
      and m.warmup_minimum_days=42 and m.sender_name='Francisco Cuellar'
      and m.sender_identity_verified and m.gmail_seed_verified and m.outlook_seed_verified
      and m.yahoo_seed_verified and m.reply_sync_verified
      and m.list_unsubscribe_verified and m.one_click_unsubscribe_verified
      and m.auth_spf and m.auth_dkim and m.auth_dmarc and m.auth_tls
      and m.health_status='HEALTHY' and not m.kill_switch
      and m.provider_daily_limit between 1 and 10
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
  domains_total integer := 0;
  domains_ready integer := 0;
  mailboxes_total integer := 0;
  mailboxes_ready integer := 0;
  minimum_warmup_days integer := 0;
  required_gate_count integer := cardinality(app.provider_control_requirements());
  passed_gate_count integer := 0;
  live_passed_gate_count integer := 0;
  budget public.provider_credit_budgets%rowtype;
  blockers text[] := array[]::text[];
  provider_state text := 'UNKNOWN';
  release_state text := 'HOLD';
begin
  if target_organization_id is null or target_evaluated_at is null then
    return jsonb_build_object('status','READ_ONLY','state','UNKNOWN','release_state','HOLD',
      'organization_id',target_organization_id,'evaluated_at',target_evaluated_at,'blockers',array['INPUT_INVALID']);
  end if;

  select * into apollo from public.provider_accounts
  where organization_id=target_organization_id and provider_code='APOLLO' and environment='PRODUCTION';
  if not found then blockers:=array_append(blockers,'APOLLO_ACCOUNT_NOT_CONFIGURED'); end if;

  if apollo.id is not null then
    if apollo.ownership_status<>'ENNCO_OWNED' then blockers:=array_append(blockers,'APOLLO_OWNERSHIP_NOT_ENNCO'); end if;
    if apollo.legal_owner<>'ENNCO' or apollo.seat_count<>1 then blockers:=array_append(blockers,'APOLLO_OWNER_OR_SEAT_INVALID'); end if;
    if apollo.terms_status<>'VERIFIED' then blockers:=array_append(blockers,'APOLLO_TERMS_NOT_VERIFIED'); end if;
    if apollo.plan_name<>'Professional' or apollo.billing_frequency<>'MONTHLY' then blockers:=array_append(blockers,'APOLLO_PLAN_NOT_PROFESSIONAL_MONTHLY'); end if;
    if apollo.mfa_status<>'ENABLED' or apollo.recovery_status<>'VERIFIED' then blockers:=array_append(blockers,'APOLLO_MFA_RECOVERY_INCOMPLETE'); end if;
    if apollo.delivery_status<>'READY' or apollo.last_audited_at is null then blockers:=array_append(blockers,'APOLLO_DELIVERY_STATUS_NOT_READY'); end if;
    if not apollo.active then blockers:=array_append(blockers,'APOLLO_ACCOUNT_INACTIVE'); end if;
  end if;

  select count(*), count(*) filter (where
    asset_source='INDEPENDENT_REGISTRAR' and ownership_status='ENNCO_OWNED'
    and lifecycle_status='READY' and reputation_status='HEALTHY'
    and auth_spf and auth_dkim and auth_dmarc and auth_tls and postmaster_verified)
  into domains_total,domains_ready from public.outreach_domains
  where organization_id=target_organization_id and (apollo.id is null or provider_account_id=apollo.id);
  if domains_total<>2 then blockers:=array_append(blockers,'OUTREACH_DOMAIN_COUNT_NOT_TWO');
  elsif domains_ready<>2 then blockers:=array_append(blockers,'OUTREACH_DOMAINS_NOT_READY'); end if;

  select count(*), count(*) filter (where app.provider_mailbox_is_ready(organization_id,id,target_evaluated_at)),
    coalesce(min(greatest(0,floor(extract(epoch from (target_evaluated_at-warmup_started_at))/86400)::integer)),0)
  into mailboxes_total,mailboxes_ready,minimum_warmup_days from public.mailboxes
  where organization_id=target_organization_id and (apollo.id is null or provider_account_id=apollo.id);
  if mailboxes_total<>4 then blockers:=array_append(blockers,'OUTREACH_MAILBOX_COUNT_NOT_FOUR');
  elsif mailboxes_ready<>4 then
    if minimum_warmup_days<42 then blockers:=array_append(blockers,'APOLLO_WARMUP_UNDER_42_DAYS');
    else blockers:=array_append(blockers,'OUTREACH_MAILBOXES_NOT_READY'); end if;
  end if;

  if apollo.id is not null then
    select * into budget from public.provider_credit_budgets
    where organization_id=target_organization_id and provider_account_id=apollo.id
      and cycle_start<=target_evaluated_at::date and cycle_end>target_evaluated_at::date
    order by cycle_start desc limit 1;
    if not found then blockers:=array_append(blockers,'APOLLO_CREDIT_BUDGET_MISSING');
    elsif budget.status<>'ACTIVE' or budget.credit_limit>500 or budget.research_credit_cap>500
      or budget.infrastructure_credit_spend<>0 or budget.phone_enrichment_allowed
    then blockers:=array_append(blockers,'APOLLO_CREDIT_BUDGET_INVALID'); end if;

    select count(*) filter (where g.status='PASS' and (g.expires_at is null or g.expires_at>target_evaluated_at)),
      count(*) filter (where g.status='PASS' and g.evidence_class='live' and (g.expires_at is null or g.expires_at>target_evaluated_at))
    into passed_gate_count,live_passed_gate_count from public.provider_activation_gates g
    where g.organization_id=target_organization_id and g.provider_account_id=apollo.id
      and g.gate_code=any(app.provider_control_requirements());
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
    'domains_ready',domains_ready,'domains_target',2,'mailboxes_ready',mailboxes_ready,'mailboxes_target',4,
    'warmup_days',minimum_warmup_days,'warmup_required_days',42,
    'activation_gates_passed',passed_gate_count,'activation_gates_required',required_gate_count,
    'live_gates_passed',live_passed_gate_count,
    'credit_limit',budget.credit_limit,'credits_consumed',budget.credits_consumed,
    'research_credit_cap',budget.research_credit_cap,'blockers',blockers
  );
exception when others then
  return jsonb_build_object('status','READ_ONLY','state','UNKNOWN','release_state','HOLD',
    'organization_id',target_organization_id,'evaluated_at',target_evaluated_at,
    'provider','Apollo','provider_account_id',null,'plan','UNKNOWN','ownership','UNKNOWN',
    'domains_ready',0,'domains_target',2,'mailboxes_ready',0,'mailboxes_target',4,
    'warmup_days',0,'warmup_required_days',42,'activation_gates_passed',0,
    'activation_gates_required',cardinality(app.provider_control_requirements()),'live_gates_passed',0,
    'credit_limit',null,'credits_consumed',null,'research_credit_cap',null,
    'blockers',array['PROVIDER_READ_MODEL_UNAVAILABLE']);
end;
$$;

create or replace function public.evaluate_outbound_provider_readiness(
  target_organization_id uuid,
  target_evaluated_at timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
begin
  if not app.is_member(target_organization_id) then raise exception 'PROVIDER_READ_AAL2_REQUIRED'; end if;
  return app.evaluate_outbound_provider_readiness_as_system(target_organization_id,target_evaluated_at);
end;
$$;

create or replace function public.apply_outbound_provider_snapshot(
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
  actor_id uuid:=auth.uid();
  request_sha text;
  existing_command public.provider_control_commands%rowtype;
  account_record jsonb;
  budget_record jsonb;
  domain_record jsonb;
  mailbox_record jsonb;
  gate_record jsonb;
  apollo_id uuid;
  domain_id uuid;
  result_status text;
  domain_count integer:=0;
  mailbox_count integer:=0;
  gate_count integer:=0;
  verified_timestamp timestamptz;
begin
  if not app.has_role(target_organization_id,array['ennco_admin'::public.user_role,'teckel_admin'::public.user_role]) then
    raise exception 'PROVIDER_SNAPSHOT_ADMIN_AAL2_REQUIRED';
  end if;
  if target_snapshot is null or jsonb_typeof(target_snapshot)<>'object'
    or target_idempotency_key is null or target_idempotency_key !~ '^[a-f0-9]{64}$'
  then raise exception 'PROVIDER_SNAPSHOT_INPUT_INVALID'; end if;
  if exists(
    select 1 from jsonb_object_keys(target_snapshot) key
    where key not in ('account','budget','domains','mailboxes','gates')
  ) or not (target_snapshot ?& array['account','budget','domains','mailboxes','gates'])
  then raise exception 'PROVIDER_SNAPSHOT_SHAPE_INVALID'; end if;
  if jsonb_typeof(target_snapshot->'account')<>'object'
    or jsonb_typeof(target_snapshot->'budget')<>'object'
    or jsonb_typeof(target_snapshot->'domains')<>'array'
    or jsonb_typeof(target_snapshot->'mailboxes')<>'array'
    or jsonb_typeof(target_snapshot->'gates')<>'array'
  then raise exception 'PROVIDER_SNAPSHOT_SHAPE_INVALID'; end if;

  domain_count:=jsonb_array_length(target_snapshot->'domains');
  mailbox_count:=jsonb_array_length(target_snapshot->'mailboxes');
  gate_count:=jsonb_array_length(target_snapshot->'gates');
  if domain_count>2 or mailbox_count>4 or gate_count>cardinality(app.provider_control_requirements()) then
    raise exception 'PROVIDER_SNAPSHOT_CARDINALITY_INVALID';
  end if;
  if domain_count<>(select count(distinct value->>'normalized_domain') from jsonb_array_elements(target_snapshot->'domains'))
    or mailbox_count<>(select count(distinct value->>'normalized_email') from jsonb_array_elements(target_snapshot->'mailboxes'))
    or gate_count<>(select count(distinct value->>'gate_code') from jsonb_array_elements(target_snapshot->'gates'))
  then raise exception 'PROVIDER_SNAPSHOT_DUPLICATE_IDENTITY'; end if;

  request_sha:=encode(digest(target_snapshot::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':provider-snapshot',0));
  select * into existing_command from public.provider_control_commands
  where organization_id=target_organization_id and idempotency_key_sha256=target_idempotency_key;
  if found then
    if existing_command.command_type<>'PROVIDER_ACCOUNT' or existing_command.request_sha256<>request_sha then
      raise exception 'PROVIDER_SNAPSHOT_IDEMPOTENCY_DRIFT';
    end if;
    return jsonb_build_object(
      'status','DUPLICATE','provider_account_id',existing_command.target_id,
      'request_sha256',request_sha,'readiness',app.evaluate_outbound_provider_readiness_as_system(target_organization_id,clock_timestamp())
    );
  end if;

  account_record:=target_snapshot->'account';
  if account_record->>'provider_code'<>'APOLLO' or account_record->>'environment'<>'PRODUCTION'
    or coalesce(account_record->>'evidence_sha256','') !~ '^[a-f0-9]{64}$'
  then raise exception 'PROVIDER_ACCOUNT_SNAPSHOT_INVALID'; end if;
  verified_timestamp:=nullif(account_record->>'verified_at','')::timestamptz;

  select id into apollo_id from public.provider_accounts
  where organization_id=target_organization_id and provider_code='APOLLO' and environment='PRODUCTION'
  for update;
  result_status:=case when found then 'UPDATED' else 'CREATED' end;

  insert into public.provider_accounts(
    organization_id,provider_code,environment,ownership_status,terms_status,plan_name,legal_owner,
    seat_count,billing_frequency,external_account_ref_sha256,mfa_status,recovery_status,
    monthly_budget_mxn,hard_cap_mxn,evidence_sha256,renewal_at,delivery_status,last_audited_at,
    verified_by,verified_at,active
  ) values (
    target_organization_id,'APOLLO','PRODUCTION',account_record->>'ownership_status',
    account_record->>'terms_status',account_record->>'plan_name',account_record->>'legal_owner',
    (account_record->>'seat_count')::integer,account_record->>'billing_frequency',
    nullif(account_record->>'external_account_ref_sha256',''),account_record->>'mfa_status',
    account_record->>'recovery_status',(account_record->>'monthly_budget_mxn')::numeric,
    (account_record->>'hard_cap_mxn')::numeric,account_record->>'evidence_sha256',
    nullif(account_record->>'renewal_at','')::timestamptz,account_record->>'delivery_status',
    nullif(account_record->>'last_audited_at','')::timestamptz,
    case when verified_timestamp is null then null else actor_id end,verified_timestamp,
    (account_record->>'active')::boolean
  )
  on conflict (organization_id,provider_code,environment) do update set
    ownership_status=excluded.ownership_status,terms_status=excluded.terms_status,plan_name=excluded.plan_name,
    legal_owner=excluded.legal_owner,seat_count=excluded.seat_count,billing_frequency=excluded.billing_frequency,
    external_account_ref_sha256=excluded.external_account_ref_sha256,mfa_status=excluded.mfa_status,
    recovery_status=excluded.recovery_status,monthly_budget_mxn=excluded.monthly_budget_mxn,
    hard_cap_mxn=excluded.hard_cap_mxn,evidence_sha256=excluded.evidence_sha256,
    renewal_at=excluded.renewal_at,delivery_status=excluded.delivery_status,
    last_audited_at=excluded.last_audited_at,verified_by=excluded.verified_by,
    verified_at=excluded.verified_at,active=excluded.active,updated_at=clock_timestamp()
  returning id into apollo_id;

  budget_record:=target_snapshot->'budget';
  if coalesce(budget_record->>'evidence_sha256','') !~ '^[a-f0-9]{64}$' then
    raise exception 'PROVIDER_BUDGET_SNAPSHOT_INVALID';
  end if;
  insert into public.provider_credit_budgets(
    organization_id,provider_account_id,cycle_start,cycle_end,credit_limit,credits_consumed,
    research_credit_cap,infrastructure_credit_spend,phone_enrichment_allowed,status,evidence_sha256,observed_at
  ) values (
    target_organization_id,apollo_id,(budget_record->>'cycle_start')::date,(budget_record->>'cycle_end')::date,
    (budget_record->>'credit_limit')::integer,(budget_record->>'credits_consumed')::integer,
    (budget_record->>'research_credit_cap')::integer,(budget_record->>'infrastructure_credit_spend')::integer,
    (budget_record->>'phone_enrichment_allowed')::boolean,budget_record->>'status',
    budget_record->>'evidence_sha256',(budget_record->>'observed_at')::timestamptz
  )
  on conflict (organization_id,provider_account_id,cycle_start) do update set
    cycle_end=excluded.cycle_end,credit_limit=excluded.credit_limit,credits_consumed=excluded.credits_consumed,
    research_credit_cap=excluded.research_credit_cap,infrastructure_credit_spend=excluded.infrastructure_credit_spend,
    phone_enrichment_allowed=excluded.phone_enrichment_allowed,status=excluded.status,
    evidence_sha256=excluded.evidence_sha256,observed_at=excluded.observed_at;

  for domain_record in select value from jsonb_array_elements(target_snapshot->'domains') loop
    if coalesce(domain_record->>'evidence_sha256','') !~ '^[a-f0-9]{64}$' then
      raise exception 'OUTREACH_DOMAIN_SNAPSHOT_INVALID';
    end if;
    insert into public.outreach_domains(
      organization_id,provider_account_id,normalized_domain,asset_source,ownership_status,lifecycle_status,
      auth_spf,auth_dkim,auth_dmarc,auth_tls,postmaster_verified,reputation_status,
      registered_at,expires_at,evidence_sha256,verified_at
    ) values (
      target_organization_id,apollo_id,lower(btrim(domain_record->>'normalized_domain')),
      domain_record->>'asset_source',domain_record->>'ownership_status',domain_record->>'lifecycle_status',
      (domain_record->>'auth_spf')::boolean,(domain_record->>'auth_dkim')::boolean,
      (domain_record->>'auth_dmarc')::boolean,(domain_record->>'auth_tls')::boolean,
      (domain_record->>'postmaster_verified')::boolean,domain_record->>'reputation_status',
      nullif(domain_record->>'registered_at','')::timestamptz,nullif(domain_record->>'expires_at','')::timestamptz,
      domain_record->>'evidence_sha256',nullif(domain_record->>'verified_at','')::timestamptz
    )
    on conflict (organization_id,normalized_domain) do update set
      provider_account_id=excluded.provider_account_id,asset_source=excluded.asset_source,
      ownership_status=excluded.ownership_status,lifecycle_status=excluded.lifecycle_status,
      auth_spf=excluded.auth_spf,auth_dkim=excluded.auth_dkim,auth_dmarc=excluded.auth_dmarc,
      auth_tls=excluded.auth_tls,postmaster_verified=excluded.postmaster_verified,
      reputation_status=excluded.reputation_status,registered_at=excluded.registered_at,
      expires_at=excluded.expires_at,evidence_sha256=excluded.evidence_sha256,
      verified_at=excluded.verified_at,updated_at=clock_timestamp();
  end loop;

  for mailbox_record in select value from jsonb_array_elements(target_snapshot->'mailboxes') loop
    select id into domain_id from public.outreach_domains
    where organization_id=target_organization_id
      and normalized_domain=lower(btrim(mailbox_record->>'domain'))
      and provider_account_id=apollo_id;
    if not found or coalesce(mailbox_record->>'provider_evidence_sha256','') !~ '^[a-f0-9]{64}$'
    then raise exception 'OUTREACH_MAILBOX_SNAPSHOT_INVALID'; end if;
    insert into public.mailboxes(
      organization_id,normalized_email,domain,sender_name,provider,domain_ready_at,
      auth_spf,auth_dkim,auth_dmarc,auth_tls,health_status,kill_switch,
      provider_account_id,outreach_domain_id,provider_external_ref_sha256,ownership_status,
      credential_status,warmup_started_at,warmup_minimum_days,warmup_status,
      sender_identity_verified,gmail_seed_verified,outlook_seed_verified,yahoo_seed_verified,
      reply_sync_verified,list_unsubscribe_verified,one_click_unsubscribe_verified,
      provider_evidence_sha256,provider_daily_limit,last_provider_health_at
    ) values (
      target_organization_id,lower(btrim(mailbox_record->>'normalized_email')),
      lower(btrim(mailbox_record->>'domain')),'Francisco Cuellar','gmail',
      nullif(mailbox_record->>'domain_ready_at','')::timestamptz,
      (mailbox_record->>'auth_spf')::boolean,(mailbox_record->>'auth_dkim')::boolean,
      (mailbox_record->>'auth_dmarc')::boolean,(mailbox_record->>'auth_tls')::boolean,
      mailbox_record->>'health_status',(mailbox_record->>'kill_switch')::boolean,
      apollo_id,domain_id,nullif(mailbox_record->>'provider_external_ref_sha256',''),
      mailbox_record->>'ownership_status',mailbox_record->>'credential_status',
      nullif(mailbox_record->>'warmup_started_at','')::timestamptz,42,mailbox_record->>'warmup_status',
      (mailbox_record->>'sender_identity_verified')::boolean,(mailbox_record->>'gmail_seed_verified')::boolean,
      (mailbox_record->>'outlook_seed_verified')::boolean,(mailbox_record->>'yahoo_seed_verified')::boolean,
      (mailbox_record->>'reply_sync_verified')::boolean,(mailbox_record->>'list_unsubscribe_verified')::boolean,
      (mailbox_record->>'one_click_unsubscribe_verified')::boolean,mailbox_record->>'provider_evidence_sha256',
      (mailbox_record->>'provider_daily_limit')::integer,
      nullif(mailbox_record->>'last_provider_health_at','')::timestamptz
    )
    on conflict (organization_id,normalized_email) do update set
      domain=excluded.domain,sender_name=excluded.sender_name,provider=excluded.provider,
      domain_ready_at=excluded.domain_ready_at,auth_spf=excluded.auth_spf,auth_dkim=excluded.auth_dkim,
      auth_dmarc=excluded.auth_dmarc,auth_tls=excluded.auth_tls,health_status=excluded.health_status,
      kill_switch=excluded.kill_switch,provider_account_id=excluded.provider_account_id,
      outreach_domain_id=excluded.outreach_domain_id,
      provider_external_ref_sha256=excluded.provider_external_ref_sha256,
      ownership_status=excluded.ownership_status,credential_status=excluded.credential_status,
      warmup_started_at=excluded.warmup_started_at,warmup_minimum_days=42,
      warmup_status=excluded.warmup_status,sender_identity_verified=excluded.sender_identity_verified,
      gmail_seed_verified=excluded.gmail_seed_verified,outlook_seed_verified=excluded.outlook_seed_verified,
      yahoo_seed_verified=excluded.yahoo_seed_verified,reply_sync_verified=excluded.reply_sync_verified,
      list_unsubscribe_verified=excluded.list_unsubscribe_verified,
      one_click_unsubscribe_verified=excluded.one_click_unsubscribe_verified,
      provider_evidence_sha256=excluded.provider_evidence_sha256,
      provider_daily_limit=excluded.provider_daily_limit,
      last_provider_health_at=excluded.last_provider_health_at,updated_at=clock_timestamp();
  end loop;

  for gate_record in select value from jsonb_array_elements(target_snapshot->'gates') loop
    if not ((gate_record->>'gate_code')=any(app.provider_control_requirements()))
      or coalesce(gate_record->>'evidence_sha256','') !~ '^[a-f0-9]{64}$'
    then raise exception 'PROVIDER_ACTIVATION_GATE_SNAPSHOT_INVALID'; end if;
    insert into public.provider_activation_gates(
      organization_id,provider_account_id,gate_code,status,evidence_sha256,evidence_class,
      recorded_by,recorded_at,expires_at
    ) values (
      target_organization_id,apollo_id,gate_record->>'gate_code',gate_record->>'status',
      gate_record->>'evidence_sha256',gate_record->>'evidence_class',actor_id,
      (gate_record->>'recorded_at')::timestamptz,nullif(gate_record->>'expires_at','')::timestamptz
    )
    on conflict (organization_id,provider_account_id,gate_code) do update set
      status=excluded.status,evidence_sha256=excluded.evidence_sha256,
      evidence_class=excluded.evidence_class,recorded_by=excluded.recorded_by,
      recorded_at=excluded.recorded_at,expires_at=excluded.expires_at;
  end loop;

  insert into public.provider_control_commands(
    organization_id,command_type,idempotency_key_sha256,request_sha256,target_id,
    result_status,actor_user_id
  ) values (
    target_organization_id,'PROVIDER_ACCOUNT',target_idempotency_key,request_sha,apollo_id,
    result_status,actor_id
  );

  return jsonb_build_object(
    'status',result_status,'provider_account_id',apollo_id,'request_sha256',request_sha,
    'domains_recorded',domain_count,'mailboxes_recorded',mailbox_count,'gates_recorded',gate_count,
    'readiness',app.evaluate_outbound_provider_readiness_as_system(target_organization_id,clock_timestamp())
  );
end;
$$;

create or replace function app.enforce_m024_provider_infrastructure()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare readiness jsonb;
begin
  if new.direction='OUTBOUND' and new.status not in ('DRAFT','DRY_RUN') then
    readiness:=app.evaluate_outbound_provider_readiness_as_system(new.organization_id,clock_timestamp());
    if readiness->>'release_state'<>'READY_FOR_CANARY' then
      raise exception 'PROVIDER_INFRASTRUCTURE_NOT_READY';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_aaa_m024_provider_infrastructure on public.messages;
create trigger messages_aaa_m024_provider_infrastructure
before insert or update of direction,status,mailbox_id on public.messages
for each row execute function app.enforce_m024_provider_infrastructure();

alter table public.provider_accounts enable row level security;
alter table public.provider_accounts force row level security;
alter table public.provider_credit_budgets enable row level security;
alter table public.provider_credit_budgets force row level security;
alter table public.outreach_domains enable row level security;
alter table public.outreach_domains force row level security;
alter table public.provider_activation_gates enable row level security;
alter table public.provider_activation_gates force row level security;
alter table public.provider_control_commands enable row level security;
alter table public.provider_control_commands force row level security;

drop policy if exists provider_accounts_member_read on public.provider_accounts;
create policy provider_accounts_member_read on public.provider_accounts for select to authenticated
using (app.is_member(organization_id));
drop policy if exists provider_credit_budgets_member_read on public.provider_credit_budgets;
create policy provider_credit_budgets_member_read on public.provider_credit_budgets for select to authenticated
using (app.is_member(organization_id));
drop policy if exists outreach_domains_member_read on public.outreach_domains;
create policy outreach_domains_member_read on public.outreach_domains for select to authenticated
using (app.is_member(organization_id));
drop policy if exists provider_activation_gates_member_read on public.provider_activation_gates;
create policy provider_activation_gates_member_read on public.provider_activation_gates for select to authenticated
using (app.is_member(organization_id));
drop policy if exists provider_control_commands_admin_read on public.provider_control_commands;
create policy provider_control_commands_admin_read on public.provider_control_commands for select to authenticated
using (app.has_role(organization_id,array['ennco_admin'::public.user_role,'teckel_admin'::public.user_role]));

revoke all on table public.provider_accounts from public,anon,authenticated,service_role;
revoke all on table public.provider_credit_budgets from public,anon,authenticated,service_role;
revoke all on table public.outreach_domains from public,anon,authenticated,service_role;
revoke all on table public.provider_activation_gates from public,anon,authenticated,service_role;
revoke all on table public.provider_control_commands from public,anon,authenticated,service_role;
grant select on table public.provider_accounts,public.provider_credit_budgets,public.outreach_domains,
  public.provider_activation_gates,public.provider_control_commands to authenticated;

revoke all on function app.provider_control_requirements() from public,anon,authenticated,service_role;
revoke all on function app.provider_mailbox_is_ready(uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function app.evaluate_outbound_provider_readiness_as_system(uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function app.enforce_m024_provider_infrastructure() from public,anon,authenticated,service_role;
revoke all on function public.evaluate_outbound_provider_readiness(uuid,timestamptz) from public,anon,service_role;
grant execute on function public.evaluate_outbound_provider_readiness(uuid,timestamptz) to authenticated;
revoke all on function public.apply_outbound_provider_snapshot(uuid,jsonb,text) from public,anon,service_role;
grant execute on function public.apply_outbound_provider_snapshot(uuid,jsonb,text) to authenticated;

commit;
