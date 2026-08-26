begin;

drop trigger if exists messages_aaa_m029_rollback_fail_closed on public.messages;
drop function if exists app.m029_block_real_outbound();

alter table public.mailboxes
  add column if not exists eligibility_route text not null default 'NEW_ISOLATED_MAILBOX_WARMUP',
  add column if not exists domain_role text not null default 'OUTREACH_ISOLATED',
  add column if not exists custody_status text not null default 'UNKNOWN',
  add column if not exists domain_registered_at timestamptz,
  add column if not exists human_history_verified boolean not null default false,
  add column if not exists blocklist_status text not null default 'UNKNOWN',
  add column if not exists tier1_only boolean not null default true,
  add column if not exists max_account_count integer not null default 50,
  add column if not exists max_email_touches integer not null default 3,
  add column if not exists route_evidence_sha256 text,
  add column if not exists route_evidence_at timestamptz;

alter table public.mailboxes
  drop constraint if exists mailboxes_warmup_minimum_days_check,
  drop constraint if exists mailboxes_provider_daily_limit_check,
  drop constraint if exists mailboxes_eligibility_route_check,
  drop constraint if exists mailboxes_domain_role_check,
  drop constraint if exists mailboxes_custody_status_check,
  drop constraint if exists mailboxes_blocklist_status_check,
  drop constraint if exists mailboxes_hybrid_limits_check,
  drop constraint if exists mailboxes_route_evidence_sha256_check,
  drop constraint if exists mailboxes_route_coherence_check;

alter table public.mailboxes
  add constraint mailboxes_warmup_minimum_days_check check (warmup_minimum_days in (0,42)),
  add constraint mailboxes_provider_daily_limit_check check (provider_daily_limit between 0 and 20),
  add constraint mailboxes_eligibility_route_check check (eligibility_route in (
    'EXISTING_PRIMARY_GMAIL_RAMP','NEW_ISOLATED_MAILBOX_WARMUP'
  )),
  add constraint mailboxes_domain_role_check check (domain_role in ('PRIMARY_CORPORATE','OUTREACH_ISOLATED')),
  add constraint mailboxes_custody_status_check check (custody_status in (
    'UNKNOWN','TECKEL_MANAGED_FOR_ENNCO','APOLLO_PROVISIONED_TECKEL_CUSTODY','ENNCO_DIRECT'
  )),
  add constraint mailboxes_blocklist_status_check check (blocklist_status in ('UNKNOWN','CLEAR','LISTED')),
  add constraint mailboxes_hybrid_limits_check check (
    tier1_only and max_account_count=50 and max_email_touches=3
  ),
  add constraint mailboxes_route_evidence_sha256_check check (
    route_evidence_sha256 is null or route_evidence_sha256 ~ '^[a-f0-9]{64}$'
  ),
  add constraint mailboxes_route_coherence_check check (
    (eligibility_route='EXISTING_PRIMARY_GMAIL_RAMP' and domain_role='PRIMARY_CORPORATE' and warmup_minimum_days=0)
    or
    (eligibility_route='NEW_ISOLATED_MAILBOX_WARMUP' and domain_role='OUTREACH_ISOLATED' and warmup_minimum_days=42)
  );

create table if not exists public.hybrid_mailbox_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mailbox_id uuid not null,
  valid_deliveries integer not null default 0 check (valid_deliveries>=0),
  attempted_deliveries integer not null default 0 check (attempted_deliveries>=valid_deliveries),
  hard_bounces integer not null default 0 check (hard_bounces>=0 and hard_bounces<=attempted_deliveries),
  spam_complaints integer not null default 0 check (spam_complaints>=0 and spam_complaints<=attempted_deliveries),
  delivery_rate numeric(8,6) check (delivery_rate is null or delivery_rate between 0 and 1),
  reply_sync_p95_seconds integer check (reply_sync_p95_seconds is null or reply_sync_p95_seconds>=0),
  positive_reply_sla_breaches integer not null default 0 check (positive_reply_sla_breaches>=0),
  provider_reconciled boolean not null default false,
  suppression_reconciled boolean not null default false,
  identity_unambiguous boolean not null default false,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_class public.evidence_class not null default 'synthetic_demo',
  observed_at timestamptz not null,
  idempotency_key_sha256 text not null check (idempotency_key_sha256 ~ '^[a-f0-9]{64}$'),
  recorded_by uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id,id),
  unique (organization_id,idempotency_key_sha256),
  constraint hybrid_mailbox_observations_mailbox_tenant_fkey
    foreign key (organization_id,mailbox_id) references public.mailboxes(organization_id,id),
  check (observed_at<=created_at+interval '5 minutes'),
  check (
    (attempted_deliveries=0 and delivery_rate is null)
    or
    (attempted_deliveries>0 and delivery_rate is not null
      and delivery_rate=round(valid_deliveries::numeric/attempted_deliveries::numeric,6))
  )
);

create index if not exists hybrid_mailbox_observations_latest_idx
on public.hybrid_mailbox_observations(organization_id,mailbox_id,observed_at desc);

create table if not exists public.hybrid_outbound_releases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mailbox_id uuid not null,
  campaign_id uuid not null,
  lane text not null check (lane in ('ACCELERATED_TIER1_CANARY','ISOLATED_MAILBOX_CANARY')),
  status text not null check (status in ('READY_FOR_CANARY','CANARY_ACTIVE','SCALE_ALLOWED','PAUSED','KILLED')),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  suppression_sha256 text not null check (suppression_sha256 ~ '^[a-f0-9]{64}$'),
  copy_sha256 text not null check (copy_sha256 ~ '^[a-f0-9]{64}$'),
  sequence_sha256 text not null check (sequence_sha256 ~ '^[a-f0-9]{64}$'),
  route_evidence_sha256 text not null check (route_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  recipient_count integer not null check (recipient_count between 1 and 20),
  account_count integer not null check (account_count=recipient_count),
  daily_cap_snapshot integer not null check (daily_cap_snapshot in (5,10,15,20)),
  scheduled_for timestamptz not null,
  expires_at timestamptz not null,
  approved_by uuid not null,
  approved_at timestamptz not null default now(),
  paused_at timestamptz,
  killed_at timestamptz,
  pause_reason_code text check (pause_reason_code is null or pause_reason_code ~ '^[A-Z0-9_]{3,80}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,id),
  unique (organization_id,manifest_sha256),
  constraint hybrid_outbound_releases_mailbox_tenant_fkey
    foreign key (organization_id,mailbox_id) references public.mailboxes(organization_id,id),
  constraint hybrid_outbound_releases_campaign_tenant_fkey
    foreign key (organization_id,campaign_id) references public.campaigns(organization_id,id),
  check (expires_at>scheduled_for and scheduled_for>=approved_at-interval '5 minutes'),
  check (
    (status in ('READY_FOR_CANARY','CANARY_ACTIVE','SCALE_ALLOWED') and paused_at is null and killed_at is null and pause_reason_code is null)
    or (status='PAUSED' and paused_at is not null and killed_at is null and pause_reason_code is not null)
    or (status='KILLED' and killed_at is not null and pause_reason_code is not null)
  )
);

create index if not exists hybrid_outbound_releases_active_idx
on public.hybrid_outbound_releases(organization_id,mailbox_id,status,expires_at);

create table if not exists public.hybrid_outbound_release_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  release_id uuid not null,
  enrollment_id uuid not null,
  account_id uuid not null,
  contact_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id,release_id,enrollment_id),
  unique (organization_id,release_id,account_id),
  unique (organization_id,release_id,contact_id),
  constraint hybrid_release_enrollments_release_tenant_fkey
    foreign key (organization_id,release_id) references public.hybrid_outbound_releases(organization_id,id),
  constraint hybrid_release_enrollments_enrollment_tenant_fkey
    foreign key (organization_id,enrollment_id) references public.campaign_enrollments(organization_id,id),
  constraint hybrid_release_enrollments_account_tenant_fkey
    foreign key (organization_id,account_id) references public.accounts(organization_id,id),
  constraint hybrid_release_enrollments_contact_tenant_fkey
    foreign key (organization_id,contact_id) references public.contacts(organization_id,id)
);

create table if not exists public.hybrid_outbound_command_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  command_type text not null check (command_type in ('MAILBOX_SNAPSHOT','RAMP_OBSERVATION','RELEASE_CREATE')),
  idempotency_key_sha256 text not null check (idempotency_key_sha256 ~ '^[a-f0-9]{64}$'),
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  target_id uuid,
  result_json jsonb not null,
  actor_user_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id,idempotency_key_sha256)
);

create or replace function app.hybrid_mailbox_address_is_allowed(target_email text,target_route text)
returns boolean language sql immutable set search_path=pg_catalog as $$
  select case
    when target_route='EXISTING_PRIMARY_GMAIL_RAMP' then lower(target_email)='contacto@ennco.com.mx'
    when target_route='NEW_ISOLATED_MAILBOX_WARMUP' then lower(target_email) in (
      'francisco@enncoindustrial.com','fcuellar@enncoindustrial.com','francisco@enncoenergia.com'
    )
    else false
  end
$$;

create or replace function app.evaluate_hybrid_mailbox_as_system(
  target_organization_id uuid,target_mailbox_id uuid,target_evaluated_at timestamptz
)
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
declare
  mailbox_record public.mailboxes%rowtype;
  observation_record public.hybrid_mailbox_observations%rowtype;
  blockers text[]:=array[]::text[];
  calculated_state text:='UNKNOWN';
  effective_release text:='HOLD';
  cap integer:=0;
  domain_age integer:=0;
  warmup_age integer:=0;
begin
  select * into mailbox_record from public.mailboxes
  where organization_id=target_organization_id and id=target_mailbox_id;
  if not found then
    return jsonb_build_object('status','READ_ONLY','state','UNKNOWN','effective_release','HOLD',
      'organization_id',target_organization_id,'mailbox_id',target_mailbox_id,
      'evaluated_at',target_evaluated_at,'daily_cap',0,'blockers',array['MAILBOX_NOT_FOUND']);
  end if;
  select * into observation_record from public.hybrid_mailbox_observations
  where organization_id=target_organization_id and mailbox_id=target_mailbox_id
  order by observed_at desc limit 1;

  if not app.hybrid_mailbox_address_is_allowed(mailbox_record.normalized_email,mailbox_record.eligibility_route)
    then blockers:=array_append(blockers,'MAILBOX_ADDRESS_NOT_IN_APPROVED_TOPOLOGY'); end if;
  if mailbox_record.sender_name<>'Francisco Cuellar' or not mailbox_record.sender_identity_verified
    then blockers:=array_append(blockers,'SENDER_IDENTITY_NOT_VERIFIED'); end if;
  if mailbox_record.credential_status<>'OAUTH_CONNECTED'
    then blockers:=array_append(blockers,'MAILBOX_OAUTH_NOT_CONNECTED'); end if;
  if not (mailbox_record.auth_spf and mailbox_record.auth_dkim and mailbox_record.auth_dmarc and mailbox_record.auth_tls)
    then blockers:=array_append(blockers,'MAILBOX_AUTH_INCOMPLETE'); end if;
  if not (mailbox_record.gmail_seed_verified and mailbox_record.outlook_seed_verified and mailbox_record.yahoo_seed_verified)
    then blockers:=array_append(blockers,'MAILBOX_SEEDS_INCOMPLETE'); end if;
  if not mailbox_record.reply_sync_verified
    then blockers:=array_append(blockers,'REPLY_SYNC_NOT_VERIFIED'); end if;
  if mailbox_record.blocklist_status<>'CLEAR'
    then blockers:=array_append(blockers,'BLOCKLIST_STATUS_NOT_CLEAR'); end if;
  if mailbox_record.health_status<>'HEALTHY' or mailbox_record.kill_switch
    then blockers:=array_append(blockers,'MAILBOX_HEALTH_HOLD'); end if;
  if mailbox_record.route_evidence_sha256 is null or mailbox_record.route_evidence_at is null
    or mailbox_record.route_evidence_at<target_evaluated_at-interval '24 hours'
    then blockers:=array_append(blockers,'MAILBOX_ROUTE_EVIDENCE_STALE'); end if;
  if observation_record.id is null or observation_record.evidence_class<>'live'
    or observation_record.observed_at<target_evaluated_at-interval '24 hours'
    then blockers:=array_append(blockers,'MAILBOX_LIVE_OBSERVATION_MISSING');
  else
    if observation_record.spam_complaints>0 then blockers:=array_append(blockers,'SPAM_COMPLAINT_KILL'); end if;
    if observation_record.valid_deliveries<20 and observation_record.hard_bounces>0
      then blockers:=array_append(blockers,'EARLY_HARD_BOUNCE_KILL'); end if;
    if observation_record.valid_deliveries>=20 and observation_record.hard_bounces::numeric/observation_record.attempted_deliveries>=0.02
      then blockers:=array_append(blockers,'HARD_BOUNCE_RATE_HOLD'); end if;
    if observation_record.valid_deliveries>=20 and observation_record.delivery_rate<0.95
      then blockers:=array_append(blockers,'DELIVERY_RATE_HOLD'); end if;
    if observation_record.reply_sync_p95_seconds is null or observation_record.reply_sync_p95_seconds>300
      then blockers:=array_append(blockers,'REPLY_SYNC_SLA_HOLD'); end if;
    if observation_record.positive_reply_sla_breaches>0
      then blockers:=array_append(blockers,'POSITIVE_REPLY_SLA_HOLD'); end if;
    if not observation_record.provider_reconciled
      then blockers:=array_append(blockers,'PROVIDER_LEDGER_MISMATCH'); end if;
    if not observation_record.suppression_reconciled
      then blockers:=array_append(blockers,'SUPPRESSION_UNKNOWN'); end if;
    if not observation_record.identity_unambiguous
      then blockers:=array_append(blockers,'IDENTITY_AMBIGUOUS'); end if;
  end if;

  if mailbox_record.eligibility_route='EXISTING_PRIMARY_GMAIL_RAMP' then
    domain_age:=case when mailbox_record.domain_registered_at is null then 0
      else greatest(0,floor(extract(epoch from (target_evaluated_at-mailbox_record.domain_registered_at))/86400)::integer) end;
    if domain_age<180 then blockers:=array_append(blockers,'PRIMARY_DOMAIN_UNDER_180_DAYS'); end if;
    if not mailbox_record.human_history_verified then blockers:=array_append(blockers,'MAILBOX_HUMAN_HISTORY_UNKNOWN'); end if;
    if mailbox_record.normalized_email<>'contacto@ennco.com.mx' or mailbox_record.domain<>'ennco.com.mx'
      then blockers:=array_append(blockers,'PRIMARY_MAILBOX_IDENTITY_DRIFT'); end if;
    if observation_record.id is null then cap:=0;
    elsif observation_record.valid_deliveries<20 then cap:=5;
    elsif observation_record.valid_deliveries<50 then cap:=10;
    elsif observation_record.valid_deliveries<100 then cap:=15;
    else cap:=20; end if;
  else
    warmup_age:=case when mailbox_record.warmup_started_at is null then 0
      else greatest(0,floor(extract(epoch from (target_evaluated_at-mailbox_record.warmup_started_at))/86400)::integer) end;
    if warmup_age<42 then blockers:=array_append(blockers,'ISOLATED_MAILBOX_WARMUP_UNDER_42_DAYS'); end if;
    if mailbox_record.domain not in ('enncoindustrial.com','enncoenergia.com')
      then blockers:=array_append(blockers,'ISOLATED_DOMAIN_DRIFT'); end if;
    cap:=case when observation_record.id is null then 0 else 5 end;
  end if;

  if 'SPAM_COMPLAINT_KILL'=any(blockers) or 'EARLY_HARD_BOUNCE_KILL'=any(blockers) then
    calculated_state:='BLOCKED'; effective_release:='KILLED'; cap:=0;
  elsif 'HARD_BOUNCE_RATE_HOLD'=any(blockers) or 'DELIVERY_RATE_HOLD'=any(blockers)
    or 'REPLY_SYNC_SLA_HOLD'=any(blockers) or 'POSITIVE_REPLY_SLA_HOLD'=any(blockers)
    or 'PROVIDER_LEDGER_MISMATCH'=any(blockers) or 'SUPPRESSION_UNKNOWN'=any(blockers)
    or 'IDENTITY_AMBIGUOUS'=any(blockers) then
    calculated_state:='BLOCKED'; effective_release:='PAUSED'; cap:=0;
  elsif cardinality(blockers)=0 then
    calculated_state:='READY';
    effective_release:=case when mailbox_record.eligibility_route='EXISTING_PRIMARY_GMAIL_RAMP'
      and observation_record.valid_deliveries>=100 then 'SCALE_ALLOWED' else 'READY_FOR_CANARY' end;
  elsif 'ISOLATED_MAILBOX_WARMUP_UNDER_42_DAYS'=any(blockers) then calculated_state:='WARMING';
  elsif observation_record.id is null then calculated_state:='UNKNOWN';
  else calculated_state:='BLOCKED';
  end if;

  return jsonb_build_object(
    'status','READ_ONLY','state',calculated_state,'effective_release',effective_release,
    'organization_id',target_organization_id,'mailbox_id',mailbox_record.id,
    'normalized_email',mailbox_record.normalized_email,'route',mailbox_record.eligibility_route,
    'domain_role',mailbox_record.domain_role,'custody_status',mailbox_record.custody_status,
    'evaluated_at',target_evaluated_at,'domain_age_days',domain_age,'warmup_days',warmup_age,
    'valid_deliveries',coalesce(observation_record.valid_deliveries,0),
    'attempted_deliveries',coalesce(observation_record.attempted_deliveries,0),
    'hard_bounces',coalesce(observation_record.hard_bounces,0),
    'spam_complaints',coalesce(observation_record.spam_complaints,0),
    'delivery_rate',observation_record.delivery_rate,'reply_sync_p95_seconds',observation_record.reply_sync_p95_seconds,
    'positive_reply_sla_breaches',coalesce(observation_record.positive_reply_sla_breaches,0),
    'daily_cap',cap,'blockers',blockers
  );
exception when others then
  return jsonb_build_object('status','READ_ONLY','state','UNKNOWN','effective_release','HOLD',
    'organization_id',target_organization_id,'mailbox_id',target_mailbox_id,
    'evaluated_at',target_evaluated_at,'daily_cap',0,'blockers',array['HYBRID_MAILBOX_READ_MODEL_UNAVAILABLE']);
end $$;

create or replace function app.evaluate_hybrid_outbound_as_system(
  target_organization_id uuid,target_evaluated_at timestamptz
)
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
declare mailbox_json jsonb; mailbox_rows jsonb:='[]'::jsonb; primary_ready integer:=0; isolated_ready integer:=0;
  primary_count integer:=0; isolated_count integer:=0; blockers text[]:=array[]::text[];
  verified_accounts integer:=0; verified_contacts integer:=0; active_release text;
begin
  for mailbox_json in
    select app.evaluate_hybrid_mailbox_as_system(target_organization_id,m.id,target_evaluated_at)
    from public.mailboxes m where m.organization_id=target_organization_id
      and app.hybrid_mailbox_address_is_allowed(m.normalized_email,m.eligibility_route)
    order by case when m.eligibility_route='EXISTING_PRIMARY_GMAIL_RAMP' then 0 else 1 end,m.normalized_email
  loop
    mailbox_rows:=mailbox_rows||jsonb_build_array(mailbox_json);
    blockers:=blockers||array(select jsonb_array_elements_text(coalesce(mailbox_json->'blockers','[]'::jsonb)));
    if mailbox_json->>'route'='EXISTING_PRIMARY_GMAIL_RAMP' then
      primary_count:=primary_count+1;
      if mailbox_json->>'state'='READY' then primary_ready:=primary_ready+1; end if;
    else
      isolated_count:=isolated_count+1;
      if mailbox_json->>'state'='READY' then isolated_ready:=isolated_ready+1; end if;
    end if;
  end loop;
  if primary_count<>1 then blockers:=array_append(blockers,'PRIMARY_MAILBOX_COUNT_NOT_ONE'); end if;
  if isolated_count<>3 then blockers:=array_append(blockers,'ISOLATED_MAILBOX_COUNT_NOT_THREE'); end if;
  select case when hr.status='SCALE_ALLOWED' then 'SCALE_ALLOWED' else 'READY_FOR_CANARY' end into active_release
  from public.hybrid_outbound_releases hr
  join public.mailboxes m on m.organization_id=hr.organization_id and m.id=hr.mailbox_id
  where hr.organization_id=target_organization_id and m.eligibility_route='EXISTING_PRIMARY_GMAIL_RAMP'
    and hr.status in ('READY_FOR_CANARY','CANARY_ACTIVE','SCALE_ALLOWED')
    and hr.scheduled_for<=target_evaluated_at and hr.expires_at>target_evaluated_at
  order by hr.approved_at desc limit 1;
  if primary_ready=1 and active_release is null then blockers:=array_append(blockers,'EXACT_ACTIVE_RELEASE_MISSING'); end if;
  select count(*) into verified_accounts from public.accounts where organization_id=target_organization_id
    and not is_deleted and research_status='VERIFIED';
  select count(*) into verified_contacts from public.research_contact_candidates where organization_id=target_organization_id
    and research_status='PROMOTED' and promoted_contact_id is not null;
  return jsonb_build_object(
    'status','READ_ONLY','state',case when primary_ready=1 then 'READY'
      when primary_count=0 then 'UNKNOWN' else 'BLOCKED' end,
    'effective_release',case when primary_ready=1 then coalesce(active_release,'HOLD') else 'HOLD' end,
    'organization_id',target_organization_id,'evaluated_at',target_evaluated_at,
    'primary_mailbox_ready',primary_ready=1,'isolated_mailboxes_ready',isolated_ready,
    'isolated_mailboxes_target',3,'mailboxes',mailbox_rows,
    'inventory',jsonb_build_object('minimum_accounts',75,'minimum_contacts',150,
      'operational_accounts',150,'operational_contacts',300,
      'verified_accounts',verified_accounts,'verified_contacts',verified_contacts),
    'blockers',blockers
  );
exception when others then
  return jsonb_build_object('status','READ_ONLY','state','UNKNOWN','effective_release','HOLD',
    'organization_id',target_organization_id,'evaluated_at',target_evaluated_at,
    'primary_mailbox_ready',false,'isolated_mailboxes_ready',0,'isolated_mailboxes_target',3,
    'mailboxes','[]'::jsonb,'inventory',jsonb_build_object('minimum_accounts',75,'minimum_contacts',150,
      'operational_accounts',150,'operational_contacts',300,'verified_accounts',0,'verified_contacts',0),
    'blockers',array['HYBRID_OUTBOUND_READ_MODEL_UNAVAILABLE']);
end $$;

create or replace function public.evaluate_hybrid_outbound_readiness(
  target_organization_id uuid,target_evaluated_at timestamptz default clock_timestamp()
)
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
begin
  if not app.is_member(target_organization_id) then raise exception 'HYBRID_OUTBOUND_READ_AAL2_REQUIRED'; end if;
  return app.evaluate_hybrid_outbound_as_system(target_organization_id,target_evaluated_at);
end $$;

create or replace function public.apply_hybrid_mailbox_snapshot(
  target_organization_id uuid,target_snapshot jsonb,target_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare actor_id uuid:=auth.uid(); request_sha text; existing public.hybrid_outbound_command_ledger%rowtype;
  mailbox_id_value uuid; email_value text; route_value text; result jsonb;
begin
  if not app.has_role(target_organization_id,array['ennco_admin'::public.user_role,'teckel_admin'::public.user_role])
    then raise exception 'HYBRID_MAILBOX_ADMIN_AAL2_REQUIRED'; end if;
  if target_snapshot is null or jsonb_typeof(target_snapshot)<>'object' or target_idempotency_key!~'^[a-f0-9]{64}$'
    then raise exception 'HYBRID_MAILBOX_INPUT_INVALID'; end if;
  request_sha:=encode(digest(target_snapshot::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':hybrid-mailbox:'||coalesce(target_snapshot->>'normalized_email',''),0));
  select * into existing from public.hybrid_outbound_command_ledger where organization_id=target_organization_id and idempotency_key_sha256=target_idempotency_key;
  if found then
    if existing.command_type<>'MAILBOX_SNAPSHOT' or existing.request_sha256<>request_sha then raise exception 'HYBRID_MAILBOX_IDEMPOTENCY_DRIFT'; end if;
    return existing.result_json||jsonb_build_object('status','DUPLICATE');
  end if;
  email_value:=lower(btrim(target_snapshot->>'normalized_email')); route_value:=target_snapshot->>'eligibility_route';
  if not app.hybrid_mailbox_address_is_allowed(email_value,route_value)
    or coalesce(target_snapshot->>'route_evidence_sha256','')!~'^[a-f0-9]{64}$'
    then raise exception 'HYBRID_MAILBOX_SNAPSHOT_INVALID'; end if;
  insert into public.mailboxes(
    organization_id,normalized_email,domain,sender_name,provider,domain_ready_at,auth_spf,auth_dkim,auth_dmarc,auth_tls,
    health_status,kill_switch,credential_status,warmup_started_at,warmup_minimum_days,warmup_status,
    sender_identity_verified,gmail_seed_verified,outlook_seed_verified,yahoo_seed_verified,reply_sync_verified,
    provider_evidence_sha256,provider_daily_limit,last_provider_health_at,eligibility_route,domain_role,custody_status,
    domain_registered_at,human_history_verified,blocklist_status,route_evidence_sha256,route_evidence_at
  ) values (
    target_organization_id,email_value,lower(btrim(target_snapshot->>'domain')),'Francisco Cuellar',target_snapshot->>'provider',
    nullif(target_snapshot->>'domain_ready_at','')::timestamptz,(target_snapshot->>'auth_spf')::boolean,
    (target_snapshot->>'auth_dkim')::boolean,(target_snapshot->>'auth_dmarc')::boolean,(target_snapshot->>'auth_tls')::boolean,
    target_snapshot->>'health_status',(target_snapshot->>'kill_switch')::boolean,target_snapshot->>'credential_status',
    nullif(target_snapshot->>'warmup_started_at','')::timestamptz,case when route_value='EXISTING_PRIMARY_GMAIL_RAMP' then 0 else 42 end,
    target_snapshot->>'warmup_status',(target_snapshot->>'sender_identity_verified')::boolean,
    (target_snapshot->>'gmail_seed_verified')::boolean,(target_snapshot->>'outlook_seed_verified')::boolean,
    (target_snapshot->>'yahoo_seed_verified')::boolean,(target_snapshot->>'reply_sync_verified')::boolean,
    target_snapshot->>'route_evidence_sha256',(target_snapshot->>'provider_daily_limit')::integer,
    nullif(target_snapshot->>'last_provider_health_at','')::timestamptz,route_value,target_snapshot->>'domain_role',
    target_snapshot->>'custody_status',nullif(target_snapshot->>'domain_registered_at','')::timestamptz,
    (target_snapshot->>'human_history_verified')::boolean,target_snapshot->>'blocklist_status',
    target_snapshot->>'route_evidence_sha256',(target_snapshot->>'route_evidence_at')::timestamptz
  ) on conflict(organization_id,normalized_email) do update set
    domain=excluded.domain,sender_name=excluded.sender_name,provider=excluded.provider,domain_ready_at=excluded.domain_ready_at,
    auth_spf=excluded.auth_spf,auth_dkim=excluded.auth_dkim,auth_dmarc=excluded.auth_dmarc,auth_tls=excluded.auth_tls,
    health_status=excluded.health_status,kill_switch=excluded.kill_switch,credential_status=excluded.credential_status,
    warmup_started_at=excluded.warmup_started_at,warmup_minimum_days=excluded.warmup_minimum_days,warmup_status=excluded.warmup_status,
    sender_identity_verified=excluded.sender_identity_verified,gmail_seed_verified=excluded.gmail_seed_verified,
    outlook_seed_verified=excluded.outlook_seed_verified,yahoo_seed_verified=excluded.yahoo_seed_verified,
    reply_sync_verified=excluded.reply_sync_verified,provider_evidence_sha256=excluded.provider_evidence_sha256,
    provider_daily_limit=excluded.provider_daily_limit,last_provider_health_at=excluded.last_provider_health_at,
    eligibility_route=excluded.eligibility_route,domain_role=excluded.domain_role,custody_status=excluded.custody_status,
    domain_registered_at=excluded.domain_registered_at,human_history_verified=excluded.human_history_verified,
    blocklist_status=excluded.blocklist_status,route_evidence_sha256=excluded.route_evidence_sha256,
    route_evidence_at=excluded.route_evidence_at,updated_at=clock_timestamp()
  returning id into mailbox_id_value;
  result:=jsonb_build_object('status','APPLIED','mailbox_id',mailbox_id_value,'request_sha256',request_sha,
    'readiness',app.evaluate_hybrid_mailbox_as_system(target_organization_id,mailbox_id_value,clock_timestamp()));
  insert into public.hybrid_outbound_command_ledger values(default,target_organization_id,'MAILBOX_SNAPSHOT',target_idempotency_key,request_sha,mailbox_id_value,result,actor_id,default);
  return result;
end $$;

create or replace function public.record_hybrid_mailbox_observation(
  target_organization_id uuid,target_mailbox_id uuid,target_metrics jsonb,target_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare actor_id uuid:=auth.uid(); request_sha text; existing public.hybrid_outbound_command_ledger%rowtype;
  previous_observation public.hybrid_mailbox_observations%rowtype; observation_id uuid; result jsonb;
begin
  if not app.has_role(target_organization_id,array['ennco_admin'::public.user_role,'teckel_admin'::public.user_role,'teckel_operator'::public.user_role])
    then raise exception 'HYBRID_OBSERVATION_OPERATOR_AAL2_REQUIRED'; end if;
  if target_metrics is null or jsonb_typeof(target_metrics)<>'object' or target_idempotency_key!~'^[a-f0-9]{64}$'
    or coalesce(target_metrics->>'evidence_sha256','')!~'^[a-f0-9]{64}$'
    then raise exception 'HYBRID_OBSERVATION_INPUT_INVALID'; end if;
  request_sha:=encode(digest((jsonb_build_object('mailbox_id',target_mailbox_id,'metrics',target_metrics))::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':hybrid-observation:'||target_mailbox_id::text,0));
  select * into existing from public.hybrid_outbound_command_ledger where organization_id=target_organization_id and idempotency_key_sha256=target_idempotency_key;
  if found then
    if existing.command_type<>'RAMP_OBSERVATION' or existing.request_sha256<>request_sha then raise exception 'HYBRID_OBSERVATION_IDEMPOTENCY_DRIFT'; end if;
    return existing.result_json||jsonb_build_object('status','DUPLICATE');
  end if;
  select * into previous_observation from public.hybrid_mailbox_observations
  where organization_id=target_organization_id and mailbox_id=target_mailbox_id
  order by observed_at desc limit 1 for update;
  if previous_observation.id is not null and (
    (target_metrics->>'valid_deliveries')::integer<previous_observation.valid_deliveries
    or (target_metrics->>'attempted_deliveries')::integer<previous_observation.attempted_deliveries
    or (target_metrics->>'hard_bounces')::integer<previous_observation.hard_bounces
    or (target_metrics->>'spam_complaints')::integer<previous_observation.spam_complaints
    or (target_metrics->>'observed_at')::timestamptz<=previous_observation.observed_at
  ) then raise exception 'HYBRID_OBSERVATION_COUNTER_OR_TIME_REGRESSION'; end if;
  insert into public.hybrid_mailbox_observations(
    organization_id,mailbox_id,valid_deliveries,attempted_deliveries,hard_bounces,spam_complaints,delivery_rate,
    reply_sync_p95_seconds,positive_reply_sla_breaches,provider_reconciled,suppression_reconciled,
    identity_unambiguous,evidence_sha256,evidence_class,observed_at,idempotency_key_sha256,recorded_by
  ) values (
    target_organization_id,target_mailbox_id,(target_metrics->>'valid_deliveries')::integer,
    (target_metrics->>'attempted_deliveries')::integer,(target_metrics->>'hard_bounces')::integer,
    (target_metrics->>'spam_complaints')::integer,nullif(target_metrics->>'delivery_rate','')::numeric,
    nullif(target_metrics->>'reply_sync_p95_seconds','')::integer,(target_metrics->>'positive_reply_sla_breaches')::integer,
    (target_metrics->>'provider_reconciled')::boolean,(target_metrics->>'suppression_reconciled')::boolean,
    (target_metrics->>'identity_unambiguous')::boolean,target_metrics->>'evidence_sha256',
    (target_metrics->>'evidence_class')::public.evidence_class,(target_metrics->>'observed_at')::timestamptz,
    target_idempotency_key,actor_id
  ) returning id into observation_id;
  result:=jsonb_build_object('status','RECORDED','observation_id',observation_id,'request_sha256',request_sha,
    'readiness',app.evaluate_hybrid_mailbox_as_system(target_organization_id,target_mailbox_id,clock_timestamp()));
  insert into public.hybrid_outbound_command_ledger values(default,target_organization_id,'RAMP_OBSERVATION',target_idempotency_key,request_sha,observation_id,result,actor_id,default);
  return result;
end $$;

create or replace function public.create_hybrid_outbound_release(
  target_organization_id uuid,target_mailbox_id uuid,target_campaign_id uuid,target_lane text,
  target_manifest_sha256 text,target_suppression_sha256 text,target_copy_sha256 text,target_sequence_sha256 text,
  target_scheduled_for timestamptz,target_expires_at timestamptz,target_enrollment_ids uuid[],target_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare actor_id uuid:=auth.uid(); request_sha text; existing public.hybrid_outbound_command_ledger%rowtype;
  readiness jsonb; release_id_value uuid; enrollment_id_value uuid; enrollment_record public.campaign_enrollments%rowtype;
  account_record public.accounts%rowtype; contact_record public.contacts%rowtype; campaign_record public.campaigns%rowtype;
  result jsonb; cap integer; prior_accounts integer;
begin
  if not app.has_role(target_organization_id,array['ennco_admin'::public.user_role,'teckel_admin'::public.user_role])
    then raise exception 'HYBRID_RELEASE_ADMIN_AAL2_REQUIRED'; end if;
  if target_lane not in ('ACCELERATED_TIER1_CANARY','ISOLATED_MAILBOX_CANARY')
    or target_manifest_sha256!~'^[a-f0-9]{64}$' or target_suppression_sha256!~'^[a-f0-9]{64}$'
    or target_copy_sha256!~'^[a-f0-9]{64}$' or target_sequence_sha256!~'^[a-f0-9]{64}$'
    or target_idempotency_key!~'^[a-f0-9]{64}$' or cardinality(target_enrollment_ids) not between 1 and 20
    or cardinality(target_enrollment_ids)<>(select count(distinct value) from unnest(target_enrollment_ids) value)
    then raise exception 'HYBRID_RELEASE_INPUT_INVALID'; end if;
  request_sha:=encode(digest(jsonb_build_object('mailbox_id',target_mailbox_id,'campaign_id',target_campaign_id,
    'lane',target_lane,'manifest',target_manifest_sha256,'suppression',target_suppression_sha256,'copy',target_copy_sha256,
    'sequence',target_sequence_sha256,'scheduled_for',target_scheduled_for,'expires_at',target_expires_at,
    'enrollments',to_jsonb(target_enrollment_ids))::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':hybrid-release:'||target_mailbox_id::text,0));
  select * into existing from public.hybrid_outbound_command_ledger where organization_id=target_organization_id and idempotency_key_sha256=target_idempotency_key;
  if found then
    if existing.command_type<>'RELEASE_CREATE' or existing.request_sha256<>request_sha then raise exception 'HYBRID_RELEASE_IDEMPOTENCY_DRIFT'; end if;
    return existing.result_json||jsonb_build_object('status','DUPLICATE');
  end if;
  readiness:=app.evaluate_hybrid_mailbox_as_system(target_organization_id,target_mailbox_id,clock_timestamp());
  if readiness->>'state'<>'READY' or readiness->>'effective_release' not in ('READY_FOR_CANARY','SCALE_ALLOWED')
    then raise exception 'HYBRID_MAILBOX_NOT_READY'; end if;
  select * into campaign_record from public.campaigns
  where organization_id=target_organization_id and id=target_campaign_id;
  if not found or campaign_record.status not in ('APPROVED','ACTIVE')
    or campaign_record.manifest_sha256<>target_manifest_sha256
    or campaign_record.manifest_json#>>'{hybrid,copy_sha256}'<>target_copy_sha256
    or campaign_record.manifest_json#>>'{hybrid,sequence_sha256}'<>target_sequence_sha256
    then raise exception 'HYBRID_RELEASE_MANIFEST_DRIFT'; end if;
  if (readiness->>'route'='EXISTING_PRIMARY_GMAIL_RAMP' and target_lane<>'ACCELERATED_TIER1_CANARY')
    or (readiness->>'route'='NEW_ISOLATED_MAILBOX_WARMUP' and target_lane<>'ISOLATED_MAILBOX_CANARY')
    then raise exception 'HYBRID_RELEASE_ROUTE_LANE_DRIFT'; end if;
  cap:=(readiness->>'daily_cap')::integer;
  if cardinality(target_enrollment_ids)>cap then raise exception 'HYBRID_RELEASE_DAILY_CAP_EXCEEDED'; end if;
  if readiness->>'route'='NEW_ISOLATED_MAILBOX_WARMUP' and cardinality(target_enrollment_ids)>5
    then raise exception 'HYBRID_ISOLATED_CANARY_EXCEEDS_FIVE'; end if;
  select count(distinct hre.account_id) into prior_accounts
  from public.hybrid_outbound_release_enrollments hre join public.hybrid_outbound_releases hr
    on hr.organization_id=hre.organization_id and hr.id=hre.release_id
  join public.mailboxes m on m.organization_id=hr.organization_id and m.id=hr.mailbox_id
  where hr.organization_id=target_organization_id and m.eligibility_route='EXISTING_PRIMARY_GMAIL_RAMP';
  if readiness->>'route'='EXISTING_PRIMARY_GMAIL_RAMP' and prior_accounts+cardinality(target_enrollment_ids)>50
    then raise exception 'HYBRID_PRIMARY_ACCOUNT_LIMIT_EXCEEDED'; end if;

  foreach enrollment_id_value in array target_enrollment_ids loop
    select * into enrollment_record from public.campaign_enrollments
    where organization_id=target_organization_id and id=enrollment_id_value for update;
    if not found or enrollment_record.campaign_id<>target_campaign_id or enrollment_record.mailbox_id<>target_mailbox_id
      or enrollment_record.status not in ('PENDING','PAUSED') then raise exception 'HYBRID_RELEASE_ENROLLMENT_INVALID'; end if;
    if not exists(select 1 from public.sequence_versions sv where sv.organization_id=target_organization_id
      and sv.id=enrollment_record.sequence_version_id and sv.campaign_id=target_campaign_id
      and sv.content_sha256=target_sequence_sha256 and sv.approved_at is not null)
      then raise exception 'HYBRID_RELEASE_SEQUENCE_DRIFT'; end if;
    select * into account_record from public.accounts where organization_id=target_organization_id and id=enrollment_record.account_id;
    select * into contact_record from public.contacts where organization_id=target_organization_id and id=enrollment_record.contact_id;
    if account_record.tier<>1 or account_record.is_deleted or contact_record.is_deleted or not contact_record.verified
      or contact_record.verified_at is null or contact_record.verified_at<clock_timestamp()-interval '30 days'
      or app.is_suppressed(target_organization_id,account_record.id,contact_record.normalized_email,account_record.primary_domain)
      then raise exception 'HYBRID_RELEASE_RECIPIENT_NOT_ELIGIBLE'; end if;
  end loop;

  insert into public.hybrid_outbound_releases(
    organization_id,mailbox_id,campaign_id,lane,status,manifest_sha256,suppression_sha256,copy_sha256,sequence_sha256,
    route_evidence_sha256,recipient_count,account_count,daily_cap_snapshot,scheduled_for,expires_at,approved_by
  ) values (
    target_organization_id,target_mailbox_id,target_campaign_id,target_lane,'READY_FOR_CANARY',target_manifest_sha256,
    target_suppression_sha256,target_copy_sha256,target_sequence_sha256,
    (select route_evidence_sha256 from public.mailboxes where organization_id=target_organization_id and id=target_mailbox_id),
    cardinality(target_enrollment_ids),cardinality(target_enrollment_ids),cap,target_scheduled_for,target_expires_at,actor_id
  ) returning id into release_id_value;
  foreach enrollment_id_value in array target_enrollment_ids loop
    select * into enrollment_record from public.campaign_enrollments where organization_id=target_organization_id and id=enrollment_id_value;
    insert into public.hybrid_outbound_release_enrollments(organization_id,release_id,enrollment_id,account_id,contact_id)
    values(target_organization_id,release_id_value,enrollment_id_value,enrollment_record.account_id,enrollment_record.contact_id);
  end loop;
  result:=jsonb_build_object('status','READY_FOR_CANARY','release_id',release_id_value,'request_sha256',request_sha,
    'mailbox_id',target_mailbox_id,'recipient_count',cardinality(target_enrollment_ids),'daily_cap',cap);
  insert into public.hybrid_outbound_command_ledger values(default,target_organization_id,'RELEASE_CREATE',target_idempotency_key,request_sha,release_id_value,result,actor_id,default);
  insert into public.event_outbox(organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json)
  values(target_organization_id,'hybrid_outbound_release',release_id_value,'hybrid_outbound.release_ready',
    'hybrid-release-ready:'||release_id_value::text,jsonb_build_object('release_id',release_id_value,'mailbox_id',target_mailbox_id,'recipient_count',cardinality(target_enrollment_ids)))
  on conflict(organization_id,idempotency_key) do nothing;
  return result;
end $$;

create or replace function app.hybrid_release_enrollment_is_bound(
  target_organization_id uuid,target_enrollment_id uuid,target_mailbox_id uuid,target_evaluated_at timestamptz
)
returns boolean language sql stable security definer set search_path=public,app,pg_temp as $$
  select exists(
    select 1 from public.hybrid_outbound_release_enrollments hre
    join public.hybrid_outbound_releases hr on hr.organization_id=hre.organization_id and hr.id=hre.release_id
    where hre.organization_id=target_organization_id and hre.enrollment_id=target_enrollment_id
      and hr.mailbox_id=target_mailbox_id and hr.status in ('READY_FOR_CANARY','CANARY_ACTIVE','SCALE_ALLOWED')
      and hr.scheduled_for<=target_evaluated_at and hr.expires_at>target_evaluated_at
  )
$$;

create or replace function app.enforce_hybrid_outbound_release()
returns trigger language plpgsql security definer set search_path=public,app,pg_temp as $$
declare readiness jsonb; release_record public.hybrid_outbound_releases%rowtype; enrollment_record public.campaign_enrollments%rowtype;
  account_record public.accounts%rowtype; contact_record public.contacts%rowtype; controls_record public.runtime_controls%rowtype;
  campaign_record public.campaigns%rowtype; expected_envelope jsonb; sent_today integer:=0; word_count integer:=0;
begin
  if new.direction<>'OUTBOUND' or new.status in ('DRAFT','DRY_RUN') then return new; end if;
  if new.enrollment_id is null or new.mailbox_id is null then raise exception 'HYBRID_RELEASE_REFERENCE_REQUIRED'; end if;
  select hr.* into release_record from public.hybrid_outbound_releases hr
  join public.hybrid_outbound_release_enrollments hre on hre.organization_id=hr.organization_id and hre.release_id=hr.id
  where hr.organization_id=new.organization_id and hre.enrollment_id=new.enrollment_id and hr.mailbox_id=new.mailbox_id
    and hr.status in ('READY_FOR_CANARY','CANARY_ACTIVE','SCALE_ALLOWED')
    and hr.scheduled_for<=clock_timestamp() and hr.expires_at>clock_timestamp()
  order by hr.approved_at desc limit 1;
  if not found then raise exception 'HYBRID_RELEASE_NOT_BOUND'; end if;
  if new.status in ('SENT','DELIVERED') then return new; end if;
  readiness:=app.evaluate_hybrid_mailbox_as_system(new.organization_id,new.mailbox_id,clock_timestamp());
  if readiness->>'state'<>'READY' then raise exception 'HYBRID_MAILBOX_NOT_READY'; end if;
  select * into controls_record from public.runtime_controls where organization_id=new.organization_id;
  if not found or controls_record.global_kill_switch or not controls_record.external_send_allowed
    then raise exception 'HYBRID_RUNTIME_HOLD'; end if;
  select * into enrollment_record from public.campaign_enrollments where organization_id=new.organization_id and id=new.enrollment_id;
  select * into account_record from public.accounts where organization_id=new.organization_id and id=enrollment_record.account_id;
  select * into contact_record from public.contacts where organization_id=new.organization_id and id=enrollment_record.contact_id;
  if enrollment_record.status<>'ACTIVE' then raise exception 'HYBRID_ENROLLMENT_NOT_ACTIVE'; end if;
  if account_record.tier<>1 or not contact_record.verified or contact_record.verified_at<clock_timestamp()-interval '30 days'
    or app.is_suppressed(new.organization_id,account_record.id,contact_record.normalized_email,account_record.primary_domain)
    then raise exception 'HYBRID_RECIPIENT_NOT_ELIGIBLE'; end if;
  if new.touch_number is null or new.touch_number>3 then raise exception 'HYBRID_TOUCH_LIMIT_EXCEEDED'; end if;
  if new.normalized_from<>(select normalized_email from public.mailboxes where organization_id=new.organization_id and id=new.mailbox_id)
    then raise exception 'HYBRID_FROM_IDENTITY_DRIFT'; end if;
  if new.normalized_to<>contact_record.normalized_email then raise exception 'HYBRID_TO_IDENTITY_DRIFT'; end if;
  word_count:=cardinality(regexp_split_to_array(btrim(coalesce(new.body_text,'')),'\s+'));
  if word_count>100 or coalesce(new.body_text,'')~'<[^>]+>' then raise exception 'HYBRID_PLAIN_TEXT_CONTRACT_INVALID'; end if;
  if new.touch_number=1 and (coalesce(new.body_text,'')~*'(https?://|www\.|\.pdf\b)' or coalesce(new.subject,'')~*'(https?://|www\.|\.pdf\b)')
    then raise exception 'HYBRID_FIRST_TOUCH_LINK_OR_PDF_FORBIDDEN'; end if;
  select * into campaign_record from public.campaigns where organization_id=new.organization_id and id=enrollment_record.campaign_id;
  select envelope into expected_envelope
  from jsonb_array_elements(coalesce(campaign_record.manifest_json#>'{hybrid,envelopes}','[]'::jsonb)) envelope
  where envelope->>'enrollment_id'=new.enrollment_id::text
    and (envelope->>'touch_number')::integer=new.touch_number
  limit 1;
  if expected_envelope is null
    or expected_envelope->>'normalized_to'<>new.normalized_to
    or expected_envelope->>'subject_sha256'<>encode(digest(coalesce(new.subject,''),'sha256'),'hex')
    or expected_envelope->>'body_sha256'<>encode(digest(coalesce(new.body_text,''),'sha256'),'hex')
    then raise exception 'HYBRID_RENDERED_MESSAGE_MANIFEST_DRIFT'; end if;
  select count(*) into sent_today from public.messages
  where organization_id=new.organization_id and mailbox_id=new.mailbox_id and direction='OUTBOUND'
    and status in ('QUEUED','SENDING','SENT','DELIVERED')
    and (created_at at time zone 'America/Mexico_City')::date=(clock_timestamp() at time zone 'America/Mexico_City')::date;
  if new.status='QUEUED' and sent_today>=release_record.daily_cap_snapshot then raise exception 'HYBRID_DAILY_CAP_EXCEEDED'; end if;
  if release_record.status='READY_FOR_CANARY' and new.status='QUEUED' then
    update public.hybrid_outbound_releases set status='CANARY_ACTIVE',updated_at=clock_timestamp() where id=release_record.id;
  end if;
  return new;
end $$;

create or replace function app.enforce_scaled_outbound_release()
returns trigger language plpgsql security definer set search_path=public,app,pg_temp as $$
declare first_batch public.first_send_batches%rowtype; rollout_wave public.rollout_waves%rowtype;
  controls_record public.runtime_controls%rowtype; source_ready boolean:=false;
begin
  perform pg_advisory_xact_lock(hashtextextended('first-send-org:'||new.organization_id::text,0));
  if new.direction<>'OUTBOUND' or new.status not in ('QUEUED','SENDING','SENT','DELIVERED') then return new; end if;
  if new.enrollment_id is null or new.touch_number is null then raise exception 'OUTBOUND_RELEASE_REFERENCE_REQUIRED'; end if;
  if new.mailbox_id is not null and app.hybrid_release_enrollment_is_bound(new.organization_id,new.enrollment_id,new.mailbox_id,clock_timestamp()) then
    if new.status in ('SENT','DELIVERED') and (tg_op='INSERT' or old.direction<>'OUTBOUND'
      or (new.status='SENT' and old.status<>'SENDING') or (new.status='DELIVERED' and old.status<>'SENT'))
      then raise exception 'OUTBOUND_STATUS_TRANSITION_INVALID'; end if;
    if new.status='SENDING' and (tg_op='INSERT' or old.status<>'QUEUED') then raise exception 'OUTBOUND_STATUS_TRANSITION_INVALID'; end if;
    return new;
  end if;
  select b.* into first_batch from public.first_send_batches b join public.first_send_batch_enrollments be
    on be.batch_id=b.id and be.organization_id=b.organization_id where be.organization_id=new.organization_id and be.enrollment_id=new.enrollment_id
    order by b.approved_at desc nulls last limit 1;
  select w.* into rollout_wave from public.rollout_waves w join public.rollout_wave_enrollments we
    on we.wave_id=w.id and we.organization_id=w.organization_id where we.organization_id=new.organization_id and we.enrollment_id=new.enrollment_id
    order by w.wave_number desc limit 1;
  if new.status in ('SENT','DELIVERED') then
    if tg_op='INSERT' or old.direction<>'OUTBOUND' or (new.status='SENT' and old.status<>'SENDING') or (new.status='DELIVERED' and old.status<>'SENT')
      then raise exception 'OUTBOUND_STATUS_TRANSITION_INVALID'; end if;
    if not ((first_batch.id is not null and first_batch.status='RELEASED') or (rollout_wave.id is not null and rollout_wave.status in ('RELEASED','PASSED','EXTENDED')))
      then raise exception 'OUTBOUND_SOURCE_NOT_RELEASED'; end if;
    return new;
  end if;
  if tg_op='UPDATE' and old.status='DRY_RUN' then raise exception 'OUTBOUND_DRY_RUN_IMMUTABLE'; end if;
  if new.status='SENDING' and (tg_op='INSERT' or old.status<>'QUEUED') then raise exception 'OUTBOUND_STATUS_TRANSITION_INVALID'; end if;
  if new.touch_number=1 then
    if first_batch.id is not null and first_batch.status in ('READY','RELEASED') then
      source_ready:=app.assess_first_send_batch(first_batch.id)='PASS' and app.is_first_send_window(first_batch.scheduled_for,now());
    elsif rollout_wave.id is not null and rollout_wave.status in ('READY','RELEASED') then
      source_ready:=app.assess_rollout_wave(rollout_wave.id)='PASS' and app.is_first_send_window(rollout_wave.scheduled_for,now());
    end if;
  else source_ready:=app.followup_release_is_current(new.organization_id,new.enrollment_id,new.touch_number,now()); end if;
  if source_ready is not true then raise exception 'OUTBOUND_RELEASE_GATE_NOT_PASS'; end if;
  select * into controls_record from public.runtime_controls where organization_id=new.organization_id;
  if not found or controls_record.global_kill_switch or not controls_record.external_send_allowed then raise exception 'OUTBOUND_RUNTIME_HOLD'; end if;
  if new.touch_number=1 and new.status='QUEUED' then
    if first_batch.id is not null and first_batch.status='READY' then update public.first_send_batches set status='RELEASED',released_at=now() where id=first_batch.id;
    elsif rollout_wave.id is not null and rollout_wave.status='READY' then update public.rollout_waves set status='RELEASED',released_at=now() where id=rollout_wave.id; end if;
  end if;
  return new;
end $$;

drop trigger if exists messages_apollo_warmup_42_days on public.messages;
drop trigger if exists messages_aaa_m024_provider_infrastructure on public.messages;
drop trigger if exists messages_aaa_m029_hybrid_outbound on public.messages;
create trigger messages_aaa_m029_hybrid_outbound before insert or update of direction,status,mailbox_id,enrollment_id,touch_number on public.messages
for each row execute function app.enforce_hybrid_outbound_release();

alter table public.hybrid_mailbox_observations enable row level security;
alter table public.hybrid_mailbox_observations force row level security;
alter table public.hybrid_outbound_releases enable row level security;
alter table public.hybrid_outbound_releases force row level security;
alter table public.hybrid_outbound_release_enrollments enable row level security;
alter table public.hybrid_outbound_release_enrollments force row level security;
alter table public.hybrid_outbound_command_ledger enable row level security;
alter table public.hybrid_outbound_command_ledger force row level security;

drop policy if exists hybrid_mailbox_observations_member_read on public.hybrid_mailbox_observations;
create policy hybrid_mailbox_observations_member_read on public.hybrid_mailbox_observations for select to authenticated using(app.is_member(organization_id));
drop policy if exists hybrid_outbound_releases_member_read on public.hybrid_outbound_releases;
create policy hybrid_outbound_releases_member_read on public.hybrid_outbound_releases for select to authenticated using(app.is_member(organization_id));
drop policy if exists hybrid_release_enrollments_member_read on public.hybrid_outbound_release_enrollments;
create policy hybrid_release_enrollments_member_read on public.hybrid_outbound_release_enrollments for select to authenticated using(app.is_member(organization_id));
drop policy if exists hybrid_command_ledger_admin_read on public.hybrid_outbound_command_ledger;
create policy hybrid_command_ledger_admin_read on public.hybrid_outbound_command_ledger for select to authenticated
using(app.has_role(organization_id,array['ennco_admin'::public.user_role,'teckel_admin'::public.user_role]));

revoke all on table public.hybrid_mailbox_observations,public.hybrid_outbound_releases,
  public.hybrid_outbound_release_enrollments,public.hybrid_outbound_command_ledger from public,anon,authenticated,service_role;
grant select on table public.hybrid_mailbox_observations,public.hybrid_outbound_releases,
  public.hybrid_outbound_release_enrollments,public.hybrid_outbound_command_ledger to authenticated;

revoke all on function app.hybrid_mailbox_address_is_allowed(text,text) from public,anon,authenticated,service_role;
revoke all on function app.evaluate_hybrid_mailbox_as_system(uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function app.evaluate_hybrid_outbound_as_system(uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function app.hybrid_release_enrollment_is_bound(uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function app.enforce_hybrid_outbound_release() from public,anon,authenticated,service_role;
revoke all on function public.evaluate_hybrid_outbound_readiness(uuid,timestamptz) from public,anon,service_role;
grant execute on function public.evaluate_hybrid_outbound_readiness(uuid,timestamptz) to authenticated;
revoke all on function public.apply_hybrid_mailbox_snapshot(uuid,jsonb,text) from public,anon,service_role;
revoke all on function public.record_hybrid_mailbox_observation(uuid,uuid,jsonb,text) from public,anon,service_role;
revoke all on function public.create_hybrid_outbound_release(uuid,uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,uuid[],text) from public,anon,service_role;
grant execute on function public.apply_hybrid_mailbox_snapshot(uuid,jsonb,text) to authenticated;
grant execute on function public.record_hybrid_mailbox_observation(uuid,uuid,jsonb,text) to authenticated;
grant execute on function public.create_hybrid_outbound_release(uuid,uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,uuid[],text) to authenticated;

commit;
