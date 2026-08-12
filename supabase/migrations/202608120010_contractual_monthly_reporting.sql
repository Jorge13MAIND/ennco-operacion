begin;

create type public.campaign_operation_status as enum ('OPERATING', 'HOLD', 'BLOCKED', 'UNKNOWN');
create type public.contractual_report_item_kind as enum (
  'DELIVERED_MESSAGE', 'SUBSTANTIVE_REPLY', 'POSITIVE_REPLY',
  'EMAIL_STRICT_LEAD', 'PREQUOTE_STRICT_LEAD', 'HELD_MEETING',
  'QUALIFIED_OPPORTUNITY', 'DELIVERED_PROPOSAL', 'CLOSED_WON',
  'FIRST_PAYMENT', 'CLIENT_SLA_BREACH'
);
create type public.recovery_variable as enum ('DELIVERABILITY', 'CONTACT_QUALITY', 'CLIENT_RESPONSE_SLA', 'SEGMENT', 'MESSAGE');
create type public.recovery_experiment_status as enum ('DRAFT', 'READY', 'RUNNING', 'COMPLETED', 'KILLED');

create unique index if not exists opportunities_organization_id_id_unique
on public.opportunities (organization_id, id);

create table public.commercial_stage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  opportunity_id uuid not null,
  from_stage public.commercial_stage not null,
  to_stage public.commercial_stage not null,
  evidence_class public.evidence_class not null,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  foreign key (organization_id, opportunity_id)
    references public.opportunities (organization_id, id)
    on delete cascade,
  unique (organization_id, id),
  check (from_stage <> to_stage)
);

create table public.campaign_operation_days (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  observed_on date not null,
  status public.campaign_operation_status not null,
  evidence_class public.evidence_class not null,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  recorded_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id)
    on delete cascade,
  unique (organization_id, id),
  unique (organization_id, campaign_id, observed_on),
  check (evidence_class = 'live' or status <> 'OPERATING')
);

create table public.reporting_calendar_days (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  calendar_date date not null,
  jurisdiction text not null default 'MX' check (jurisdiction = 'MX'),
  is_business_day boolean not null,
  evidence_class public.evidence_class not null check (evidence_class = 'live'),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  recorded_by uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, jurisdiction, calendar_date)
);

create table public.contractual_monthly_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  period_start date not null,
  period_end_exclusive date not null,
  report_due_on date not null,
  generated_on date not null,
  generated_on_time boolean not null,
  evidence_class public.evidence_class not null check (evidence_class = 'live'),
  operational_days smallint not null check (operational_days between 28 and 31),
  delivered_messages integer not null check (delivered_messages >= 0),
  substantive_replies integer not null check (substantive_replies between 0 and delivered_messages),
  positive_replies integer not null check (positive_replies between 0 and substantive_replies),
  email_strict_leads integer not null check (email_strict_leads between 0 and positive_replies),
  prequote_strict_leads integer not null check (prequote_strict_leads >= 0),
  total_strict_leads integer generated always as (email_strict_leads + prequote_strict_leads) stored,
  target_strict_leads smallint not null default 10 check (target_strict_leads = 10),
  target_met boolean generated always as ((email_strict_leads + prequote_strict_leads) >= 10) stored,
  held_meetings integer not null check (held_meetings >= 0),
  qualified_opportunities integer not null check (qualified_opportunities >= 0),
  delivered_proposals integer not null check (delivered_proposals >= 0),
  closed_won integer not null check (closed_won >= 0),
  first_payments_mxn numeric(18,2) not null check (first_payments_mxn >= 0),
  client_sla_breaches integer not null check (client_sla_breaches >= 0),
  reply_rate numeric(9,6) generated always as (substantive_replies::numeric / nullif(delivered_messages, 0)) stored,
  positive_reply_rate numeric(9,6) generated always as (positive_replies::numeric / nullif(delivered_messages, 0)) stored,
  email_strict_lead_rate numeric(9,6) generated always as (email_strict_leads::numeric / nullif(delivered_messages, 0)) stored,
  source_evidence_sha256 text not null check (source_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id)
    on delete cascade,
  unique (organization_id, id),
  unique (organization_id, campaign_id, period_start),
  check (extract(day from period_start) = 1),
  check (period_end_exclusive = (period_start + interval '1 month')::date),
  check (report_due_on >= period_end_exclusive),
  check (generated_on_time = (generated_on <= report_due_on)),
  check (held_meetings <= email_strict_leads + prequote_strict_leads),
  check (qualified_opportunities <= held_meetings),
  check (delivered_proposals <= qualified_opportunities),
  check (closed_won <= delivered_proposals)
);

create table public.contractual_report_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  report_id uuid not null,
  item_kind public.contractual_report_item_kind not null,
  record_id uuid not null,
  occurred_at timestamptz not null,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (organization_id, report_id)
    references public.contractual_monthly_reports (organization_id, id)
    on delete cascade,
  unique (organization_id, report_id, item_kind, record_id)
);

create table public.contractual_report_issuances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  report_id uuid not null,
  approval_id uuid not null,
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  issued_by uuid not null,
  issued_at timestamptz not null default now(),
  foreign key (organization_id, report_id)
    references public.contractual_monthly_reports (organization_id, id),
  foreign key (organization_id, approval_id)
    references public.approvals (organization_id, id),
  unique (organization_id, report_id),
  unique (organization_id, approval_id)
);

create table public.recovery_experiments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  report_id uuid not null,
  variable public.recovery_variable not null,
  hypothesis_code text not null check (hypothesis_code ~ '^[A-Z0-9_]{3,64}$'),
  sample_size smallint not null check (sample_size between 5 and 100),
  baseline_evidence_sha256 text not null check (baseline_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  denominators_verified boolean not null,
  deliverability_verified boolean not null,
  contact_quality_verified boolean not null,
  client_response_sla_verified boolean not null,
  best_segment_identified boolean not null,
  status public.recovery_experiment_status not null default 'DRAFT',
  approval_id uuid,
  approved_by uuid,
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  killed_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id),
  foreign key (organization_id, report_id)
    references public.contractual_monthly_reports (organization_id, id),
  foreign key (organization_id, approval_id)
    references public.approvals (organization_id, id),
  unique (organization_id, id),
  check ((approved_by is null) = (approved_at is null)),
  check (
    (status = 'DRAFT' and approval_id is null and approved_at is null and started_at is null and completed_at is null and killed_at is null)
    or (status = 'READY' and approval_id is not null and approved_at is not null and started_at is null and completed_at is null and killed_at is null)
    or (status = 'RUNNING' and approval_id is not null and approved_at is not null and started_at is not null and completed_at is null and killed_at is null)
    or (status = 'COMPLETED' and approval_id is not null and approved_at is not null and started_at is not null and completed_at is not null and killed_at is null)
    or (status = 'KILLED' and killed_at is not null)
  )
);

create unique index recovery_one_active_experiment_per_campaign
on public.recovery_experiments (organization_id, campaign_id)
where status in ('READY', 'RUNNING');

create or replace function app.capture_commercial_stage_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  event_evidence_class public.evidence_class;
begin
  if new.stage = old.stage then return new; end if;
  select case when a.evidence_class = 'synthetic_demo' then 'synthetic_demo'::public.evidence_class else 'live'::public.evidence_class end
  into event_evidence_class
  from public.accounts a
  where a.organization_id = new.organization_id and a.id = new.account_id;
  insert into public.commercial_stage_events (
    organization_id, opportunity_id, from_stage, to_stage, evidence_class, changed_by, changed_at
  ) values (
    new.organization_id, new.id, old.stage, new.stage,
    coalesce(event_evidence_class, 'live'), auth.uid(), now()
  );
  return new;
end;
$$;

create trigger opportunities_stage_event
after update of stage on public.opportunities
for each row execute function app.capture_commercial_stage_event();

create or replace function app.prevent_monthly_evidence_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'MONTHLY_EVIDENCE_APPEND_ONLY';
end;
$$;

create trigger commercial_stage_events_append_only
before update or delete on public.commercial_stage_events
for each row execute function app.prevent_monthly_evidence_mutation();
create trigger campaign_operation_days_append_only
before update or delete on public.campaign_operation_days
for each row execute function app.prevent_monthly_evidence_mutation();
create trigger reporting_calendar_days_append_only
before update or delete on public.reporting_calendar_days
for each row execute function app.prevent_monthly_evidence_mutation();
create trigger contractual_monthly_reports_append_only
before update or delete on public.contractual_monthly_reports
for each row execute function app.prevent_monthly_evidence_mutation();
create trigger contractual_report_items_append_only
before update or delete on public.contractual_report_items
for each row execute function app.prevent_monthly_evidence_mutation();
create trigger contractual_report_issuances_append_only
before update or delete on public.contractual_report_issuances
for each row execute function app.prevent_monthly_evidence_mutation();

create or replace function app.enforce_operation_day_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.observed_on > current_date then raise exception 'OPERATION_DAY_IN_FUTURE'; end if;
  if not exists (
    select 1 from public.organization_users ou
    where ou.organization_id = new.organization_id
      and ou.user_id = new.recorded_by
      and ou.active
      and ou.role in ('teckel_admin', 'teckel_operator')
  ) then raise exception 'OPERATION_DAY_RECORDER_INVALID'; end if;
  return new;
end;
$$;

create trigger campaign_operation_days_integrity
before insert on public.campaign_operation_days
for each row execute function app.enforce_operation_day_integrity();

create or replace function app.enforce_reporting_calendar_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.organization_users ou
    where ou.organization_id = new.organization_id
      and ou.user_id = new.recorded_by
      and ou.active and ou.role in ('teckel_admin', 'teckel_operator')
  ) then raise exception 'REPORTING_CALENDAR_RECORDER_INVALID'; end if;
  return new;
end;
$$;

create trigger reporting_calendar_days_integrity
before insert on public.reporting_calendar_days
for each row execute function app.enforce_reporting_calendar_integrity();

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
  if actor_id is not null and new.decided_by <> actor_id then raise exception 'APPROVAL_ACTOR_MISMATCH'; end if;
  if new.subject_type in (
    'campaign_first_send_release', 'rollout_wave_release',
    'contractual_monthly_report_issue', 'recovery_experiment_release'
  ) and (
    actor_id is null
    or not app.has_role(new.organization_id, array['teckel_admin'::public.user_role])
  ) then raise exception 'CONTROLLED_RELEASE_APPROVAL_JORGE_ONLY'; end if;
  return new;
end;
$$;

create or replace function app.generate_contractual_monthly_report(
  target_organization_id uuid,
  target_campaign_id uuid,
  target_period_start date,
  target_source_evidence_sha256 text,
  target_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  period_end_value date;
  expected_days integer;
  observed_days integer;
  business_calendar_days integer;
  report_due_value date;
  delivered_ids uuid[];
  reply_ids uuid[];
  positive_reply_ids uuid[];
  email_lead_ids uuid[];
  prequote_lead_ids uuid[];
  meeting_ids uuid[];
  qualified_event_ids uuid[];
  proposal_ids uuid[];
  won_event_ids uuid[];
  payment_ids uuid[];
  sla_task_ids uuid[];
  payment_total numeric(18,2);
  snapshot_payload jsonb;
  snapshot_hash text;
  created_report_id uuid;
  existing_report public.contractual_monthly_reports%rowtype;
begin
  if coalesce(nullif(current_setting('role', true), 'none'), session_user) not in ('service_role', 'supabase_admin') then
    raise exception 'MONTHLY_REPORT_SERVICE_ONLY';
  end if;
  if extract(day from target_period_start) <> 1 then raise exception 'MONTHLY_REPORT_START_NOT_MONTH_BOUNDARY'; end if;
  period_end_value := (target_period_start + interval '1 month')::date;
  if period_end_value > current_date then raise exception 'MONTHLY_REPORT_PERIOD_NOT_COMPLETE'; end if;
  if target_source_evidence_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'MONTHLY_REPORT_EVIDENCE_INVALID'; end if;
  if not exists (
    select 1 from public.organization_users ou
    where ou.organization_id = target_organization_id and ou.user_id = target_created_by
      and ou.active and ou.role = 'teckel_admin'
  ) then raise exception 'MONTHLY_REPORT_CREATOR_INVALID'; end if;
  if not exists (
    select 1 from public.campaigns c
    where c.organization_id = target_organization_id and c.id = target_campaign_id
  ) then raise exception 'MONTHLY_REPORT_CAMPAIGN_NOT_FOUND'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'monthly-report:' || target_organization_id::text || ':' || target_campaign_id::text || ':' || target_period_start::text, 0
  ));
  select * into existing_report
  from public.contractual_monthly_reports r
  where r.organization_id = target_organization_id
    and r.campaign_id = target_campaign_id
    and r.period_start = target_period_start;
  if found then
    if existing_report.source_evidence_sha256 <> target_source_evidence_sha256 then
      raise exception 'MONTHLY_REPORT_EXISTING_EVIDENCE_DRIFT';
    end if;
    return existing_report.id;
  end if;
  expected_days := period_end_value - target_period_start;
  select count(*) into observed_days
  from public.campaign_operation_days d
  where d.organization_id = target_organization_id
    and d.campaign_id = target_campaign_id
    and d.observed_on >= target_period_start
    and d.observed_on < period_end_value
    and d.status = 'OPERATING'
    and d.evidence_class = 'live';
  if observed_days <> expected_days then raise exception 'MONTHLY_REPORT_OPERATION_DAYS_INCOMPLETE'; end if;

  select count(*), max(calendar_date)
  into business_calendar_days, report_due_value
  from (
    select calendar_date
    from public.reporting_calendar_days d
    where d.organization_id = target_organization_id
      and d.jurisdiction = 'MX' and d.evidence_class = 'live' and d.is_business_day
      and d.calendar_date >= period_end_value
    order by d.calendar_date
    limit 3
  ) first_three_business_days;
  if business_calendar_days <> 3 then raise exception 'MONTHLY_REPORT_BUSINESS_CALENDAR_INCOMPLETE'; end if;

  select coalesce(array_agg(m.id order by m.sent_at, m.id), '{}'::uuid[])
  into delivered_ids
  from public.messages m
  join public.campaign_enrollments ce on ce.organization_id = m.organization_id and ce.id = m.enrollment_id
  where m.organization_id = target_organization_id and ce.campaign_id = target_campaign_id
    and m.direction = 'OUTBOUND' and m.status = 'DELIVERED'
    and m.sent_at >= target_period_start::timestamptz and m.sent_at < period_end_value::timestamptz
    and m.provider_message_id is not null;

  select
    coalesce(array_agg(pe.id order by pe.observed_at, pe.id) filter (where pe.reply_classification in ('POSITIVE', 'NEUTRAL', 'NEGATIVE')), '{}'::uuid[]),
    coalesce(array_agg(pe.id order by pe.observed_at, pe.id) filter (where pe.reply_classification = 'POSITIVE'), '{}'::uuid[])
  into reply_ids, positive_reply_ids
  from public.provider_events pe
  join public.messages m on m.organization_id = pe.organization_id and m.id = pe.message_id
  join public.campaign_enrollments ce on ce.organization_id = m.organization_id and ce.id = m.enrollment_id
  where pe.organization_id = target_organization_id and ce.campaign_id = target_campaign_id
    and pe.event_kind = 'REPLY' and pe.processing_status = 'PROCESSED'
    and pe.observed_at >= target_period_start::timestamptz and pe.observed_at < period_end_value::timestamptz;

  select coalesce(array_agg(l.id order by qc.evaluated_at, l.id), '{}'::uuid[])
  into email_lead_ids
  from public.leads l
  join public.qualification_checks qc on qc.organization_id = l.organization_id and qc.lead_id = l.id
  join public.messages m on m.organization_id = l.organization_id and m.id = l.origin_message_id
  join public.campaign_enrollments ce on ce.organization_id = m.organization_id and ce.id = m.enrollment_id
  where l.organization_id = target_organization_id and ce.campaign_id = target_campaign_id
    and l.status = 'QUALIFIED' and l.contractual_qualified and l.evidence_class = 'live'
    and qc.evaluated_at >= target_period_start::timestamptz and qc.evaluated_at < period_end_value::timestamptz
    and qc.industrial_over_100_kwp and qc.outside_annex_a and qc.verified_target_role
    and (qc.explicit_interest or coalesce(qc.monthly_spend_mxn, 0) > 20000)
    and cardinality(qc.evidence_record_ids) > 0;

  select coalesce(array_agg(l.id order by qc.evaluated_at, l.id), '{}'::uuid[])
  into prequote_lead_ids
  from public.leads l
  join public.qualification_checks qc on qc.organization_id = l.organization_id and qc.lead_id = l.id
  where l.organization_id = target_organization_id and l.prequote_id is not null and l.origin_message_id is null
    and l.status = 'QUALIFIED' and l.contractual_qualified and l.evidence_class = 'live'
    and qc.evaluated_at >= target_period_start::timestamptz and qc.evaluated_at < period_end_value::timestamptz
    and qc.industrial_over_100_kwp and qc.outside_annex_a and qc.verified_target_role
    and (qc.explicit_interest or coalesce(qc.monthly_spend_mxn, 0) > 20000)
    and cardinality(qc.evidence_record_ids) > 0;

  select coalesce(array_agg(distinct mt.id order by mt.id), '{}'::uuid[])
  into meeting_ids
  from public.meetings mt
  join public.opportunities o on o.organization_id = mt.organization_id and o.id = mt.opportunity_id
  join public.leads l on l.organization_id = o.organization_id and l.id = o.lead_id
  where mt.organization_id = target_organization_id and l.contractual_qualified and l.evidence_class = 'live'
    and mt.attendance_verified and mt.held_at >= target_period_start::timestamptz and mt.held_at < period_end_value::timestamptz;

  select coalesce(array_agg(distinct se.id order by se.id), '{}'::uuid[])
  into qualified_event_ids
  from public.commercial_stage_events se
  join public.opportunities o on o.organization_id = se.organization_id and o.id = se.opportunity_id
  join public.leads l on l.organization_id = o.organization_id and l.id = o.lead_id
  where se.organization_id = target_organization_id and se.to_stage = 'QUALIFIED' and se.evidence_class = 'live'
    and l.contractual_qualified and se.changed_at >= target_period_start::timestamptz and se.changed_at < period_end_value::timestamptz;

  select coalesce(array_agg(distinct p.id order by p.id), '{}'::uuid[])
  into proposal_ids
  from public.proposals p
  join public.opportunities o on o.organization_id = p.organization_id and o.id = p.opportunity_id
  join public.leads l on l.organization_id = o.organization_id and l.id = o.lead_id
  where p.organization_id = target_organization_id and l.contractual_qualified and l.evidence_class = 'live'
    and p.delivered_at >= target_period_start::timestamptz and p.delivered_at < period_end_value::timestamptz;

  select coalesce(array_agg(distinct se.id order by se.id), '{}'::uuid[])
  into won_event_ids
  from public.commercial_stage_events se
  join public.opportunities o on o.organization_id = se.organization_id and o.id = se.opportunity_id
  join public.leads l on l.organization_id = o.organization_id and l.id = o.lead_id
  where se.organization_id = target_organization_id and se.to_stage = 'CLOSED_WON' and se.evidence_class = 'live'
    and l.contractual_qualified and se.changed_at >= target_period_start::timestamptz and se.changed_at < period_end_value::timestamptz;

  select coalesce(array_agg(distinct p.id order by p.id), '{}'::uuid[]), coalesce(sum(p.amount_mxn), 0)
  into payment_ids, payment_total
  from public.payments p
  join public.opportunities o on o.organization_id = p.organization_id and o.id = p.opportunity_id
  join public.leads l on l.organization_id = o.organization_id and l.id = o.lead_id
  where p.organization_id = target_organization_id and p.is_first_payment
    and l.contractual_qualified and l.evidence_class = 'live'
    and p.paid_at >= target_period_start::timestamptz and p.paid_at < period_end_value::timestamptz;

  select coalesce(array_agg(t.id order by t.due_at, t.id), '{}'::uuid[])
  into sla_task_ids
  from public.tasks t
  where t.organization_id = target_organization_id and t.task_type = 'REPLY_FOLLOW_UP'
    and t.created_at >= target_period_start::timestamptz and t.created_at < period_end_value::timestamptz
    and (t.completed_at is null or t.completed_at > t.due_at);

  if cardinality(reply_ids) > cardinality(delivered_ids)
    or cardinality(positive_reply_ids) > cardinality(reply_ids)
    or cardinality(email_lead_ids) > cardinality(positive_reply_ids)
    or cardinality(meeting_ids) > cardinality(email_lead_ids) + cardinality(prequote_lead_ids)
    or cardinality(qualified_event_ids) > cardinality(meeting_ids)
    or cardinality(proposal_ids) > cardinality(qualified_event_ids)
    or cardinality(won_event_ids) > cardinality(proposal_ids)
  then raise exception 'MONTHLY_REPORT_FUNNEL_INVARIANT_FAILED'; end if;

  snapshot_payload := jsonb_build_object(
    'organization_id', target_organization_id, 'campaign_id', target_campaign_id,
    'period_start', target_period_start, 'period_end_exclusive', period_end_value,
    'report_due_on', report_due_value, 'generated_on', current_date,
    'generated_on_time', current_date <= report_due_value,
    'operational_days', expected_days,
    'delivered_ids', delivered_ids, 'reply_ids', reply_ids, 'positive_reply_ids', positive_reply_ids,
    'email_lead_ids', email_lead_ids, 'prequote_lead_ids', prequote_lead_ids,
    'meeting_ids', meeting_ids, 'qualified_event_ids', qualified_event_ids,
    'proposal_ids', proposal_ids, 'won_event_ids', won_event_ids,
    'payment_ids', payment_ids, 'payment_total', payment_total,
    'sla_task_ids', sla_task_ids, 'source_evidence_sha256', target_source_evidence_sha256
  );
  snapshot_hash := encode(digest(snapshot_payload::text, 'sha256'), 'hex');

  insert into public.contractual_monthly_reports (
    organization_id, campaign_id, period_start, period_end_exclusive,
    report_due_on, generated_on, generated_on_time, evidence_class,
    operational_days, delivered_messages, substantive_replies, positive_replies,
    email_strict_leads, prequote_strict_leads, held_meetings, qualified_opportunities,
    delivered_proposals, closed_won, first_payments_mxn, client_sla_breaches,
    source_evidence_sha256, snapshot_sha256, created_by
  ) values (
    target_organization_id, target_campaign_id, target_period_start, period_end_value,
    report_due_value, current_date, current_date <= report_due_value, 'live',
    expected_days, cardinality(delivered_ids), cardinality(reply_ids), cardinality(positive_reply_ids),
    cardinality(email_lead_ids), cardinality(prequote_lead_ids), cardinality(meeting_ids), cardinality(qualified_event_ids),
    cardinality(proposal_ids), cardinality(won_event_ids), payment_total, cardinality(sla_task_ids),
    target_source_evidence_sha256, snapshot_hash, target_created_by
  ) returning id into created_report_id;

  insert into public.contractual_report_items (organization_id, report_id, item_kind, record_id, occurred_at, evidence_sha256)
  select target_organization_id, created_report_id, 'DELIVERED_MESSAGE'::public.contractual_report_item_kind, m.id, m.sent_at, target_source_evidence_sha256
  from public.messages m where m.id = any(delivered_ids)
  union all
  select target_organization_id, created_report_id, 'SUBSTANTIVE_REPLY'::public.contractual_report_item_kind, pe.id, pe.observed_at, target_source_evidence_sha256
  from public.provider_events pe where pe.id = any(reply_ids)
  union all
  select target_organization_id, created_report_id, 'POSITIVE_REPLY'::public.contractual_report_item_kind, pe.id, pe.observed_at, target_source_evidence_sha256
  from public.provider_events pe where pe.id = any(positive_reply_ids)
  union all
  select target_organization_id, created_report_id, 'EMAIL_STRICT_LEAD'::public.contractual_report_item_kind, l.id, qc.evaluated_at, target_source_evidence_sha256
  from public.leads l join public.qualification_checks qc on qc.lead_id = l.id where l.id = any(email_lead_ids)
  union all
  select target_organization_id, created_report_id, 'PREQUOTE_STRICT_LEAD'::public.contractual_report_item_kind, l.id, qc.evaluated_at, target_source_evidence_sha256
  from public.leads l join public.qualification_checks qc on qc.lead_id = l.id where l.id = any(prequote_lead_ids)
  union all
  select target_organization_id, created_report_id, 'HELD_MEETING'::public.contractual_report_item_kind, mt.id, mt.held_at, target_source_evidence_sha256
  from public.meetings mt where mt.id = any(meeting_ids)
  union all
  select target_organization_id, created_report_id, 'QUALIFIED_OPPORTUNITY'::public.contractual_report_item_kind, se.id, se.changed_at, target_source_evidence_sha256
  from public.commercial_stage_events se where se.id = any(qualified_event_ids)
  union all
  select target_organization_id, created_report_id, 'DELIVERED_PROPOSAL'::public.contractual_report_item_kind, p.id, p.delivered_at, target_source_evidence_sha256
  from public.proposals p where p.id = any(proposal_ids)
  union all
  select target_organization_id, created_report_id, 'CLOSED_WON'::public.contractual_report_item_kind, se.id, se.changed_at, target_source_evidence_sha256
  from public.commercial_stage_events se where se.id = any(won_event_ids)
  union all
  select target_organization_id, created_report_id, 'FIRST_PAYMENT'::public.contractual_report_item_kind, p.id, p.paid_at, target_source_evidence_sha256
  from public.payments p where p.id = any(payment_ids)
  union all
  select target_organization_id, created_report_id, 'CLIENT_SLA_BREACH'::public.contractual_report_item_kind, t.id, t.due_at, target_source_evidence_sha256
  from public.tasks t where t.id = any(sla_task_ids);

  return created_report_id;
end;
$$;

create or replace function app.issue_contractual_monthly_report(target_report_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  report_record public.contractual_monthly_reports%rowtype;
  approval_record public.approvals%rowtype;
  issuance_id uuid;
begin
  if coalesce(nullif(current_setting('role', true), 'none'), session_user) not in ('service_role', 'supabase_admin') then
    raise exception 'MONTHLY_REPORT_ISSUE_SERVICE_ONLY';
  end if;
  select * into report_record from public.contractual_monthly_reports where id = target_report_id;
  if not found then raise exception 'MONTHLY_REPORT_NOT_FOUND'; end if;
  select id into issuance_id
  from public.contractual_report_issuances
  where organization_id = report_record.organization_id and report_id = report_record.id;
  if found then return issuance_id; end if;
  select ap.* into approval_record
  from public.approvals ap
  join public.organization_users ou on ou.organization_id = ap.organization_id and ou.user_id = ap.decided_by
  where ap.organization_id = report_record.organization_id
    and ap.subject_type = 'contractual_monthly_report_issue'
    and ap.subject_id = report_record.id
    and ap.subject_sha256 = report_record.snapshot_sha256
    and ap.decision = 'APPROVED'
    and ou.active and ou.role = 'teckel_admin'
  order by ap.decided_at desc limit 1;
  if not found then raise exception 'MONTHLY_REPORT_APPROVAL_REQUIRED'; end if;
  insert into public.contractual_report_issuances (
    organization_id, report_id, approval_id, snapshot_sha256, issued_by
  ) values (
    report_record.organization_id, report_record.id, approval_record.id,
    report_record.snapshot_sha256, approval_record.decided_by
  ) returning id into issuance_id;
  return issuance_id;
end;
$$;

create or replace function app.create_recovery_experiment(
  target_report_id uuid,
  target_variable public.recovery_variable,
  target_hypothesis_code text,
  target_sample_size integer,
  target_baseline_evidence_sha256 text,
  target_created_by uuid,
  target_denominators_verified boolean,
  target_deliverability_verified boolean,
  target_contact_quality_verified boolean,
  target_client_response_sla_verified boolean,
  target_best_segment_identified boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  report_record public.contractual_monthly_reports%rowtype;
  created_id uuid;
begin
  if coalesce(nullif(current_setting('role', true), 'none'), session_user) not in ('service_role', 'supabase_admin') then
    raise exception 'RECOVERY_EXPERIMENT_SERVICE_ONLY';
  end if;
  select * into report_record from public.contractual_monthly_reports where id = target_report_id;
  if not found then raise exception 'RECOVERY_REPORT_NOT_FOUND'; end if;
  if report_record.target_met then raise exception 'RECOVERY_NOT_ALLOWED_WHEN_TARGET_MET'; end if;
  if not exists (
    select 1 from public.contractual_report_issuances i
    where i.organization_id = report_record.organization_id and i.report_id = report_record.id
  ) then raise exception 'RECOVERY_REQUIRES_ISSUED_REPORT'; end if;
  if not (
    target_denominators_verified and target_deliverability_verified and target_contact_quality_verified
    and target_client_response_sla_verified and target_best_segment_identified
  ) then raise exception 'RECOVERY_DIAGNOSTIC_ORDER_INCOMPLETE'; end if;
  if target_hypothesis_code !~ '^[A-Z0-9_]{3,64}$' or target_sample_size not between 5 and 100
    or target_baseline_evidence_sha256 !~ '^[a-f0-9]{64}$'
  then raise exception 'RECOVERY_EXPERIMENT_INPUT_INVALID'; end if;
  if not exists (
    select 1 from public.organization_users ou
    where ou.organization_id = report_record.organization_id and ou.user_id = target_created_by
      and ou.active and ou.role = 'teckel_admin'
  ) then raise exception 'RECOVERY_CREATOR_INVALID'; end if;
  if exists (
    select 1 from public.recovery_experiments e
    where e.organization_id = report_record.organization_id and e.campaign_id = report_record.campaign_id
      and e.status in ('READY', 'RUNNING')
  ) then raise exception 'RECOVERY_ACTIVE_EXPERIMENT_EXISTS'; end if;

  insert into public.recovery_experiments (
    organization_id, campaign_id, report_id, variable, hypothesis_code, sample_size,
    baseline_evidence_sha256, denominators_verified, deliverability_verified,
    contact_quality_verified, client_response_sla_verified, best_segment_identified, created_by
  ) values (
    report_record.organization_id, report_record.campaign_id, report_record.id,
    target_variable, target_hypothesis_code, target_sample_size, target_baseline_evidence_sha256,
    true, true, true, true, true, target_created_by
  ) returning id into created_id;
  return created_id;
end;
$$;

create or replace function app.release_recovery_experiment(target_experiment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  experiment_record public.recovery_experiments%rowtype;
  approval_record public.approvals%rowtype;
begin
  if coalesce(nullif(current_setting('role', true), 'none'), session_user) not in ('service_role', 'supabase_admin') then
    raise exception 'RECOVERY_RELEASE_SERVICE_ONLY';
  end if;
  select * into experiment_record from public.recovery_experiments where id = target_experiment_id for update;
  if not found then raise exception 'RECOVERY_EXPERIMENT_NOT_FOUND'; end if;
  if experiment_record.status = 'READY' then return experiment_record.id; end if;
  if experiment_record.status <> 'DRAFT' then raise exception 'RECOVERY_EXPERIMENT_NOT_DRAFT'; end if;
  select ap.* into approval_record
  from public.approvals ap
  join public.organization_users ou on ou.organization_id = ap.organization_id and ou.user_id = ap.decided_by
  where ap.organization_id = experiment_record.organization_id
    and ap.subject_type = 'recovery_experiment_release'
    and ap.subject_id = experiment_record.id
    and ap.subject_sha256 = experiment_record.baseline_evidence_sha256
    and ap.decision = 'APPROVED' and ou.active and ou.role = 'teckel_admin'
  order by ap.decided_at desc limit 1;
  if not found then raise exception 'RECOVERY_APPROVAL_REQUIRED'; end if;
  update public.recovery_experiments
  set status = 'READY', approval_id = approval_record.id,
      approved_by = approval_record.decided_by, approved_at = approval_record.decided_at
  where id = experiment_record.id;
  return experiment_record.id;
end;
$$;

create or replace function app.capture_monthly_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  source_data jsonb;
  safe_old jsonb;
  safe_new jsonb;
  org_id uuid;
  row_id uuid;
begin
  source_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  org_id := nullif(source_data ->> 'organization_id', '')::uuid;
  row_id := nullif(source_data ->> 'id', '')::uuid;
  if tg_op in ('UPDATE', 'DELETE') then
    safe_old := jsonb_strip_nulls(to_jsonb(old) - array['created_at', 'updated_at']);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    safe_new := jsonb_strip_nulls(to_jsonb(new) - array['created_at', 'updated_at']);
  end if;
  insert into public.audit_log (organization_id, actor_user_id, action, record_type, record_id, old_data, new_data)
  values (
    org_id, auth.uid(), tg_op, tg_table_name, row_id, safe_old, safe_new
  );
  return coalesce(new, old);
end;
$$;

create trigger commercial_stage_events_audit after insert or update or delete on public.commercial_stage_events
for each row execute function app.capture_monthly_audit();
create trigger campaign_operation_days_audit after insert or update or delete on public.campaign_operation_days
for each row execute function app.capture_monthly_audit();
create trigger reporting_calendar_days_audit after insert or update or delete on public.reporting_calendar_days
for each row execute function app.capture_monthly_audit();
create trigger contractual_monthly_reports_audit after insert or update or delete on public.contractual_monthly_reports
for each row execute function app.capture_monthly_audit();
create trigger contractual_report_items_audit after insert or update or delete on public.contractual_report_items
for each row execute function app.capture_monthly_audit();
create trigger contractual_report_issuances_audit after insert or update or delete on public.contractual_report_issuances
for each row execute function app.capture_monthly_audit();
create trigger recovery_experiments_audit after insert or update or delete on public.recovery_experiments
for each row execute function app.capture_monthly_audit();

alter table public.commercial_stage_events enable row level security;
alter table public.campaign_operation_days enable row level security;
alter table public.reporting_calendar_days enable row level security;
alter table public.contractual_monthly_reports enable row level security;
alter table public.contractual_report_items enable row level security;
alter table public.contractual_report_issuances enable row level security;
alter table public.recovery_experiments enable row level security;

create policy commercial_stage_events_member_read on public.commercial_stage_events for select using (app.is_member(organization_id));
create policy campaign_operation_days_member_read on public.campaign_operation_days for select using (app.is_member(organization_id));
create policy reporting_calendar_days_member_read on public.reporting_calendar_days for select using (app.is_member(organization_id));
create policy contractual_monthly_reports_member_read on public.contractual_monthly_reports for select using (app.is_member(organization_id));
create policy contractual_report_items_member_read on public.contractual_report_items for select using (app.is_member(organization_id));
create policy contractual_report_issuances_member_read on public.contractual_report_issuances for select using (app.is_member(organization_id));
create policy recovery_experiments_member_read on public.recovery_experiments for select using (app.is_member(organization_id));

revoke all on table public.commercial_stage_events, public.campaign_operation_days, public.reporting_calendar_days, public.contractual_monthly_reports,
  public.contractual_report_items, public.contractual_report_issuances, public.recovery_experiments from public;
revoke all on function app.generate_contractual_monthly_report(uuid, uuid, date, text, uuid) from public;
revoke all on function app.issue_contractual_monthly_report(uuid) from public;
revoke all on function app.create_recovery_experiment(uuid, public.recovery_variable, text, integer, text, uuid, boolean, boolean, boolean, boolean, boolean) from public;
revoke all on function app.release_recovery_experiment(uuid) from public;

do $grant_roles$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on public.commercial_stage_events, public.campaign_operation_days, public.reporting_calendar_days, public.contractual_monthly_reports,
      public.contractual_report_items, public.contractual_report_issuances, public.recovery_experiments to authenticated;
    revoke insert, update, delete, truncate on public.commercial_stage_events, public.campaign_operation_days, public.reporting_calendar_days,
      public.contractual_monthly_reports, public.contractual_report_items, public.contractual_report_issuances,
      public.recovery_experiments from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on public.commercial_stage_events, public.campaign_operation_days, public.reporting_calendar_days, public.contractual_monthly_reports,
      public.contractual_report_items, public.contractual_report_issuances, public.recovery_experiments to service_role;
    grant insert on public.campaign_operation_days, public.reporting_calendar_days to service_role;
    revoke insert, update, delete, truncate on public.commercial_stage_events, public.contractual_monthly_reports,
      public.contractual_report_items, public.contractual_report_issuances, public.recovery_experiments from service_role;
    revoke update, delete, truncate on public.campaign_operation_days, public.reporting_calendar_days from service_role;
    grant execute on function app.generate_contractual_monthly_report(uuid, uuid, date, text, uuid) to service_role;
    grant execute on function app.issue_contractual_monthly_report(uuid) to service_role;
    grant execute on function app.create_recovery_experiment(uuid, public.recovery_variable, text, integer, text, uuid, boolean, boolean, boolean, boolean, boolean) to service_role;
    grant execute on function app.release_recovery_experiment(uuid) to service_role;
  end if;
end;
$grant_roles$;

commit;
