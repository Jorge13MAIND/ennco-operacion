begin;

create type public.rollout_source_kind as enum ('FIRST_SEND_BATCH', 'ROLLOUT_WAVE');
create type public.rollout_wave_status as enum ('DRAFT', 'READY', 'RELEASED', 'PASSED', 'EXTENDED', 'KILLED');

create unique index if not exists sequence_versions_organization_id_id_unique
on public.sequence_versions (organization_id, id);

create unique index if not exists messages_one_external_touch_per_enrollment
on public.messages (organization_id, enrollment_id, touch_number)
where direction = 'OUTBOUND'
  and enrollment_id is not null
  and touch_number is not null
  and status in ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'BOUNCED');

create unique index if not exists first_send_one_batch_per_enrollment
on public.first_send_batch_enrollments (organization_id, enrollment_id);

create table public.rollout_health_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  source_kind public.rollout_source_kind not null,
  source_id uuid not null,
  observation_number smallint not null check (observation_number > 0),
  evidence_class public.evidence_class not null,
  delivered_count smallint not null check (delivered_count between 0 and 25),
  hard_bounce_count smallint not null default 0 check (hard_bounce_count between 0 and delivered_count),
  spam_complaint_count smallint not null default 0 check (spam_complaint_count between 0 and delivered_count),
  unsubscribe_count smallint not null default 0 check (unsubscribe_count between 0 and delivered_count),
  substantive_reply_count smallint not null default 0 check (substantive_reply_count between 0 and delivered_count),
  positive_reply_count smallint not null default 0 check (positive_reply_count between 0 and substantive_reply_count),
  strict_lead_count smallint not null default 0 check (strict_lead_count between 0 and positive_reply_count),
  duplicate_delivery_count smallint not null default 0 check (duplicate_delivery_count >= 0),
  suppression_violation_count smallint not null default 0 check (suppression_violation_count >= 0),
  unknown_count smallint not null default 0 check (unknown_count >= 0),
  open_p0 smallint not null default 0 check (open_p0 >= 0),
  open_p1 smallint not null default 0 check (open_p1 >= 0),
  reply_sync_p95_seconds integer check (reply_sync_p95_seconds is null or reply_sync_p95_seconds >= 0),
  observation_started_at timestamptz not null,
  observed_at timestamptz not null,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  decision public.gate_decision,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id)
    on delete cascade,
  unique (organization_id, id),
  unique (organization_id, source_kind, source_id, observation_number),
  check (observed_at >= observation_started_at),
  check ((decision is null) = (decided_at is null)),
  check (evidence_class = 'live' or decision is distinct from 'PASS')
);

create table public.rollout_waves (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  wave_number smallint not null check (wave_number > 0),
  previous_observation_id uuid not null,
  manifest_sha256 text not null check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  status public.rollout_wave_status not null default 'DRAFT',
  planned_recipient_count smallint not null check (planned_recipient_count between 1 and 25),
  planned_account_count smallint not null check (planned_account_count between 1 and 25),
  scheduled_for timestamptz not null,
  timezone text not null default 'America/Mexico_City' check (timezone = 'America/Mexico_City'),
  approval_id uuid not null,
  approved_by uuid,
  approved_at timestamptz,
  released_at timestamptz,
  passed_at timestamptz,
  extended_at timestamptz,
  killed_at timestamptz,
  kill_reason_code text check (kill_reason_code is null or kill_reason_code ~ '^[A-Z0-9_]{3,64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id)
    on delete cascade,
  foreign key (organization_id, previous_observation_id)
    references public.rollout_health_observations (organization_id, id),
  foreign key (organization_id, approval_id)
    references public.approvals (organization_id, id),
  unique (organization_id, id),
  unique (organization_id, campaign_id, wave_number),
  check (planned_recipient_count = planned_account_count),
  check ((approved_by is null) = (approved_at is null)),
  check (
    (status = 'DRAFT' and approved_at is null and released_at is null and passed_at is null and extended_at is null and killed_at is null)
    or (status = 'READY' and approved_at is not null and released_at is null and passed_at is null and extended_at is null and killed_at is null)
    or (status = 'RELEASED' and approved_at is not null and released_at is not null and passed_at is null and extended_at is null and killed_at is null)
    or (status = 'PASSED' and approved_at is not null and released_at is not null and passed_at is not null and killed_at is null)
    or (status = 'EXTENDED' and approved_at is not null and released_at is not null and extended_at is not null and killed_at is null)
    or (status = 'KILLED' and killed_at is not null and kill_reason_code is not null)
  )
);

create table public.rollout_wave_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  wave_id uuid not null,
  enrollment_id uuid not null,
  account_id uuid not null,
  contact_id uuid not null,
  mailbox_id uuid not null,
  sequence_version_id uuid not null,
  contact_email_sha256 text not null check (contact_email_sha256 ~ '^[a-f0-9]{64}$'),
  sequence_content_sha256 text not null check (sequence_content_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (organization_id, wave_id)
    references public.rollout_waves (organization_id, id)
    on delete cascade,
  foreign key (organization_id, enrollment_id)
    references public.campaign_enrollments (organization_id, id)
    on delete cascade,
  foreign key (organization_id, account_id)
    references public.accounts (organization_id, id),
  foreign key (organization_id, contact_id)
    references public.contacts (organization_id, id),
  foreign key (organization_id, mailbox_id)
    references public.mailboxes (organization_id, id),
  foreign key (organization_id, sequence_version_id)
    references public.sequence_versions (organization_id, id),
  unique (organization_id, wave_id, enrollment_id),
  unique (organization_id, wave_id, account_id),
  unique (organization_id, wave_id, contact_id),
  unique (organization_id, enrollment_id)
);

create or replace function app.enforce_first_send_no_rollout_overlap()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.rollout_wave_enrollments we
    where we.organization_id = new.organization_id
      and we.enrollment_id = new.enrollment_id
  ) then raise exception 'ENROLLMENT_RELEASE_SOURCE_OVERLAP'; end if;
  return new;
end;
$$;

create trigger first_send_no_rollout_overlap
before insert on public.first_send_batch_enrollments
for each row execute function app.enforce_first_send_no_rollout_overlap();

create table public.commercial_baselines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  version smallint not null default 1 check (version > 0),
  evidence_class public.evidence_class not null check (evidence_class = 'live'),
  cutoff_at timestamptz not null,
  valid_first_deliveries integer not null check (valid_first_deliveries = 100),
  substantive_replies integer not null check (substantive_replies between 0 and valid_first_deliveries),
  positive_replies integer not null check (positive_replies between 0 and substantive_replies),
  strict_leads integer not null check (strict_leads between 0 and positive_replies),
  held_meetings integer not null check (held_meetings between 0 and strict_leads),
  qualified_opportunities integer not null check (qualified_opportunities between 0 and held_meetings),
  reply_rate numeric(9,6) generated always as (substantive_replies::numeric / valid_first_deliveries) stored,
  positive_reply_rate numeric(9,6) generated always as (positive_replies::numeric / valid_first_deliveries) stored,
  strict_lead_rate numeric(9,6) generated always as (strict_leads::numeric / valid_first_deliveries) stored,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id)
    on delete cascade,
  unique (organization_id, id),
  unique (organization_id, campaign_id, version)
);

create index rollout_health_source_idx
on public.rollout_health_observations (organization_id, source_kind, source_id, observation_number desc);

create index rollout_waves_campaign_idx
on public.rollout_waves (organization_id, campaign_id, wave_number);

create trigger rollout_waves_updated_at
before update on public.rollout_waves
for each row execute function app.set_updated_at();

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
  if new.subject_type in ('campaign_first_send_release', 'rollout_wave_release')
    and (
      actor_id is null
      or not app.has_role(new.organization_id, array['teckel_admin'::public.user_role])
    )
  then raise exception 'OUTBOUND_RELEASE_APPROVAL_JORGE_ONLY'; end if;
  return new;
end;
$$;

create or replace function app.enforce_scaling_source_integrity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.source_kind = 'FIRST_SEND_BATCH' and not exists (
    select 1 from public.first_send_batches b
    where b.id = new.source_id
      and b.organization_id = new.organization_id
      and b.campaign_id = new.campaign_id
      and b.status = 'RELEASED'
  ) then raise exception 'SCALING_FIRST_SEND_SOURCE_INVALID'; end if;

  if new.source_kind = 'ROLLOUT_WAVE' and not exists (
    select 1 from public.rollout_waves w
    where w.id = new.source_id
      and w.organization_id = new.organization_id
      and w.campaign_id = new.campaign_id
      and w.status in ('RELEASED', 'EXTENDED')
  ) then raise exception 'SCALING_WAVE_SOURCE_INVALID'; end if;
  return new;
end;
$$;

create trigger rollout_health_source_integrity
before insert or update of organization_id, campaign_id, source_kind, source_id
on public.rollout_health_observations
for each row execute function app.enforce_scaling_source_integrity();

create or replace function app.enforce_rollout_enrollment_integrity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op <> 'INSERT' then raise exception 'ROLLOUT_RECIPIENT_SET_IMMUTABLE'; end if;
  if exists (
    select 1
    from public.first_send_batch_enrollments be
    where be.organization_id = new.organization_id
      and be.enrollment_id = new.enrollment_id
  ) then raise exception 'ENROLLMENT_RELEASE_SOURCE_OVERLAP'; end if;
  if not exists (
    select 1
    from public.rollout_waves w
    join public.campaign_enrollments ce
      on ce.id = new.enrollment_id and ce.organization_id = new.organization_id
    join public.contacts c
      on c.id = ce.contact_id and c.organization_id = ce.organization_id
    join public.sequence_versions sv
      on sv.id = ce.sequence_version_id
     and sv.organization_id = ce.organization_id
     and sv.campaign_id = ce.campaign_id
    where w.id = new.wave_id
      and w.organization_id = new.organization_id
      and w.status = 'DRAFT'
      and w.campaign_id = ce.campaign_id
      and ce.account_id = new.account_id
      and ce.contact_id = new.contact_id
      and ce.mailbox_id = new.mailbox_id
      and ce.sequence_version_id = new.sequence_version_id
      and encode(digest(c.normalized_email, 'sha256'), 'hex') = new.contact_email_sha256
      and sv.content_sha256 = new.sequence_content_sha256
  ) then raise exception 'ROLLOUT_TENANT_OR_REFERENCE_MISMATCH'; end if;
  return new;
end;
$$;

create trigger rollout_wave_enrollments_integrity
before insert or update or delete on public.rollout_wave_enrollments
for each row execute function app.enforce_rollout_enrollment_integrity();

create or replace function app.release_gates_are_current(
  target_organization_id uuid,
  target_campaign_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    count(*) = (select count(*) from unnest(enum_range(null::public.first_send_gate_code)))
    and bool_and(
      status = 'PASS'
      and evidence_class = 'live'
      and evidence_sha256 is not null
      and observed_at is not null
      and observed_at <= now() + interval '5 minutes'
      and recorded_by is not null
      and (valid_until is null or valid_until > now())
    )
  from public.campaign_release_gates
  where organization_id = target_organization_id
    and campaign_id = target_campaign_id;
$$;

create or replace function app.assess_scaling_health(target_observation_id uuid)
returns public.gate_decision
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  observation_record public.rollout_health_observations%rowtype;
begin
  select * into observation_record
  from public.rollout_health_observations
  where id = target_observation_id;
  if not found then raise exception 'SCALING_OBSERVATION_NOT_FOUND'; end if;

  if observation_record.spam_complaint_count > 0
    or observation_record.duplicate_delivery_count > 0
    or observation_record.suppression_violation_count > 0
    or observation_record.open_p0 > 0
  then return 'KILL'; end if;

  if observation_record.evidence_class <> 'live'
    or observation_record.delivered_count = 0
    or observation_record.observed_at - observation_record.observation_started_at < interval '24 hours'
    or observation_record.hard_bounce_count > 0
    or observation_record.unsubscribe_count > 0
    or observation_record.unknown_count > 0
    or observation_record.open_p1 > 0
    or observation_record.reply_sync_p95_seconds is null
    or observation_record.reply_sync_p95_seconds > 300
  then return 'EXTEND'; end if;

  return 'PASS';
end;
$$;

create or replace function app.finalize_scaling_health(target_observation_id uuid)
returns public.gate_decision
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  observation_record public.rollout_health_observations%rowtype;
  assessed public.gate_decision;
begin
  if coalesce(nullif(current_setting('role', true), 'none'), session_user) not in ('service_role', 'supabase_admin') then
    raise exception 'SCALING_HEALTH_SERVICE_ONLY';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('scaling-observation:' || target_observation_id::text, 0));
  select * into observation_record
  from public.rollout_health_observations
  where id = target_observation_id
  for update;
  if not found then raise exception 'SCALING_OBSERVATION_NOT_FOUND'; end if;
  if observation_record.decision is not null then return observation_record.decision; end if;

  assessed := app.assess_scaling_health(target_observation_id);
  update public.rollout_health_observations
  set decision = assessed, decided_at = now()
  where id = target_observation_id;

  if observation_record.source_kind = 'ROLLOUT_WAVE' then
    if assessed = 'PASS' then
      update public.rollout_waves
      set status = 'PASSED', passed_at = now(), extended_at = null
      where id = observation_record.source_id and status in ('RELEASED', 'EXTENDED');
    elsif assessed = 'EXTEND' then
      update public.rollout_waves
      set status = 'EXTENDED', extended_at = now()
      where id = observation_record.source_id and status in ('RELEASED', 'EXTENDED');
    else
      update public.rollout_waves
      set status = 'KILLED', killed_at = now(), kill_reason_code = 'HEALTH_GATE_KILL'
      where id = observation_record.source_id and status in ('RELEASED', 'EXTENDED');
    end if;
  end if;
  return assessed;
end;
$$;

create or replace function app.assess_rollout_wave(target_wave_id uuid)
returns public.gate_decision
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  wave_record public.rollout_waves%rowtype;
  prior_record public.rollout_health_observations%rowtype;
  campaign_record public.campaigns%rowtype;
  enrollment_total integer;
  distinct_account_total integer;
  distinct_contact_total integer;
  maximum_next_volume integer;
begin
  select * into wave_record from public.rollout_waves where id = target_wave_id;
  if not found then raise exception 'ROLLOUT_WAVE_NOT_FOUND'; end if;
  if wave_record.status = 'KILLED' then return 'KILL'; end if;

  select * into prior_record
  from public.rollout_health_observations
  where id = wave_record.previous_observation_id
    and organization_id = wave_record.organization_id;
  if not found or prior_record.decision <> 'PASS' or prior_record.evidence_class <> 'live' then return 'EXTEND'; end if;

  if wave_record.wave_number = 1 and prior_record.source_kind <> 'FIRST_SEND_BATCH' then return 'EXTEND'; end if;
  if wave_record.wave_number > 1 and (
    prior_record.source_kind <> 'ROLLOUT_WAVE'
    or not exists (
      select 1 from public.rollout_waves previous_wave
      where previous_wave.id = prior_record.source_id
        and previous_wave.organization_id = wave_record.organization_id
        and previous_wave.campaign_id = wave_record.campaign_id
        and previous_wave.wave_number = wave_record.wave_number - 1
        and previous_wave.status = 'PASSED'
    )
  ) then return 'EXTEND'; end if;

  select * into campaign_record
  from public.campaigns
  where id = wave_record.campaign_id and organization_id = wave_record.organization_id;
  if not found then raise exception 'ROLLOUT_CAMPAIGN_NOT_FOUND'; end if;
  if campaign_record.status <> 'ACTIVE'
    or campaign_record.shadow_canary_decision <> 'PASS'
    or campaign_record.manifest_sha256 <> wave_record.manifest_sha256
    or campaign_record.suppression_snapshot_at is null
    or campaign_record.suppression_snapshot_at < now() - interval '24 hours'
    or campaign_record.suppression_snapshot_at > now() + interval '5 minutes'
    or not app.release_gates_are_current(wave_record.organization_id, wave_record.campaign_id)
  then return 'EXTEND'; end if;

  if wave_record.scheduled_for + interval '2 hours' <= now()
    or wave_record.scheduled_for > now() + interval '7 days'
    or not app.is_first_send_window(wave_record.scheduled_for, wave_record.scheduled_for)
  then return 'EXTEND'; end if;

  if not exists (
    select 1
    from public.approvals ap
    join public.organization_users ou
      on ou.organization_id = ap.organization_id
     and ou.user_id = ap.decided_by
     and ou.active
     and ou.role = 'teckel_admin'
    where ap.id = wave_record.approval_id
      and ap.organization_id = wave_record.organization_id
      and ap.subject_type = 'rollout_wave_release'
      and ap.subject_id = wave_record.id
      and ap.subject_sha256 = wave_record.manifest_sha256
      and ap.decision = 'APPROVED'
  ) then return 'EXTEND'; end if;

  maximum_next_volume := least(25, greatest(5, prior_record.delivered_count * 2));
  if wave_record.planned_recipient_count > maximum_next_volume then return 'EXTEND'; end if;

  select count(*), count(distinct account_id), count(distinct contact_id)
  into enrollment_total, distinct_account_total, distinct_contact_total
  from public.rollout_wave_enrollments
  where organization_id = wave_record.organization_id and wave_id = wave_record.id;
  if enrollment_total <> wave_record.planned_recipient_count
    or distinct_account_total <> wave_record.planned_account_count
    or distinct_contact_total <> wave_record.planned_recipient_count
  then return 'EXTEND'; end if;

  if exists (
    select 1
    from public.rollout_wave_enrollments we
    left join public.campaign_enrollments ce
      on ce.id = we.enrollment_id and ce.organization_id = we.organization_id
    left join public.contacts c
      on c.id = we.contact_id and c.organization_id = we.organization_id
    left join public.accounts a
      on a.id = we.account_id and a.organization_id = we.organization_id
    left join public.mailboxes m
      on m.id = we.mailbox_id and m.organization_id = we.organization_id
    left join public.sequence_versions sv
      on sv.id = we.sequence_version_id
     and sv.organization_id = we.organization_id
     and sv.campaign_id = wave_record.campaign_id
    where we.organization_id = wave_record.organization_id
      and we.wave_id = wave_record.id
      and (
        ce.id is null or c.id is null or a.id is null or m.id is null or sv.id is null
        or ce.campaign_id <> wave_record.campaign_id
        or ce.account_id <> we.account_id or ce.contact_id <> we.contact_id
        or ce.mailbox_id <> we.mailbox_id or ce.sequence_version_id <> we.sequence_version_id
        or ce.status not in ('PENDING', 'ACTIVE')
        or not c.verified or c.verified_at is null or c.is_deleted or a.is_deleted
        or encode(digest(c.normalized_email, 'sha256'), 'hex') <> we.contact_email_sha256
        or sv.content_sha256 <> we.sequence_content_sha256
        or sv.approved_by is null or sv.approved_at is null
        or m.kill_switch or m.health_status <> 'HEALTHY'
        or not (m.auth_spf and m.auth_dkim and m.auth_dmarc and m.auth_tls)
        or m.domain_ready_at is null or m.domain_ready_at > now() - interval '35 days'
        or app.is_suppressed(we.organization_id, a.id, c.normalized_email, a.primary_domain)
      )
  ) then return 'EXTEND'; end if;

  return 'PASS';
end;
$$;

create or replace function app.finalize_rollout_wave(target_wave_id uuid)
returns public.gate_decision
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  wave_record public.rollout_waves%rowtype;
  approval_actor uuid;
  assessed public.gate_decision;
begin
  if coalesce(nullif(current_setting('role', true), 'none'), session_user) not in ('service_role', 'supabase_admin') then
    raise exception 'ROLLOUT_WAVE_SERVICE_ONLY';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rollout-wave:' || target_wave_id::text, 0));
  select * into wave_record from public.rollout_waves where id = target_wave_id for update;
  if not found then raise exception 'ROLLOUT_WAVE_NOT_FOUND'; end if;
  if wave_record.status = 'KILLED' then return 'KILL'; end if;

  assessed := app.assess_rollout_wave(target_wave_id);
  if assessed = 'PASS' and wave_record.status = 'DRAFT' then
    select decided_by into approval_actor from public.approvals where id = wave_record.approval_id;
    update public.rollout_waves
    set status = 'READY', approved_by = approval_actor, approved_at = now()
    where id = target_wave_id;
  elsif assessed = 'KILL' then
    update public.rollout_waves
    set status = 'KILLED', killed_at = now(), kill_reason_code = 'WAVE_GATE_KILL'
    where id = target_wave_id;
  end if;
  return assessed;
end;
$$;

create or replace function app.is_operational_send_window(observed_at_value timestamptz)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select
    extract(isodow from observed_at_value at time zone 'America/Mexico_City') between 2 and 4
    and (observed_at_value at time zone 'America/Mexico_City')::time >= time '09:30'
    and (observed_at_value at time zone 'America/Mexico_City')::time < time '11:30';
$$;

create or replace function app.followup_release_is_current(
  target_organization_id uuid,
  target_enrollment_id uuid,
  target_touch_number integer,
  observed_at_value timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  ce public.campaign_enrollments%rowtype;
  c public.contacts%rowtype;
  a public.accounts%rowtype;
  m public.mailboxes%rowtype;
  campaign_record public.campaigns%rowtype;
  sv public.sequence_versions%rowtype;
  source_released boolean;
begin
  select * into ce from public.campaign_enrollments
  where id = target_enrollment_id and organization_id = target_organization_id;
  if not found then return false; end if;
  select * into c from public.contacts where id = ce.contact_id and organization_id = target_organization_id;
  select * into a from public.accounts where id = ce.account_id and organization_id = target_organization_id;
  select * into m from public.mailboxes where id = ce.mailbox_id and organization_id = target_organization_id;
  select * into campaign_record from public.campaigns where id = ce.campaign_id and organization_id = target_organization_id;
  select * into sv from public.sequence_versions where id = ce.sequence_version_id and organization_id = target_organization_id;

  select (
    exists (
      select 1 from public.first_send_batch_enrollments be
      join public.first_send_batches b on b.id = be.batch_id and b.organization_id = be.organization_id
      where be.organization_id = target_organization_id
        and be.enrollment_id = target_enrollment_id
        and b.status = 'RELEASED'
        and exists (
          select 1 from public.rollout_health_observations ho
          where ho.organization_id = target_organization_id
            and ho.source_kind = 'FIRST_SEND_BATCH'
            and ho.source_id = b.id
            and ho.decision = 'PASS'
        )
    )
    or exists (
      select 1 from public.rollout_wave_enrollments we
      join public.rollout_waves w on w.id = we.wave_id and w.organization_id = we.organization_id
      where we.organization_id = target_organization_id
        and we.enrollment_id = target_enrollment_id
        and w.status = 'PASSED'
    )
  ) into source_released;

  return coalesce(source_released
    and ce.status = 'ACTIVE'
    and ce.next_touch_number = target_touch_number
    and ce.next_touch_at is not null
    and ce.next_touch_at <= observed_at_value + interval '5 minutes'
    and c.id is not null and c.verified and c.verified_at is not null and not c.is_deleted
    and a.id is not null and not a.is_deleted
    and m.id is not null and not m.kill_switch and m.health_status = 'HEALTHY'
    and m.auth_spf and m.auth_dkim and m.auth_dmarc and m.auth_tls
    and m.domain_ready_at is not null and m.domain_ready_at <= observed_at_value - interval '35 days'
    and campaign_record.id is not null and campaign_record.status = 'ACTIVE'
    and campaign_record.shadow_canary_decision = 'PASS'
    and campaign_record.suppression_snapshot_at is not null
    and campaign_record.suppression_snapshot_at >= observed_at_value - interval '24 hours'
    and sv.id is not null and sv.approved_by is not null and sv.approved_at is not null
    and exists (
      select 1 from public.sequence_touches st
      where st.organization_id = target_organization_id
        and st.sequence_version_id = sv.id
        and st.touch_number = target_touch_number
    )
    and app.release_gates_are_current(target_organization_id, ce.campaign_id)
    and not app.is_suppressed(target_organization_id, a.id, c.normalized_email, a.primary_domain)
    and app.is_operational_send_window(observed_at_value), false);
end;
$$;

drop trigger messages_first_send_release_gate on public.messages;

create or replace function app.enforce_scaled_outbound_release()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  first_batch public.first_send_batches%rowtype;
  rollout_wave public.rollout_waves%rowtype;
  controls_record public.runtime_controls%rowtype;
  source_ready boolean := false;
begin
  perform pg_advisory_xact_lock(hashtextextended('first-send-org:' || new.organization_id::text, 0));
  if new.direction <> 'OUTBOUND' or new.status not in ('QUEUED', 'SENDING', 'SENT', 'DELIVERED') then return new; end if;
  if new.enrollment_id is null or new.touch_number is null then raise exception 'OUTBOUND_RELEASE_REFERENCE_REQUIRED'; end if;

  select b.* into first_batch
  from public.first_send_batches b
  join public.first_send_batch_enrollments be on be.batch_id = b.id and be.organization_id = b.organization_id
  where be.organization_id = new.organization_id and be.enrollment_id = new.enrollment_id
  order by b.approved_at desc nulls last limit 1;

  select w.* into rollout_wave
  from public.rollout_waves w
  join public.rollout_wave_enrollments we on we.wave_id = w.id and we.organization_id = w.organization_id
  where we.organization_id = new.organization_id and we.enrollment_id = new.enrollment_id
  order by w.wave_number desc limit 1;

  if new.status in ('SENT', 'DELIVERED') then
    if tg_op = 'INSERT'
      or old.direction <> 'OUTBOUND'
      or (new.status = 'SENT' and old.status <> 'SENDING')
      or (new.status = 'DELIVERED' and old.status <> 'SENT')
    then raise exception 'OUTBOUND_STATUS_TRANSITION_INVALID'; end if;
    if not (
      (first_batch.id is not null and first_batch.status = 'RELEASED')
      or (rollout_wave.id is not null and rollout_wave.status in ('RELEASED', 'PASSED', 'EXTENDED'))
    ) then raise exception 'OUTBOUND_SOURCE_NOT_RELEASED'; end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'DRY_RUN' then raise exception 'OUTBOUND_DRY_RUN_IMMUTABLE'; end if;
  if new.status = 'SENDING' and (tg_op = 'INSERT' or old.status <> 'QUEUED') then raise exception 'OUTBOUND_STATUS_TRANSITION_INVALID'; end if;

  if new.touch_number = 1 then
    if first_batch.id is not null and first_batch.status in ('READY', 'RELEASED') then
      source_ready := app.assess_first_send_batch(first_batch.id) = 'PASS'
        and app.is_first_send_window(first_batch.scheduled_for, now());
    elsif rollout_wave.id is not null and rollout_wave.status in ('READY', 'RELEASED') then
      source_ready := app.assess_rollout_wave(rollout_wave.id) = 'PASS'
        and app.is_first_send_window(rollout_wave.scheduled_for, now());
    end if;
  else
    source_ready := app.followup_release_is_current(new.organization_id, new.enrollment_id, new.touch_number, now());
  end if;
  if source_ready is not true then raise exception 'OUTBOUND_RELEASE_GATE_NOT_PASS'; end if;

  select * into controls_record from public.runtime_controls where organization_id = new.organization_id;
  if not found or controls_record.global_kill_switch or not controls_record.external_send_allowed then
    raise exception 'OUTBOUND_RUNTIME_HOLD';
  end if;

  if new.touch_number = 1 and new.status = 'QUEUED' then
    if first_batch.id is not null and first_batch.status = 'READY' then
      update public.first_send_batches set status = 'RELEASED', released_at = now() where id = first_batch.id;
    elsif rollout_wave.id is not null and rollout_wave.status = 'READY' then
      update public.rollout_waves set status = 'RELEASED', released_at = now() where id = rollout_wave.id;
    end if;
  end if;
  return new;
end;
$$;

create trigger messages_scaled_release_gate
before insert or update of status on public.messages
for each row execute function app.enforce_scaled_outbound_release();

create or replace function app.freeze_t0_baseline(
  target_organization_id uuid,
  target_campaign_id uuid,
  target_evidence_sha256 text,
  target_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  cutoff_value timestamptz;
  delivery_count integer;
  reply_count integer;
  positive_count integer;
  lead_count integer;
  meeting_count integer;
  opportunity_count integer;
  created_id uuid;
begin
  if coalesce(nullif(current_setting('role', true), 'none'), session_user) not in ('service_role', 'supabase_admin') then
    raise exception 'T0_BASELINE_SERVICE_ONLY';
  end if;
  if target_evidence_sha256 !~ '^[a-f0-9]{64}$' or target_created_by is null then raise exception 'T0_EVIDENCE_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('t0:' || target_organization_id::text || ':' || target_campaign_id::text, 0));

  with ordered as (
    select m.id, m.sent_at, row_number() over (order by m.sent_at, m.id) as sequence
    from public.messages m
    join public.campaign_enrollments ce on ce.id = m.enrollment_id and ce.organization_id = m.organization_id
    where m.organization_id = target_organization_id
      and ce.campaign_id = target_campaign_id
      and m.direction = 'OUTBOUND'
      and m.status = 'DELIVERED'
      and m.touch_number = 1
      and m.sent_at is not null
      and m.provider_message_id is not null
  )
  select count(*), max(sent_at) into delivery_count, cutoff_value
  from ordered where sequence <= 100;
  if delivery_count < 100 then raise exception 'T0_REQUIRES_100_VALID_FIRST_DELIVERIES'; end if;

  with cohort as (
    select m.id
    from public.messages m
    join public.campaign_enrollments ce on ce.id = m.enrollment_id and ce.organization_id = m.organization_id
    where m.organization_id = target_organization_id
      and ce.campaign_id = target_campaign_id
      and m.direction = 'OUTBOUND' and m.status = 'DELIVERED' and m.touch_number = 1
      and m.sent_at is not null and m.provider_message_id is not null
    order by m.sent_at, m.id limit 100
  ), replies as (
    select distinct pe.message_id, pe.reply_classification
    from public.provider_events pe join cohort c on c.id = pe.message_id
    where pe.event_kind = 'REPLY' and pe.processing_status = 'PROCESSED'
  ), strict_lead_set as (
    select distinct l.id, l.origin_message_id
    from public.leads l join cohort c on c.id = l.origin_message_id
    where l.organization_id = target_organization_id and l.contractual_qualified and l.status = 'QUALIFIED'
  ), held_meeting_set as (
    select distinct sl.id as lead_id, o.id as opportunity_id
    from strict_lead_set sl
    join public.opportunities o on o.lead_id = sl.id and o.organization_id = target_organization_id
    join public.meetings mt on mt.opportunity_id = o.id and mt.organization_id = target_organization_id
    where mt.held_at is not null and mt.attendance_verified
  )
  select
    (select count(*) from replies),
    (select count(*) from replies where reply_classification = 'POSITIVE'),
    (select count(*) from strict_lead_set),
    (select count(distinct lead_id) from held_meeting_set),
    (select count(distinct hm.lead_id) from held_meeting_set hm join public.opportunities o on o.id = hm.opportunity_id
      where o.stage in ('QUALIFIED', 'TECHNICAL_VISIT', 'PROPOSAL', 'DECISION', 'CLOSED_WON')
        and o.economic_buyer and o.active_pain and o.business_impact and o.timing_under_90_days
        and o.value_mxn > 0 and o.next_action is not null and o.next_action_at is not null)
  into reply_count, positive_count, lead_count, meeting_count, opportunity_count;

  if positive_count > reply_count or lead_count > positive_count or meeting_count > lead_count or opportunity_count > meeting_count then
    raise exception 'T0_FUNNEL_INVARIANT_FAILED';
  end if;

  insert into public.commercial_baselines (
    organization_id, campaign_id, evidence_class, cutoff_at, valid_first_deliveries,
    substantive_replies, positive_replies, strict_leads, held_meetings,
    qualified_opportunities, evidence_sha256, created_by
  ) values (
    target_organization_id, target_campaign_id, 'live', cutoff_value, 100,
    reply_count, positive_count, lead_count, meeting_count, opportunity_count,
    target_evidence_sha256, target_created_by
  ) returning id into created_id;
  return created_id;
end;
$$;

create or replace function app.prevent_scaling_evidence_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'SCALING_EVIDENCE_APPEND_ONLY';
end;
$$;

create trigger commercial_baselines_append_only
before update or delete on public.commercial_baselines
for each row execute function app.prevent_scaling_evidence_mutation();

create or replace function app.capture_scaling_audit()
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
    safe_old := jsonb_strip_nulls(to_jsonb(old) - array['created_at', 'updated_at']);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    safe_new := jsonb_strip_nulls(to_jsonb(new) - array['created_at', 'updated_at']);
  end if;
  insert into public.audit_log (organization_id, actor_user_id, action, record_type, record_id, old_data, new_data)
  values (org_id, auth.uid(), tg_op, tg_table_name, row_id, safe_old, safe_new);
  return coalesce(new, old);
end;
$$;

create trigger rollout_health_observations_audit
after insert or update or delete on public.rollout_health_observations
for each row execute function app.capture_scaling_audit();

create trigger rollout_waves_audit
after insert or update or delete on public.rollout_waves
for each row execute function app.capture_scaling_audit();

create trigger rollout_wave_enrollments_audit
after insert or update or delete on public.rollout_wave_enrollments
for each row execute function app.capture_scaling_audit();

create trigger commercial_baselines_audit
after insert or update or delete on public.commercial_baselines
for each row execute function app.capture_scaling_audit();

alter table public.rollout_health_observations enable row level security;
alter table public.rollout_waves enable row level security;
alter table public.rollout_wave_enrollments enable row level security;
alter table public.commercial_baselines enable row level security;

create policy rollout_health_observations_member_read on public.rollout_health_observations
for select using (app.is_member(organization_id));
create policy rollout_waves_member_read on public.rollout_waves
for select using (app.is_member(organization_id));
create policy rollout_wave_enrollments_member_read on public.rollout_wave_enrollments
for select using (app.is_member(organization_id));
create policy commercial_baselines_member_read on public.commercial_baselines
for select using (app.is_member(organization_id));

revoke all on table public.rollout_health_observations, public.rollout_waves, public.rollout_wave_enrollments, public.commercial_baselines from public;
revoke all on function app.assess_scaling_health(uuid) from public;
revoke all on function app.finalize_scaling_health(uuid) from public;
revoke all on function app.assess_rollout_wave(uuid) from public;
revoke all on function app.finalize_rollout_wave(uuid) from public;
revoke all on function app.freeze_t0_baseline(uuid, uuid, text, uuid) from public;
revoke all on function app.followup_release_is_current(uuid, uuid, integer, timestamptz) from public;
revoke all on function app.release_gates_are_current(uuid, uuid) from public;
revoke all on function app.is_operational_send_window(timestamptz) from public;
revoke all on function app.capture_scaling_audit() from public;
revoke all on function app.prevent_scaling_evidence_mutation() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on public.rollout_health_observations, public.rollout_waves, public.rollout_wave_enrollments, public.commercial_baselines to authenticated;
    revoke insert, update, delete, truncate on public.rollout_health_observations, public.rollout_waves, public.rollout_wave_enrollments, public.commercial_baselines from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert on public.rollout_health_observations, public.rollout_waves, public.rollout_wave_enrollments to service_role;
    grant select on public.commercial_baselines to service_role;
    revoke update, delete, truncate on public.rollout_health_observations, public.rollout_waves, public.rollout_wave_enrollments, public.commercial_baselines from service_role;
    grant execute on function app.assess_scaling_health(uuid) to service_role;
    grant execute on function app.finalize_scaling_health(uuid) to service_role;
    grant execute on function app.assess_rollout_wave(uuid) to service_role;
    grant execute on function app.finalize_rollout_wave(uuid) to service_role;
    grant execute on function app.freeze_t0_baseline(uuid, uuid, text, uuid) to service_role;
  end if;
end;
$$;

commit;
