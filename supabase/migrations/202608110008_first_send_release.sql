begin;

create type public.first_send_gate_code as enum (
  'ANNEX_A_RECONCILED',
  'EXECUTED_CONTRACT_ARCHIVED',
  'START_CONDITION_EVIDENCE',
  'LEGAL_BASIS_APPROVED',
  'PRIVACY_NOTICE_APPROVED',
  'DOMAIN_AGE_35_DAYS',
  'SPF_PASS',
  'DKIM_PASS',
  'DMARC_PASS',
  'TLS_PASS',
  'FORWARD_REVERSE_DNS_PASS',
  'POSTMASTER_VERIFIED',
  'SEED_GMAIL_PASS',
  'SEED_WORKSPACE_PASS',
  'SEED_OUTLOOK_PASS',
  'SEED_YAHOO_PASS',
  'PILOT_EXACTLY_FIVE_ACCOUNTS',
  'CONTACTS_VERIFIED',
  'COPY_APPROVED_FRANCISCO',
  'TECHNICAL_APPROVED_PACO',
  'SUPPRESSION_RECONCILED_24H',
  'DRY_RUN_IDENTICAL',
  'REPLY_SYNC_PASS',
  'ALERTS_PASS',
  'CANARY_LIVE_PASS',
  'MANIFEST_HASH_MATCH',
  'EXPLICIT_SEND_APPROVAL_JORGE',
  'SEND_WINDOW_VALID',
  'MAILBOX_HEALTHY',
  'UNSUBSCRIBE_READY'
);

create type public.release_gate_status as enum ('UNKNOWN', 'PASS', 'FAIL', 'KILL');
create type public.first_send_batch_status as enum ('DRAFT', 'READY', 'RELEASED', 'KILLED');

create unique index if not exists accounts_organization_id_id_unique
on public.accounts (organization_id, id);

create unique index if not exists campaign_enrollments_organization_id_id_unique
on public.campaign_enrollments (organization_id, id);

create unique index if not exists approvals_organization_id_id_unique
on public.approvals (organization_id, id);

create table public.campaign_release_gates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  gate_code public.first_send_gate_code not null,
  status public.release_gate_status not null default 'UNKNOWN',
  evidence_class public.evidence_class not null,
  evidence_sha256 text,
  observed_at timestamptz,
  valid_until timestamptz,
  recorded_by uuid,
  approval_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id)
    on delete cascade,
  foreign key (organization_id, approval_id)
    references public.approvals (organization_id, id),
  unique (organization_id, campaign_id, gate_code),
  check (evidence_sha256 is null or evidence_sha256 ~ '^[a-f0-9]{64}$'),
  check (status <> 'PASS' or (
    evidence_class = 'live'
    and evidence_sha256 is not null
    and observed_at is not null
    and recorded_by is not null
  )),
  check (gate_code <> 'EXPLICIT_SEND_APPROVAL_JORGE' or status <> 'PASS' or approval_id is not null),
  check (valid_until is null or observed_at is null or valid_until > observed_at)
);

create table public.first_send_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  manifest_sha256 text not null check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  status public.first_send_batch_status not null default 'DRAFT',
  recipient_count smallint not null default 0 check (recipient_count between 0 and 5),
  account_count smallint not null default 0 check (account_count between 0 and 5),
  scheduled_for timestamptz,
  timezone text not null default 'America/Mexico_City' check (timezone = 'America/Mexico_City'),
  approved_by uuid,
  approved_at timestamptz,
  released_at timestamptz,
  killed_at timestamptz,
  kill_reason_code text check (kill_reason_code is null or kill_reason_code ~ '^[A-Z0-9_]{3,64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id)
    on delete cascade,
  unique (organization_id, id),
  check ((approved_by is null) = (approved_at is null)),
  check (released_at is null or approved_at is not null),
  check (
    (status = 'DRAFT' and approved_at is null and released_at is null and killed_at is null and kill_reason_code is null)
    or (status = 'READY' and approved_at is not null and released_at is null and killed_at is null and kill_reason_code is null)
    or (status = 'RELEASED' and approved_at is not null and released_at is not null and killed_at is null and kill_reason_code is null)
    or (status = 'KILLED' and killed_at is not null and kill_reason_code is not null)
  )
);

create table public.first_send_batch_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  batch_id uuid not null,
  enrollment_id uuid not null,
  account_id uuid not null,
  contact_id uuid not null,
  mailbox_id uuid not null,
  sequence_version_id uuid not null,
  contact_email_sha256 text not null check (contact_email_sha256 ~ '^[a-f0-9]{64}$'),
  sequence_content_sha256 text not null check (sequence_content_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (organization_id, batch_id)
    references public.first_send_batches (organization_id, id)
    on delete cascade,
  foreign key (organization_id, enrollment_id)
    references public.campaign_enrollments (organization_id, id)
    on delete cascade,
  foreign key (organization_id, account_id)
    references public.accounts (organization_id, id),
  foreign key (organization_id, contact_id)
    references public.contacts (organization_id, id),
  unique (organization_id, batch_id, enrollment_id),
  unique (organization_id, batch_id, account_id),
  unique (organization_id, batch_id, contact_id)
);

create index campaign_release_gates_campaign_idx
on public.campaign_release_gates (organization_id, campaign_id, gate_code);

create index first_send_batches_campaign_idx
on public.first_send_batches (organization_id, campaign_id, status);

create trigger campaign_release_gates_updated_at
before update on public.campaign_release_gates
for each row execute function app.set_updated_at();

create trigger first_send_batches_updated_at
before update on public.first_send_batches
for each row execute function app.set_updated_at();

create or replace function app.enforce_first_send_enrollment_integrity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'FIRST_SEND_RECIPIENT_SET_IMMUTABLE';
  end if;
  if not exists (
    select 1
    from public.first_send_batches b
    join public.campaign_enrollments ce
      on ce.id = new.enrollment_id
     and ce.organization_id = new.organization_id
    join public.contacts c
      on c.id = ce.contact_id
     and c.organization_id = ce.organization_id
    join public.sequence_versions sv
      on sv.id = ce.sequence_version_id
     and sv.organization_id = ce.organization_id
     and sv.campaign_id = ce.campaign_id
    where b.id = new.batch_id
      and b.organization_id = new.organization_id
      and b.status = 'DRAFT'
      and b.campaign_id = ce.campaign_id
      and ce.account_id = new.account_id
      and ce.contact_id = new.contact_id
      and ce.mailbox_id = new.mailbox_id
      and ce.sequence_version_id = new.sequence_version_id
      and encode(digest(c.normalized_email, 'sha256'), 'hex') = new.contact_email_sha256
      and sv.content_sha256 = new.sequence_content_sha256
  ) then
    raise exception 'FIRST_SEND_TENANT_OR_REFERENCE_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger first_send_batch_enrollments_integrity
before insert or update or delete
on public.first_send_batch_enrollments
for each row execute function app.enforce_first_send_enrollment_integrity();

create or replace function app.enforce_approval_append_only()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  actor_id uuid;
begin
  if tg_op <> 'INSERT' then raise exception 'APPROVAL_APPEND_ONLY'; end if;
  actor_id := auth.uid();
  if actor_id is not null and new.decided_by <> actor_id then
    raise exception 'APPROVAL_ACTOR_MISMATCH';
  end if;
  if new.subject_type = 'campaign_first_send_release'
    and (
      actor_id is null
      or not app.has_role(new.organization_id, array['teckel_admin'::public.user_role])
    )
  then raise exception 'FIRST_SEND_APPROVAL_JORGE_ONLY'; end if;
  return new;
end;
$$;

create trigger approvals_append_only
before insert or update or delete on public.approvals
for each row execute function app.enforce_approval_append_only();

create or replace function app.is_first_send_window(
  scheduled_for_value timestamptz,
  observed_at_value timestamptz
)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select
    extract(isodow from scheduled_for_value at time zone 'America/Mexico_City') between 2 and 4
    and (scheduled_for_value at time zone 'America/Mexico_City')::time = time '09:30'
    and observed_at_value >= scheduled_for_value
    and observed_at_value < scheduled_for_value + interval '2 hours';
$$;

create or replace function app.assess_first_send_batch(target_batch_id uuid)
returns public.gate_decision
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  batch_record public.first_send_batches%rowtype;
  campaign_record public.campaigns%rowtype;
  gate_total integer;
  expected_gate_total integer;
  gate_pass_total integer;
  gate_kill_total integer;
  gate_expired_total integer;
  enrollment_total integer;
  distinct_account_total integer;
  distinct_contact_total integer;
begin
  select * into batch_record
  from public.first_send_batches
  where id = target_batch_id;
  if not found then raise exception 'FIRST_SEND_BATCH_NOT_FOUND'; end if;

  select * into campaign_record
  from public.campaigns
  where id = batch_record.campaign_id
    and organization_id = batch_record.organization_id;
  if not found then raise exception 'FIRST_SEND_CAMPAIGN_NOT_FOUND'; end if;

  if batch_record.status = 'KILLED' then return 'KILL'; end if;

  select count(*) into expected_gate_total
  from unnest(enum_range(null::public.first_send_gate_code));

  select
    count(*),
    count(*) filter (
      where status = 'PASS'
        and evidence_class = 'live'
        and evidence_sha256 is not null
        and observed_at is not null
        and observed_at <= now() + interval '5 minutes'
        and recorded_by is not null
    ),
    count(*) filter (where status = 'KILL'),
    count(*) filter (where valid_until is not null and valid_until <= now())
  into gate_total, gate_pass_total, gate_kill_total, gate_expired_total
  from public.campaign_release_gates
  where organization_id = batch_record.organization_id
    and campaign_id = batch_record.campaign_id;

  if gate_kill_total > 0 then return 'KILL'; end if;
  if gate_total <> expected_gate_total or gate_pass_total <> expected_gate_total or gate_expired_total > 0 then return 'EXTEND'; end if;
  if campaign_record.manifest_sha256 <> batch_record.manifest_sha256 then return 'KILL'; end if;
  if campaign_record.status not in ('APPROVED', 'ACTIVE')
    or campaign_record.approved_by is null
    or campaign_record.approved_at is null
    or campaign_record.shadow_canary_decision <> 'PASS'
  then return 'EXTEND'; end if;
  if campaign_record.suppression_snapshot_at is null
    or campaign_record.suppression_snapshot_at < now() - interval '24 hours'
    or campaign_record.suppression_snapshot_at > now() + interval '5 minutes'
  then return 'EXTEND'; end if;
  if batch_record.scheduled_for is null
    or extract(isodow from batch_record.scheduled_for at time zone 'America/Mexico_City') not between 2 and 4
    or (batch_record.scheduled_for at time zone 'America/Mexico_City')::time <> time '09:30'
    or batch_record.scheduled_for + interval '2 hours' <= now()
    or batch_record.scheduled_for > now() + interval '7 days'
  then return 'EXTEND'; end if;

  if not exists (
    select 1
    from public.campaign_release_gates rg
    join public.approvals ap
      on ap.id = rg.approval_id
     and ap.organization_id = rg.organization_id
    join public.organization_users ou
      on ou.organization_id = rg.organization_id
     and ou.user_id = rg.recorded_by
     and ou.active
     and ou.role = 'teckel_admin'
    where rg.organization_id = batch_record.organization_id
      and rg.campaign_id = batch_record.campaign_id
      and rg.gate_code = 'EXPLICIT_SEND_APPROVAL_JORGE'
      and rg.status = 'PASS'
      and ap.subject_type = 'campaign_first_send_release'
      and ap.subject_id = batch_record.campaign_id
      and ap.subject_sha256 = batch_record.manifest_sha256
      and ap.decision = 'APPROVED'
      and ap.decided_by = rg.recorded_by
      and ap.decided_at = rg.observed_at
      and ap.decided_at <= now() + interval '5 minutes'
  ) then return 'EXTEND'; end if;

  select count(*), count(distinct account_id), count(distinct contact_id)
  into enrollment_total, distinct_account_total, distinct_contact_total
  from public.first_send_batch_enrollments
  where organization_id = batch_record.organization_id
    and batch_id = batch_record.id;

  if enrollment_total <> 5 or distinct_account_total <> 5 or distinct_contact_total <> 5 then return 'EXTEND'; end if;
  if batch_record.recipient_count <> 5 or batch_record.account_count <> 5 then return 'EXTEND'; end if;

  if exists (
    select 1
    from public.first_send_batch_enrollments be
    left join public.campaign_enrollments ce
      on ce.id = be.enrollment_id and ce.organization_id = be.organization_id
    left join public.contacts c
      on c.id = be.contact_id and c.organization_id = be.organization_id
    left join public.accounts a
      on a.id = be.account_id and a.organization_id = be.organization_id
    left join public.mailboxes m
      on m.id = ce.mailbox_id and m.organization_id = be.organization_id
    left join public.sequence_versions sv
      on sv.id = be.sequence_version_id
     and sv.organization_id = be.organization_id
     and sv.campaign_id = batch_record.campaign_id
    where be.organization_id = batch_record.organization_id
      and be.batch_id = batch_record.id
      and (
        ce.id is null
        or c.id is null
        or a.id is null
        or m.id is null
        or sv.id is null
        or ce.campaign_id <> batch_record.campaign_id
        or ce.mailbox_id <> be.mailbox_id
        or ce.sequence_version_id <> be.sequence_version_id
        or ce.status not in ('PENDING', 'ACTIVE')
        or sv.approved_by is null
        or sv.approved_at is null
        or not c.verified
        or c.verified_at is null
        or a.is_deleted
        or c.is_deleted
        or encode(digest(c.normalized_email, 'sha256'), 'hex') <> be.contact_email_sha256
        or sv.content_sha256 <> be.sequence_content_sha256
        or m.kill_switch
        or m.health_status <> 'HEALTHY'
        or not (m.auth_spf and m.auth_dkim and m.auth_dmarc and m.auth_tls)
        or m.domain_ready_at is null
        or m.domain_ready_at > now() - interval '35 days'
        or app.is_suppressed(be.organization_id, a.id, c.normalized_email, a.primary_domain)
      )
  ) then return 'EXTEND'; end if;

  return 'PASS';
end;
$$;

create or replace function app.finalize_first_send_batch(target_batch_id uuid)
returns public.gate_decision
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  batch_record public.first_send_batches%rowtype;
  approval_actor uuid;
  assessed public.gate_decision;
begin
  if coalesce(nullif(current_setting('role', true), 'none'), session_user) not in ('service_role', 'supabase_admin') then
    raise exception 'FIRST_SEND_SERVICE_ONLY';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('first-send:' || target_batch_id::text, 0));
  select * into batch_record from public.first_send_batches where id = target_batch_id for update;
  if not found then raise exception 'FIRST_SEND_BATCH_NOT_FOUND'; end if;
  if batch_record.status = 'KILLED' then return 'KILL'; end if;

  assessed := app.assess_first_send_batch(target_batch_id);
  if assessed = 'PASS' then
    select recorded_by into approval_actor
    from public.campaign_release_gates
    where organization_id = batch_record.organization_id
      and campaign_id = batch_record.campaign_id
      and gate_code = 'EXPLICIT_SEND_APPROVAL_JORGE'
      and status = 'PASS';
    if approval_actor is null then return 'EXTEND'; end if;
    if batch_record.status = 'DRAFT' then
      update public.first_send_batches
      set status = 'READY', approved_by = approval_actor, approved_at = now()
      where id = target_batch_id;
    end if;
  elsif assessed = 'KILL' then
    update public.first_send_batches
    set status = 'KILLED', killed_at = now(), kill_reason_code = 'GATE_DECISION_KILL'
    where id = target_batch_id;
  end if;
  return assessed;
end;
$$;

create or replace function app.enforce_first_send_outbound_release()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  batch_record public.first_send_batches%rowtype;
  controls_record public.runtime_controls%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('first-send-org:' || new.organization_id::text, 0));
  if new.direction <> 'OUTBOUND' or new.status not in ('QUEUED', 'SENDING', 'SENT', 'DELIVERED') then
    return new;
  end if;
  if new.enrollment_id is null then raise exception 'FIRST_SEND_ENROLLMENT_REQUIRED'; end if;

  if new.status in ('SENT', 'DELIVERED') then
    if tg_op = 'INSERT'
      or old.direction <> 'OUTBOUND'
      or (new.status = 'SENT' and old.status <> 'SENDING')
      or (new.status = 'DELIVERED' and old.status <> 'SENT')
    then raise exception 'FIRST_SEND_STATUS_TRANSITION_INVALID'; end if;

    if not exists (
      select 1
      from public.first_send_batches b
      join public.first_send_batch_enrollments be
        on be.batch_id = b.id and be.organization_id = b.organization_id
      where be.organization_id = new.organization_id
        and be.enrollment_id = new.enrollment_id
        and b.status = 'RELEASED'
    ) then raise exception 'FIRST_SEND_BATCH_NOT_RELEASED'; end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'DRY_RUN' then
    raise exception 'FIRST_SEND_DRY_RUN_IMMUTABLE';
  end if;
  if new.status = 'SENDING' and (tg_op = 'INSERT' or old.status <> 'QUEUED') then
    raise exception 'FIRST_SEND_STATUS_TRANSITION_INVALID';
  end if;

  select b.* into batch_record
  from public.first_send_batches b
  join public.first_send_batch_enrollments be
    on be.batch_id = b.id and be.organization_id = b.organization_id
  where be.organization_id = new.organization_id
    and be.enrollment_id = new.enrollment_id
    and b.status in ('READY', 'RELEASED')
  order by b.approved_at desc
  limit 1;
  if not found then raise exception 'FIRST_SEND_BATCH_NOT_READY'; end if;
  if app.assess_first_send_batch(batch_record.id) <> 'PASS' then raise exception 'FIRST_SEND_GATE_NOT_PASS'; end if;

  select * into controls_record
  from public.runtime_controls
  where organization_id = new.organization_id;
  if not found or controls_record.global_kill_switch or not controls_record.external_send_allowed then
    raise exception 'FIRST_SEND_RUNTIME_HOLD';
  end if;
  if not app.is_first_send_window(batch_record.scheduled_for, now()) then
    raise exception 'FIRST_SEND_OUTSIDE_WINDOW';
  end if;
  if batch_record.status = 'READY' then
    update public.first_send_batches
    set status = 'RELEASED', released_at = now()
    where id = batch_record.id;
  end if;
  return new;
end;
$$;

create or replace function app.lock_first_send_suppression_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  target_organization_id uuid;
begin
  target_organization_id := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  perform pg_advisory_xact_lock(hashtextextended('first-send-org:' || target_organization_id::text, 0));
  return coalesce(new, old);
end;
$$;

create trigger suppression_entries_first_send_lock
before insert or update or delete on public.suppression_entries
for each row execute function app.lock_first_send_suppression_change();

create trigger messages_first_send_release_gate
before insert or update of status on public.messages
for each row execute function app.enforce_first_send_outbound_release();

create or replace function app.capture_first_send_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  raw_data jsonb;
  safe_old jsonb;
  safe_new jsonb;
  org_id uuid;
  row_id uuid;
begin
  raw_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  org_id := nullif(raw_data ->> 'organization_id', '')::uuid;
  row_id := nullif(raw_data ->> 'id', '')::uuid;
  if tg_op in ('UPDATE', 'DELETE') then
    safe_old := case
      when tg_table_name = 'campaign_release_gates' then jsonb_strip_nulls(jsonb_build_object(
        'id', to_jsonb(old) -> 'id', 'organization_id', to_jsonb(old) -> 'organization_id',
        'campaign_id', to_jsonb(old) -> 'campaign_id', 'gate_code', to_jsonb(old) -> 'gate_code',
        'status', to_jsonb(old) -> 'status', 'evidence_class', to_jsonb(old) -> 'evidence_class',
        'evidence_sha256', to_jsonb(old) -> 'evidence_sha256', 'observed_at', to_jsonb(old) -> 'observed_at',
        'valid_until', to_jsonb(old) -> 'valid_until', 'recorded_by', to_jsonb(old) -> 'recorded_by',
        'approval_id', to_jsonb(old) -> 'approval_id'
      ))
      when tg_table_name = 'first_send_batches' then jsonb_strip_nulls(jsonb_build_object(
        'id', to_jsonb(old) -> 'id', 'organization_id', to_jsonb(old) -> 'organization_id',
        'campaign_id', to_jsonb(old) -> 'campaign_id', 'manifest_sha256', to_jsonb(old) -> 'manifest_sha256',
        'status', to_jsonb(old) -> 'status', 'recipient_count', to_jsonb(old) -> 'recipient_count',
        'account_count', to_jsonb(old) -> 'account_count', 'scheduled_for', to_jsonb(old) -> 'scheduled_for',
        'approved_by', to_jsonb(old) -> 'approved_by', 'approved_at', to_jsonb(old) -> 'approved_at',
        'released_at', to_jsonb(old) -> 'released_at', 'killed_at', to_jsonb(old) -> 'killed_at',
        'kill_reason_code', to_jsonb(old) -> 'kill_reason_code'
      ))
      else jsonb_strip_nulls(jsonb_build_object(
        'id', to_jsonb(old) -> 'id', 'organization_id', to_jsonb(old) -> 'organization_id',
        'batch_id', to_jsonb(old) -> 'batch_id', 'enrollment_id', to_jsonb(old) -> 'enrollment_id',
        'account_id', to_jsonb(old) -> 'account_id', 'contact_id', to_jsonb(old) -> 'contact_id',
        'mailbox_id', to_jsonb(old) -> 'mailbox_id', 'sequence_version_id', to_jsonb(old) -> 'sequence_version_id',
        'contact_email_sha256', to_jsonb(old) -> 'contact_email_sha256',
        'sequence_content_sha256', to_jsonb(old) -> 'sequence_content_sha256'
      ))
    end;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    safe_new := case
      when tg_table_name = 'campaign_release_gates' then jsonb_strip_nulls(jsonb_build_object(
        'id', to_jsonb(new) -> 'id', 'organization_id', to_jsonb(new) -> 'organization_id',
        'campaign_id', to_jsonb(new) -> 'campaign_id', 'gate_code', to_jsonb(new) -> 'gate_code',
        'status', to_jsonb(new) -> 'status', 'evidence_class', to_jsonb(new) -> 'evidence_class',
        'evidence_sha256', to_jsonb(new) -> 'evidence_sha256', 'observed_at', to_jsonb(new) -> 'observed_at',
        'valid_until', to_jsonb(new) -> 'valid_until', 'recorded_by', to_jsonb(new) -> 'recorded_by',
        'approval_id', to_jsonb(new) -> 'approval_id'
      ))
      when tg_table_name = 'first_send_batches' then jsonb_strip_nulls(jsonb_build_object(
        'id', to_jsonb(new) -> 'id', 'organization_id', to_jsonb(new) -> 'organization_id',
        'campaign_id', to_jsonb(new) -> 'campaign_id', 'manifest_sha256', to_jsonb(new) -> 'manifest_sha256',
        'status', to_jsonb(new) -> 'status', 'recipient_count', to_jsonb(new) -> 'recipient_count',
        'account_count', to_jsonb(new) -> 'account_count', 'scheduled_for', to_jsonb(new) -> 'scheduled_for',
        'approved_by', to_jsonb(new) -> 'approved_by', 'approved_at', to_jsonb(new) -> 'approved_at',
        'released_at', to_jsonb(new) -> 'released_at', 'killed_at', to_jsonb(new) -> 'killed_at',
        'kill_reason_code', to_jsonb(new) -> 'kill_reason_code'
      ))
      else jsonb_strip_nulls(jsonb_build_object(
        'id', to_jsonb(new) -> 'id', 'organization_id', to_jsonb(new) -> 'organization_id',
        'batch_id', to_jsonb(new) -> 'batch_id', 'enrollment_id', to_jsonb(new) -> 'enrollment_id',
        'account_id', to_jsonb(new) -> 'account_id', 'contact_id', to_jsonb(new) -> 'contact_id',
        'mailbox_id', to_jsonb(new) -> 'mailbox_id', 'sequence_version_id', to_jsonb(new) -> 'sequence_version_id',
        'contact_email_sha256', to_jsonb(new) -> 'contact_email_sha256',
        'sequence_content_sha256', to_jsonb(new) -> 'sequence_content_sha256'
      ))
    end;
  end if;
  insert into public.audit_log (
    organization_id, actor_user_id, action, record_type, record_id, old_data, new_data
  ) values (org_id, auth.uid(), tg_op, tg_table_name, row_id, safe_old, safe_new);
  return coalesce(new, old);
end;
$$;

create trigger campaign_release_gates_audit
after insert or update or delete on public.campaign_release_gates
for each row execute function app.capture_first_send_audit();

create trigger first_send_batches_audit
after insert or update or delete on public.first_send_batches
for each row execute function app.capture_first_send_audit();

create trigger first_send_batch_enrollments_audit
after insert or update or delete on public.first_send_batch_enrollments
for each row execute function app.capture_first_send_audit();

alter table public.campaign_release_gates enable row level security;
alter table public.first_send_batches enable row level security;
alter table public.first_send_batch_enrollments enable row level security;

create policy campaign_release_gates_member_read on public.campaign_release_gates
for select using (app.is_member(organization_id));

create policy first_send_batches_member_read on public.first_send_batches
for select using (app.is_member(organization_id));

create policy first_send_batch_enrollments_member_read on public.first_send_batch_enrollments
for select using (app.is_member(organization_id));

revoke all on table public.campaign_release_gates from public;
revoke all on table public.first_send_batches from public;
revoke all on table public.first_send_batch_enrollments from public;
revoke all on function app.assess_first_send_batch(uuid) from public;
revoke all on function app.finalize_first_send_batch(uuid) from public;
revoke all on function app.is_first_send_window(timestamptz, timestamptz) from public;
revoke all on function app.enforce_first_send_outbound_release() from public;
revoke all on function app.enforce_first_send_enrollment_integrity() from public;
revoke all on function app.enforce_approval_append_only() from public;
revoke all on function app.lock_first_send_suppression_change() from public;
revoke all on function app.capture_first_send_audit() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on public.campaign_release_gates, public.first_send_batches, public.first_send_batch_enrollments to authenticated;
    revoke insert, update, delete, truncate on public.campaign_release_gates, public.first_send_batches, public.first_send_batch_enrollments from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update on public.campaign_release_gates to service_role;
    grant select, insert on public.first_send_batches, public.first_send_batch_enrollments to service_role;
    revoke update, delete, truncate on public.first_send_batches, public.first_send_batch_enrollments from service_role;
    revoke delete, truncate on public.campaign_release_gates from service_role;
    grant execute on function app.assess_first_send_batch(uuid) to service_role;
    grant execute on function app.finalize_first_send_batch(uuid) to service_role;
    grant execute on function app.is_first_send_window(timestamptz, timestamptz) to service_role;
  end if;
end;
$$;

commit;
