begin;

create extension if not exists pgcrypto;
create schema if not exists app;

create type public.user_role as enum ('ennco_admin', 'ennco_operator', 'teckel_admin', 'teckel_operator', 'auditor_readonly');
create type public.evidence_class as enum ('synthetic_demo', 'live');
create type public.delivery_status as enum ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'EVIDENCE_READY', 'ACCEPTED', 'REJECTED');
create type public.gate_decision as enum ('PASS', 'EXTEND', 'KILL');
create type public.source_confidence as enum ('UNVERIFIED', 'LOW', 'MEDIUM', 'HIGH', 'VERIFIED');
create type public.suppression_kind as enum ('ANNEX_A', 'CURRENT_CLIENT', 'UNSUBSCRIBE', 'HARD_BOUNCE', 'DNC', 'MANUAL');
create type public.campaign_status as enum ('DRAFT', 'REVIEW', 'APPROVED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'KILLED');
create type public.enrollment_status as enum ('PENDING', 'ACTIVE', 'PAUSED', 'REPLIED', 'BOUNCED', 'UNSUBSCRIBED', 'COMPLETED', 'SUPPRESSED');
create type public.message_direction as enum ('OUTBOUND', 'INBOUND');
create type public.message_status as enum ('DRAFT', 'DRY_RUN', 'QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'BOUNCED', 'QUARANTINED');
create type public.lead_status as enum ('CAPTURED', 'PREQUALIFIED', 'QUALIFIED', 'DISQUALIFIED', 'DNC');
create type public.commercial_stage as enum ('PROSPECTING', 'CONVERSATION', 'MEETING_CONFIRMED', 'DISCOVERY_HELD', 'QUALIFIED', 'TECHNICAL_VISIT', 'PROPOSAL', 'DECISION', 'CLOSED_WON', 'CLOSED_LOST');
create type public.incident_severity as enum ('P0', 'P1', 'P2', 'P3');
create type public.notification_status as enum ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'DEAD_LETTER');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug = lower(slug)),
  legal_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_users (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  role public.user_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.runtime_controls (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  global_kill_switch boolean not null default true,
  external_send_allowed boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_name text not null,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_row_count integer not null check (source_row_count >= 0),
  accepted_row_count integer not null default 0 check (accepted_row_count >= 0),
  quarantined_row_count integer not null default 0 check (quarantined_row_count >= 0),
  imported_by uuid,
  imported_at timestamptz not null default now(),
  unique (organization_id, source_sha256)
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  legal_name text not null,
  normalized_name text not null,
  primary_domain text,
  city text,
  state text,
  industrial_park text,
  sector text,
  tier smallint check (tier between 1 and 3),
  evidence_class public.evidence_class not null default 'live',
  source_confidence public.source_confidence not null default 'UNVERIFIED',
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, normalized_name)
);

create unique index accounts_org_domain_unique on public.accounts (organization_id, lower(primary_domain)) where primary_domain is not null and not is_deleted;

create table public.account_aliases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, normalized_alias)
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  full_name text not null,
  role_title text not null,
  normalized_email text not null check (normalized_email = lower(normalized_email)),
  phone_e164 text,
  verified boolean not null default false,
  verified_at timestamptz,
  source_confidence public.source_confidence not null default 'UNVERIFIED',
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((verified and verified_at is not null) or (not verified and verified_at is null)),
  unique (organization_id, normalized_email)
);

create table public.source_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subject_type text not null,
  subject_id uuid not null,
  field_name text not null,
  source_url text,
  source_name text not null,
  observed_at timestamptz not null,
  confidence public.source_confidence not null,
  value_json jsonb not null,
  checksum text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index source_evidence_subject_idx on public.source_evidence (organization_id, subject_type, subject_id);

create table public.suppression_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind public.suppression_kind not null,
  account_id uuid references public.accounts(id) on delete cascade,
  normalized_email text,
  normalized_domain text,
  source_batch_id uuid references public.import_batches(id),
  reason text not null,
  effective_at timestamptz not null default now(),
  expires_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (num_nonnulls(account_id, normalized_email, normalized_domain) >= 1),
  check (normalized_email is null or normalized_email = lower(normalized_email)),
  check (normalized_domain is null or normalized_domain = lower(normalized_domain))
);

create unique index suppression_account_unique on public.suppression_entries (organization_id, kind, account_id) where account_id is not null and expires_at is null;
create unique index suppression_email_unique on public.suppression_entries (organization_id, kind, normalized_email) where normalized_email is not null and expires_at is null;
create unique index suppression_domain_unique on public.suppression_entries (organization_id, kind, normalized_domain) where normalized_domain is not null and expires_at is null;

create table public.prequote_models (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version text not null,
  status text not null check (status in ('DRAFT_REVIEW_REQUIRED', 'APPROVED', 'EXPIRED')),
  assumptions jsonb not null,
  source_manifest jsonb not null,
  valid_from timestamptz,
  valid_until timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, version),
  check ((status = 'APPROVED') = (approved_by is not null and approved_at is not null))
);

create table public.prequotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  model_id uuid not null references public.prequote_models(id),
  folio text not null,
  need_type text not null,
  account_name text not null,
  contact_name text not null,
  contact_role text not null,
  normalized_email text not null,
  phone_e164 text,
  monthly_spend_mxn numeric(16,2) not null check (monthly_spend_mxn >= 0),
  tariff text not null,
  installed_capacity_kwp numeric(14,3) not null default 0 check (installed_capacity_kwp >= 0),
  coverage_target_pct numeric(5,2) not null check (coverage_target_pct between 30 and 100),
  city text not null,
  state text not null,
  zone text not null,
  result_json jsonb not null,
  consented_at timestamptz not null,
  evidence_class public.evidence_class not null,
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, folio),
  unique (organization_id, correlation_id)
);

create table public.prequote_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  prequote_id uuid not null references public.prequotes(id) on delete cascade,
  storage_path text not null,
  media_type text not null check (media_type in ('application/pdf', 'image/jpeg', 'image/png')),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  retention_until timestamptz not null,
  created_at timestamptz not null default now(),
  unique (organization_id, storage_path)
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  status public.campaign_status not null default 'DRAFT',
  manifest_json jsonb not null,
  manifest_sha256 text not null check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  suppression_snapshot_at timestamptz,
  shadow_canary_decision public.gate_decision,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    status not in ('APPROVED', 'ACTIVE', 'COMPLETED')
    or (approved_by is not null and approved_at is not null)
  ),
  check (status <> 'ACTIVE' or shadow_canary_decision = 'PASS'),
  unique (organization_id, manifest_sha256)
);

create table public.sequence_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  version integer not null check (version > 0),
  sender_name text not null,
  sender_title text not null,
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, version)
);

create table public.sequence_touches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sequence_version_id uuid not null references public.sequence_versions(id) on delete cascade,
  touch_number smallint not null check (touch_number between 1 and 8),
  day_offset smallint not null check (day_offset between 0 and 365),
  subject_template text not null,
  body_template text not null,
  created_at timestamptz not null default now(),
  unique (sequence_version_id, touch_number),
  unique (sequence_version_id, day_offset)
);

create table public.mailboxes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  normalized_email text not null,
  domain text not null,
  sender_name text not null,
  provider text not null default 'gmail',
  encrypted_refresh_token text,
  domain_ready_at timestamptz,
  auth_spf boolean not null default false,
  auth_dkim boolean not null default false,
  auth_dmarc boolean not null default false,
  auth_tls boolean not null default false,
  health_status text not null default 'HOLD' check (health_status in ('HOLD', 'HEALTHY', 'DEGRADED', 'KILLED')),
  kill_switch boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (normalized_email = lower(normalized_email)),
  check (domain = lower(domain)),
  unique (organization_id, normalized_email)
);

create table public.campaign_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  sequence_version_id uuid not null references public.sequence_versions(id),
  account_id uuid not null references public.accounts(id),
  contact_id uuid not null references public.contacts(id),
  mailbox_id uuid not null references public.mailboxes(id),
  status public.enrollment_status not null default 'PENDING',
  next_touch_number smallint not null default 1 check (next_touch_number between 1 and 8),
  next_touch_at timestamptz,
  stopped_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index one_active_enrollment_per_contact on public.campaign_enrollments (organization_id, contact_id)
where status in ('PENDING', 'ACTIVE', 'PAUSED');

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  enrollment_id uuid references public.campaign_enrollments(id),
  mailbox_id uuid references public.mailboxes(id),
  contact_id uuid references public.contacts(id),
  direction public.message_direction not null,
  status public.message_status not null,
  touch_number smallint check (touch_number between 1 and 8),
  normalized_to text,
  normalized_from text,
  subject text,
  body_text text,
  idempotency_key text not null,
  provider_message_id text,
  correlation_id uuid not null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (normalized_to is null or normalized_to = lower(normalized_to)),
  check (normalized_from is null or normalized_from = lower(normalized_from)),
  unique (organization_id, idempotency_key),
  unique (organization_id, provider_message_id)
);

create table public.provider_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source text not null,
  source_record_type text not null,
  external_event_id text not null,
  message_id uuid references public.messages(id),
  payload_json jsonb not null,
  observed_at timestamptz not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, source, source_record_type, external_event_id)
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid references public.accounts(id),
  contact_id uuid references public.contacts(id),
  prequote_id uuid references public.prequotes(id),
  status public.lead_status not null default 'CAPTURED',
  contractual_qualified boolean not null default false,
  qualification_reason text,
  evidence_class public.evidence_class not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.qualification_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  industrial_over_100_kwp boolean,
  outside_annex_a boolean,
  verified_target_role boolean,
  explicit_interest boolean,
  monthly_spend_mxn numeric(16,2),
  evidence_record_ids uuid[] not null default '{}',
  evaluated_by uuid,
  evaluated_at timestamptz not null default now(),
  unique (lead_id)
);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null references public.accounts(id),
  lead_id uuid references public.leads(id),
  stage public.commercial_stage not null default 'PROSPECTING',
  economic_buyer boolean not null default false,
  active_pain boolean not null default false,
  business_impact boolean not null default false,
  timing_under_90_days boolean not null default false,
  value_mxn numeric(16,2),
  next_action text,
  next_action_at timestamptz,
  loss_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  scheduled_at timestamptz not null,
  held_at timestamptz,
  attendance_verified boolean not null default false,
  outcome_notes text,
  created_at timestamptz not null default now()
);

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  version text not null,
  value_mxn numeric(16,2) not null check (value_mxn > 0),
  delivered_at timestamptz,
  evidence_artifact_id uuid,
  created_at timestamptz not null default now(),
  unique (opportunity_id, version)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  amount_mxn numeric(16,2) not null check (amount_mxn > 0),
  paid_at timestamptz not null,
  is_first_payment boolean not null default false,
  evidence_record_id uuid not null,
  created_at timestamptz not null default now()
);

create table public.attribution_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null references public.accounts(id),
  contact_id uuid references public.contacts(id),
  first_contact_message_id uuid not null references public.messages(id),
  first_contact_at timestamptz not null,
  attribution_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (organization_id, account_id),
  check (attribution_expires_at = first_contact_at + interval '12 months')
);

create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id),
  payment_id uuid not null references public.payments(id),
  attribution_event_id uuid not null references public.attribution_events(id),
  commission_rate numeric(6,5) not null default 0.02 check (commission_rate between 0 and 1),
  commission_mxn numeric(16,2) not null check (commission_mxn >= 0),
  status text not null check (status in ('PENDING', 'EARNED', 'PAID', 'DISPUTED')),
  created_at timestamptz not null default now(),
  unique (payment_id)
);

create table public.roadmap_milestones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  owner_role text not null,
  status public.delivery_status not null default 'NOT_STARTED',
  due_date date not null,
  acceptance_criteria text not null,
  blocker text,
  next_action text not null,
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.acceptance_gates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  milestone_id uuid not null references public.roadmap_milestones(id) on delete cascade,
  decision public.gate_decision,
  decided_by uuid,
  decided_at timestamptz,
  rationale text,
  created_at timestamptz not null default now(),
  check (
    (decision is null and decided_by is null and decided_at is null)
    or (decision is not null and decided_by is not null and decided_at is not null)
  )
);

create table public.evidence_artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  milestone_id uuid references public.roadmap_milestones(id),
  kind text not null,
  location text not null,
  sha256 text,
  evidence_class public.evidence_class not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subject_type text not null,
  subject_id uuid not null,
  subject_sha256 text not null,
  decision text not null check (decision in ('APPROVED', 'REJECTED')),
  decided_by uuid not null,
  rationale text,
  decided_at timestamptz not null default now()
);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  severity public.incident_severity not null,
  title text not null,
  status text not null check (status in ('OPEN', 'ACKNOWLEDGED', 'MITIGATED', 'RESOLVED')),
  correlation_id uuid,
  opened_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  owner_user_id uuid,
  root_cause text,
  resolution text
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid references public.accounts(id),
  contact_id uuid references public.contacts(id),
  task_type text not null,
  normalized_objective text not null,
  owner_user_id uuid,
  due_at timestamptz not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'DONE', 'CANCELLED')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index open_task_identity_unique on public.tasks (
  organization_id,
  coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(contact_id, '00000000-0000-0000-0000-000000000000'::uuid),
  task_type,
  normalized_objective
) where status = 'OPEN';

create table public.event_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  idempotency_key text not null,
  payload_json jsonb not null,
  status public.notification_status not null default 'PENDING',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  check (status <> 'PROCESSING' or locked_at is not null),
  check ((status = 'DELIVERED') = (delivered_at is not null)),
  unique (organization_id, idempotency_key)
);

create index event_outbox_pending_idx on public.event_outbox (next_attempt_at)
where status in ('PENDING', 'FAILED');

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  outbox_event_id uuid not null references public.event_outbox(id) on delete cascade,
  channel text not null,
  destination_hash text not null,
  status public.notification_status not null default 'PENDING',
  provider_id text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique (outbox_event_id, channel, destination_hash)
);

create table public.dead_letters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_table text not null,
  source_id uuid not null,
  reason text not null,
  payload_json jsonb not null,
  retry_after timestamptz,
  resolved_at timestamptz,
  resolution text,
  created_at timestamptz not null default now(),
  unique (source_table, source_id)
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  actor_user_id uuid,
  action text not null,
  record_type text not null,
  record_id uuid,
  correlation_id uuid,
  old_data jsonb,
  new_data jsonb,
  occurred_at timestamptz not null default now()
);

create index audit_log_lookup_idx on public.audit_log (organization_id, record_type, record_id, occurred_at desc);

create or replace function app.is_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_users ou
    where ou.organization_id = target_organization_id
      and ou.user_id = auth.uid()
      and ou.active
  );
$$;

create or replace function app.has_role(target_organization_id uuid, allowed_roles public.user_role[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_users ou
    where ou.organization_id = target_organization_id
      and ou.user_id = auth.uid()
      and ou.active
      and ou.role = any(allowed_roles)
  );
$$;

create or replace function app.is_suppressed(
  target_organization_id uuid,
  target_account_id uuid,
  target_email text,
  target_domain text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.suppression_entries se
    where se.organization_id = target_organization_id
      and (se.expires_at is null or se.expires_at > now())
      and (
        se.account_id = target_account_id
        or se.normalized_email = lower(target_email)
        or se.normalized_domain = lower(target_domain)
        or se.normalized_domain = lower(split_part(target_email, '@', 2))
      )
  );
$$;

create or replace function app.enqueue_outbound_message(
  target_organization_id uuid,
  target_enrollment_id uuid,
  target_touch_number integer,
  target_subject text,
  target_body_text text,
  target_idempotency_key text,
  target_correlation_id uuid,
  dry_run boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  enrollment_record public.campaign_enrollments%rowtype;
  contact_record public.contacts%rowtype;
  account_record public.accounts%rowtype;
  campaign_record public.campaigns%rowtype;
  sequence_record public.sequence_versions%rowtype;
  mailbox_record public.mailboxes%rowtype;
  controls_record public.runtime_controls%rowtype;
  existing_message public.messages%rowtype;
  created_message_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text || ':' || target_enrollment_id::text, 0));

  select * into enrollment_record
  from public.campaign_enrollments
  where id = target_enrollment_id and organization_id = target_organization_id
  for update;
  if not found then raise exception 'ENROLLMENT_NOT_FOUND'; end if;

  if enrollment_record.status not in ('PENDING', 'ACTIVE') then
    raise exception 'ENROLLMENT_NOT_SENDABLE';
  end if;

  if target_touch_number is null or target_touch_number not between 1 and 8 then
    raise exception 'INVALID_TOUCH_NUMBER';
  end if;

  select * into contact_record
  from public.contacts
  where id = enrollment_record.contact_id and organization_id = target_organization_id;
  if not found then raise exception 'CONTACT_NOT_FOUND_OR_TENANT_MISMATCH'; end if;

  select * into account_record
  from public.accounts
  where id = enrollment_record.account_id and organization_id = target_organization_id;
  if not found then raise exception 'ACCOUNT_NOT_FOUND_OR_TENANT_MISMATCH'; end if;

  select * into campaign_record
  from public.campaigns
  where id = enrollment_record.campaign_id and organization_id = target_organization_id
  for share;
  if not found then raise exception 'CAMPAIGN_NOT_FOUND_OR_TENANT_MISMATCH'; end if;

  select * into sequence_record
  from public.sequence_versions
  where id = enrollment_record.sequence_version_id
    and campaign_id = enrollment_record.campaign_id
    and organization_id = target_organization_id;
  if not found then raise exception 'SEQUENCE_NOT_FOUND_OR_TENANT_MISMATCH'; end if;

  if not exists (
    select 1
    from public.sequence_touches st
    where st.sequence_version_id = sequence_record.id
      and st.organization_id = target_organization_id
      and st.touch_number = target_touch_number
  ) then
    raise exception 'SEQUENCE_TOUCH_NOT_FOUND';
  end if;

  select * into mailbox_record
  from public.mailboxes
  where id = enrollment_record.mailbox_id and organization_id = target_organization_id
  for share;
  if not found then raise exception 'MAILBOX_NOT_FOUND_OR_TENANT_MISMATCH'; end if;

  if app.is_suppressed(target_organization_id, account_record.id, contact_record.normalized_email, account_record.primary_domain) then
    update public.campaign_enrollments set status = 'SUPPRESSED', stopped_reason = 'SUPPRESSION_MATCH', updated_at = now() where id = enrollment_record.id;
    insert into public.event_outbox (
      organization_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload_json
    ) values (
      target_organization_id,
      'enrollment',
      enrollment_record.id,
      'enrollment.suppressed',
      'suppression:' || enrollment_record.id::text || ':' || target_idempotency_key,
      jsonb_build_object(
        'enrollment_id', enrollment_record.id,
        'correlation_id', target_correlation_id,
        'reason', 'SUPPRESSION_MATCH'
      )
    ) on conflict (organization_id, idempotency_key) do nothing;
    return null;
  end if;

  if not dry_run then
    select * into controls_record
    from public.runtime_controls
    where organization_id = target_organization_id
    for share;
    if not found then raise exception 'RUNTIME_CONTROLS_MISSING'; end if;

    if controls_record.global_kill_switch or not controls_record.external_send_allowed then raise exception 'GLOBAL_SEND_HOLD'; end if;
    if mailbox_record.kill_switch or mailbox_record.health_status <> 'HEALTHY' then raise exception 'MAILBOX_HOLD'; end if;
    if not (mailbox_record.auth_spf and mailbox_record.auth_dkim and mailbox_record.auth_dmarc and mailbox_record.auth_tls) then raise exception 'MAILBOX_AUTH_INCOMPLETE'; end if;
    if mailbox_record.domain_ready_at is null or mailbox_record.domain_ready_at > now() - interval '35 days' then raise exception 'DOMAIN_NOT_READY'; end if;
    if campaign_record.status <> 'ACTIVE' or campaign_record.shadow_canary_decision <> 'PASS' then raise exception 'CAMPAIGN_NOT_RELEASED'; end if;
    if campaign_record.approved_at is null
      or campaign_record.suppression_snapshot_at is null
      or campaign_record.suppression_snapshot_at < now() - interval '24 hours'
    then raise exception 'APPROVAL_OR_SUPPRESSION_STALE'; end if;
    if sequence_record.approved_by is null or sequence_record.approved_at is null then raise exception 'SEQUENCE_NOT_APPROVED'; end if;
    if not contact_record.verified or contact_record.verified_at is null then raise exception 'CONTACT_NOT_VERIFIED'; end if;
    if enrollment_record.status <> 'ACTIVE' then raise exception 'ENROLLMENT_NOT_ACTIVE'; end if;
    if enrollment_record.next_touch_number <> target_touch_number then raise exception 'TOUCH_OUT_OF_SEQUENCE'; end if;
  end if;

  insert into public.messages (
    organization_id, enrollment_id, mailbox_id, contact_id, direction, status, touch_number,
    normalized_to, normalized_from, subject, body_text, idempotency_key, correlation_id
  ) values (
    target_organization_id, enrollment_record.id, mailbox_record.id, contact_record.id, 'OUTBOUND',
    case when dry_run then 'DRY_RUN'::public.message_status else 'QUEUED'::public.message_status end,
    target_touch_number, contact_record.normalized_email, mailbox_record.normalized_email,
    target_subject, target_body_text, target_idempotency_key, target_correlation_id
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning id into created_message_id;

  if created_message_id is null then
    select * into existing_message
    from public.messages
    where organization_id = target_organization_id
      and idempotency_key = target_idempotency_key;

    if not found then raise exception 'IDEMPOTENCY_LOOKUP_FAILED'; end if;
    if existing_message.enrollment_id is distinct from enrollment_record.id
      or existing_message.touch_number is distinct from target_touch_number
      or existing_message.subject is distinct from target_subject
      or existing_message.body_text is distinct from target_body_text
      or existing_message.correlation_id is distinct from target_correlation_id
      or (dry_run and existing_message.status <> 'DRY_RUN')
      or (not dry_run and existing_message.status = 'DRY_RUN')
    then
      raise exception 'IDEMPOTENCY_KEY_REUSE_MISMATCH';
    end if;

    return existing_message.id;
  end if;

  insert into public.event_outbox (
    organization_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload_json
  ) values (
    target_organization_id,
    'message',
    created_message_id,
    case when dry_run then 'message.dry_run_created' else 'message.queued' end,
    'message:' || created_message_id::text || ':' || case when dry_run then 'dry_run_created' else 'queued' end,
    jsonb_build_object('message_id', created_message_id, 'correlation_id', target_correlation_id)
  ) on conflict (organization_id, idempotency_key) do nothing;

  return created_message_id;
end;
$$;

create or replace function app.claim_outbox_events(
  target_organization_id uuid,
  batch_size integer default 25
)
returns setof public.event_outbox
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if batch_size not between 1 and 100 then
    raise exception 'INVALID_BATCH_SIZE';
  end if;

  return query
  with candidates as (
    select eo.id
    from public.event_outbox eo
    where eo.organization_id = target_organization_id
      and eo.status in ('PENDING', 'FAILED')
      and eo.next_attempt_at <= now()
    order by eo.next_attempt_at, eo.created_at
    for update skip locked
    limit batch_size
  )
  update public.event_outbox eo
  set status = 'PROCESSING',
      attempt_count = eo.attempt_count + 1,
      locked_at = now(),
      last_error = null
  from candidates
  where eo.id = candidates.id
  returning eo.*;
end;
$$;

create or replace function app.complete_outbox_event(
  target_organization_id uuid,
  target_event_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  affected_count integer;
begin
  update public.event_outbox
  set status = 'DELIVERED',
      delivered_at = now(),
      locked_at = null,
      last_error = null
  where organization_id = target_organization_id
    and id = target_event_id
    and status = 'PROCESSING';

  get diagnostics affected_count = row_count;
  return affected_count = 1;
end;
$$;

create or replace function app.fail_outbox_event(
  target_organization_id uuid,
  target_event_id uuid,
  error_message text,
  max_attempts integer default 5
)
returns public.notification_status
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  event_record public.event_outbox%rowtype;
  next_status public.notification_status;
begin
  if max_attempts < 1 then raise exception 'INVALID_MAX_ATTEMPTS'; end if;
  if nullif(btrim(error_message), '') is null then raise exception 'ERROR_MESSAGE_REQUIRED'; end if;

  select * into event_record
  from public.event_outbox
  where organization_id = target_organization_id and id = target_event_id
  for update;

  if not found then raise exception 'OUTBOX_EVENT_NOT_FOUND'; end if;
  if event_record.status <> 'PROCESSING' then raise exception 'OUTBOX_EVENT_NOT_PROCESSING'; end if;

  next_status := case
    when event_record.attempt_count >= max_attempts then 'DEAD_LETTER'::public.notification_status
    else 'FAILED'::public.notification_status
  end;

  update public.event_outbox
  set status = next_status,
      next_attempt_at = case
        when next_status = 'FAILED'
          then now() + make_interval(secs => least(3600, (power(2, greatest(event_record.attempt_count, 1)) * 30)::integer))
        else next_attempt_at
      end,
      locked_at = null,
      last_error = left(error_message, 2000)
  where id = event_record.id;

  if next_status = 'DEAD_LETTER' then
    insert into public.dead_letters (
      organization_id, source_table, source_id, reason, payload_json
    ) values (
      target_organization_id,
      'event_outbox',
      event_record.id,
      left(error_message, 2000),
      event_record.payload_json
    ) on conflict (source_table, source_id) do update
      set reason = excluded.reason,
          payload_json = excluded.payload_json;
  end if;

  return next_status;
end;
$$;

create or replace function app.requeue_stale_outbox_events(
  target_organization_id uuid,
  stale_after interval default interval '5 minutes'
)
returns integer
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  affected_count integer;
begin
  if stale_after < interval '1 minute' then raise exception 'INVALID_STALE_WINDOW'; end if;

  update public.event_outbox
  set status = 'FAILED',
      next_attempt_at = now(),
      locked_at = null,
      last_error = 'WORKER_LEASE_EXPIRED'
  where organization_id = target_organization_id
    and status = 'PROCESSING'
    and locked_at < now() - stale_after;

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;

create or replace function app.enforce_contact_tenant_integrity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.accounts a
    where a.id = new.account_id and a.organization_id = new.organization_id
  ) then
    raise exception 'TENANT_REFERENCE_MISMATCH:contacts.account_id';
  end if;
  return new;
end;
$$;

create or replace function app.enforce_enrollment_tenant_integrity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.campaigns c
    join public.sequence_versions sv
      on sv.campaign_id = c.id and sv.organization_id = c.organization_id
    join public.accounts a
      on a.id = new.account_id and a.organization_id = c.organization_id
    join public.contacts ct
      on ct.id = new.contact_id
      and ct.organization_id = c.organization_id
      and ct.account_id = a.id
    join public.mailboxes mb
      on mb.id = new.mailbox_id and mb.organization_id = c.organization_id
    where c.id = new.campaign_id
      and c.organization_id = new.organization_id
      and sv.id = new.sequence_version_id
  ) then
    raise exception 'TENANT_REFERENCE_MISMATCH:campaign_enrollments';
  end if;
  return new;
end;
$$;

create or replace function app.enforce_message_tenant_integrity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.contact_id is not null and not exists (
    select 1 from public.contacts c
    where c.id = new.contact_id and c.organization_id = new.organization_id
  ) then
    raise exception 'TENANT_REFERENCE_MISMATCH:messages.contact_id';
  end if;

  if new.mailbox_id is not null and not exists (
    select 1 from public.mailboxes mb
    where mb.id = new.mailbox_id and mb.organization_id = new.organization_id
  ) then
    raise exception 'TENANT_REFERENCE_MISMATCH:messages.mailbox_id';
  end if;

  if new.enrollment_id is not null and not exists (
    select 1 from public.campaign_enrollments ce
    where ce.id = new.enrollment_id
      and ce.organization_id = new.organization_id
      and (new.contact_id is null or ce.contact_id = new.contact_id)
      and (new.mailbox_id is null or ce.mailbox_id = new.mailbox_id)
  ) then
    raise exception 'TENANT_REFERENCE_MISMATCH:messages.enrollment_id';
  end if;

  return new;
end;
$$;

create or replace function app.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function app.capture_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  data jsonb;
  org_id uuid;
  row_id uuid;
begin
  data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  org_id := nullif(data ->> 'organization_id', '')::uuid;
  row_id := nullif(data ->> 'id', '')::uuid;
  insert into public.audit_log (organization_id, actor_user_id, action, record_type, record_id, correlation_id, old_data, new_data)
  values (
    org_id,
    auth.uid(),
    tg_op,
    tg_table_name,
    row_id,
    nullif(data ->> 'correlation_id', '')::uuid,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

create or replace function app.prevent_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'AUDIT_LOG_APPEND_ONLY';
end;
$$;

create trigger prevent_audit_update_delete before update or delete on public.audit_log
for each row execute function app.prevent_audit_mutation();

create trigger contacts_tenant_integrity before insert or update of organization_id, account_id
on public.contacts for each row execute function app.enforce_contact_tenant_integrity();

create trigger enrollments_tenant_integrity before insert or update of organization_id, campaign_id, sequence_version_id, account_id, contact_id, mailbox_id
on public.campaign_enrollments for each row execute function app.enforce_enrollment_tenant_integrity();

create trigger messages_tenant_integrity before insert or update of organization_id, enrollment_id, mailbox_id, contact_id
on public.messages for each row execute function app.enforce_message_tenant_integrity();

create trigger accounts_updated_at before update on public.accounts for each row execute function app.set_updated_at();
create trigger contacts_updated_at before update on public.contacts for each row execute function app.set_updated_at();
create trigger campaigns_updated_at before update on public.campaigns for each row execute function app.set_updated_at();
create trigger mailboxes_updated_at before update on public.mailboxes for each row execute function app.set_updated_at();
create trigger enrollments_updated_at before update on public.campaign_enrollments for each row execute function app.set_updated_at();
create trigger messages_updated_at before update on public.messages for each row execute function app.set_updated_at();
create trigger leads_updated_at before update on public.leads for each row execute function app.set_updated_at();
create trigger opportunities_updated_at before update on public.opportunities for each row execute function app.set_updated_at();

create trigger messages_audit after insert or update or delete on public.messages for each row execute function app.capture_audit_event();
create trigger leads_audit after insert or update or delete on public.leads for each row execute function app.capture_audit_event();
create trigger opportunities_audit after insert or update or delete on public.opportunities for each row execute function app.capture_audit_event();
create trigger campaigns_audit after insert or update or delete on public.campaigns for each row execute function app.capture_audit_event();
create trigger runtime_controls_audit after insert or update or delete on public.runtime_controls for each row execute function app.capture_audit_event();
create trigger enrollments_audit after insert or update or delete on public.campaign_enrollments for each row execute function app.capture_audit_event();
create trigger event_outbox_audit after insert or update or delete on public.event_outbox for each row execute function app.capture_audit_event();
create trigger suppressions_audit after insert or update or delete on public.suppression_entries for each row execute function app.capture_audit_event();
create trigger approvals_audit after insert or update or delete on public.approvals for each row execute function app.capture_audit_event();
create trigger incidents_audit after insert or update or delete on public.incidents for each row execute function app.capture_audit_event();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'organizations', 'organization_users', 'runtime_controls', 'import_batches', 'accounts',
    'account_aliases', 'contacts', 'source_evidence', 'suppression_entries', 'prequote_models',
    'prequotes', 'prequote_documents', 'campaigns', 'sequence_versions', 'sequence_touches',
    'mailboxes', 'campaign_enrollments', 'messages', 'provider_events', 'leads',
    'qualification_checks', 'opportunities', 'meetings', 'proposals', 'payments',
    'attribution_events', 'commissions', 'roadmap_milestones', 'acceptance_gates',
    'evidence_artifacts', 'approvals', 'incidents', 'tasks', 'event_outbox',
    'notification_deliveries', 'dead_letters', 'audit_log'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end;
$$;

create policy organizations_member_read on public.organizations for select using (app.is_member(id));
create policy organization_users_member_read on public.organization_users for select using (app.is_member(organization_id));

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'import_batches', 'accounts', 'account_aliases', 'contacts', 'source_evidence',
    'suppression_entries', 'prequote_models', 'prequotes', 'prequote_documents', 'campaigns',
    'sequence_versions', 'sequence_touches', 'mailboxes', 'campaign_enrollments', 'messages',
    'provider_events', 'leads', 'qualification_checks', 'opportunities', 'meetings', 'proposals',
    'payments', 'attribution_events', 'commissions', 'roadmap_milestones', 'acceptance_gates',
    'evidence_artifacts', 'approvals', 'incidents', 'tasks'
  ] loop
    execute format('create policy %I_member_read on public.%I for select using (app.is_member(organization_id))', table_name, table_name);
    execute format(
      'create policy %I_operator_write on public.%I for all using (app.has_role(organization_id, array[''ennco_admin''::public.user_role, ''ennco_operator''::public.user_role, ''teckel_admin''::public.user_role, ''teckel_operator''::public.user_role])) with check (app.has_role(organization_id, array[''ennco_admin''::public.user_role, ''ennco_operator''::public.user_role, ''teckel_admin''::public.user_role, ''teckel_operator''::public.user_role]))',
      table_name,
      table_name
    );
  end loop;
end;
$$;

create policy runtime_controls_member_read on public.runtime_controls
for select using (app.is_member(organization_id));

create policy runtime_controls_admin_write on public.runtime_controls
for all
using (app.has_role(organization_id, array['ennco_admin'::public.user_role, 'teckel_admin'::public.user_role]))
with check (app.has_role(organization_id, array['ennco_admin'::public.user_role, 'teckel_admin'::public.user_role]));

create policy audit_log_member_read on public.audit_log
for select using (app.is_member(organization_id));

create policy event_outbox_member_read on public.event_outbox
for select using (app.is_member(organization_id));

create policy event_outbox_technical_write on public.event_outbox
for all
using (app.has_role(organization_id, array['teckel_admin'::public.user_role, 'teckel_operator'::public.user_role]))
with check (app.has_role(organization_id, array['teckel_admin'::public.user_role, 'teckel_operator'::public.user_role]));

create policy notification_deliveries_member_read on public.notification_deliveries
for select using (app.is_member(organization_id));

create policy notification_deliveries_technical_write on public.notification_deliveries
for all
using (app.has_role(organization_id, array['teckel_admin'::public.user_role, 'teckel_operator'::public.user_role]))
with check (app.has_role(organization_id, array['teckel_admin'::public.user_role, 'teckel_operator'::public.user_role]));

create policy dead_letters_member_read on public.dead_letters
for select using (app.is_member(organization_id));

create policy dead_letters_technical_write on public.dead_letters
for all
using (app.has_role(organization_id, array['teckel_admin'::public.user_role, 'teckel_operator'::public.user_role]))
with check (app.has_role(organization_id, array['teckel_admin'::public.user_role, 'teckel_operator'::public.user_role]));

revoke all on function app.enqueue_outbound_message(uuid, uuid, integer, text, text, text, uuid, boolean) from public;
revoke all on function app.claim_outbox_events(uuid, integer) from public;
revoke all on function app.complete_outbox_event(uuid, uuid) from public;
revoke all on function app.fail_outbox_event(uuid, uuid, text, integer) from public;
revoke all on function app.requeue_stale_outbox_events(uuid, interval) from public;
revoke all on function app.is_suppressed(uuid, uuid, text, text) from public;
revoke all on function app.is_member(uuid) from public;
revoke all on function app.has_role(uuid, public.user_role[]) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant usage on schema public, app to authenticated;
    grant select on all tables in schema public to authenticated;
    grant insert, update, delete on all tables in schema public to authenticated;
    revoke insert, update, delete, truncate on public.organizations, public.organization_users, public.audit_log from authenticated;
    grant execute on function app.is_member(uuid) to authenticated;
    grant execute on function app.has_role(uuid, public.user_role[]) to authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema app to service_role;
    grant execute on function app.enqueue_outbound_message(uuid, uuid, integer, text, text, text, uuid, boolean) to service_role;
    grant execute on function app.claim_outbox_events(uuid, integer) to service_role;
    grant execute on function app.complete_outbox_event(uuid, uuid) to service_role;
    grant execute on function app.fail_outbox_event(uuid, uuid, text, integer) to service_role;
    grant execute on function app.requeue_stale_outbox_events(uuid, interval) to service_role;
  end if;
end;
$$;

commit;
