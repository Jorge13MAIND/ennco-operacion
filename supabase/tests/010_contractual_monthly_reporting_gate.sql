\set ON_ERROR_STOP on

insert into public.organizations (id, slug, legal_name) values
  ('a1000000-0000-4000-8000-000000000001', 'm8-org', 'M8 Synthetic Organization');

insert into public.organization_users (organization_id, user_id, role) values
  ('a1000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000009', 'teckel_admin'),
  ('a1000000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000008', 'ennco_operator');

insert into public.runtime_controls (organization_id, global_kill_switch, external_send_allowed) values
  ('a1000000-0000-4000-8000-000000000001', true, false);

insert into public.campaigns (
  id, organization_id, name, status, manifest_json, manifest_sha256,
  suppression_snapshot_at, shadow_canary_decision, approved_by, approved_at
) values (
  'a2000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000001',
  'M8 synthetic reporting campaign', 'ACTIVE', '{}', repeat('a', 64),
  now(), 'PASS', 'a9000000-0000-4000-8000-000000000009', now()
);

insert into public.sequence_versions (
  id, organization_id, campaign_id, version, sender_name, sender_title,
  content_sha256, approved_by, approved_at
) values (
  'a3000000-0000-4000-8000-000000000003',
  'a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000002',
  1, 'Francisco', 'CEO', repeat('b', 64),
  'a9000000-0000-4000-8000-000000000009', now()
);

insert into public.mailboxes (
  id, organization_id, normalized_email, domain, sender_name,
  domain_ready_at, auth_spf, auth_dkim, auth_dmarc, auth_tls, health_status, kill_switch
) values (
  'a4000000-0000-4000-8000-000000000004',
  'a1000000-0000-4000-8000-000000000001',
  'francisco@m8.invalid', 'm8.invalid', 'Francisco', now() - interval '40 days',
  true, true, true, true, 'HEALTHY', false
);

create temporary table m8_entities (
  row_number integer primary key,
  account_id uuid not null,
  contact_id uuid not null,
  enrollment_id uuid not null,
  message_id uuid not null,
  lead_id uuid
);

insert into m8_entities
select
  number_value,
  md5('m8-account-' || number_value)::uuid,
  md5('m8-contact-' || number_value)::uuid,
  md5('m8-enrollment-' || number_value)::uuid,
  md5('m8-message-' || number_value)::uuid,
  case when number_value <= 2 then md5('m8-lead-' || number_value)::uuid else null end
from generate_series(1, 5) values_list(number_value);

insert into public.accounts (
  id, organization_id, legal_name, normalized_name, primary_domain,
  state, sector, tier, evidence_class, source_confidence
)
select account_id, 'a1000000-0000-4000-8000-000000000001',
  'M8 Synthetic Account ' || row_number, 'm8 synthetic account ' || row_number,
  'account-' || row_number || '.m8.invalid', 'Guanajuato', 'Industrial', 1, 'live', 'VERIFIED'
from m8_entities;

insert into public.contacts (
  id, organization_id, account_id, full_name, role_title, normalized_email,
  verified, verified_at, source_confidence
)
select contact_id, 'a1000000-0000-4000-8000-000000000001', account_id,
  'M8 Synthetic Contact ' || row_number, 'CEO',
  'contact-' || row_number || '@m8.invalid', true, '2026-06-01T12:00:00Z', 'VERIFIED'
from m8_entities;

insert into public.campaign_enrollments (
  id, organization_id, campaign_id, sequence_version_id, account_id, contact_id,
  mailbox_id, status, next_touch_number
)
select enrollment_id, 'a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000002',
  'a3000000-0000-4000-8000-000000000003', account_id, contact_id,
  'a4000000-0000-4000-8000-000000000004', 'COMPLETED', 1
from m8_entities;

alter table public.messages disable trigger messages_scaled_release_gate;
insert into public.messages (
  id, organization_id, enrollment_id, mailbox_id, contact_id, direction, status,
  touch_number, normalized_to, normalized_from, subject, body_text,
  idempotency_key, provider_message_id, correlation_id, sent_at, created_at
)
select message_id, 'a1000000-0000-4000-8000-000000000001', enrollment_id,
  'a4000000-0000-4000-8000-000000000004', contact_id, 'OUTBOUND', 'DELIVERED', 1,
  'contact-' || row_number || '@m8.invalid', 'francisco@m8.invalid',
  'M8 synthetic subject', 'M8 synthetic body', 'm8-message-' || row_number,
  'm8-provider-' || row_number, md5('m8-correlation-' || row_number)::uuid,
  ('2026-07-' || lpad((row_number + 1)::text, 2, '0') || 'T16:00:00Z')::timestamptz,
  ('2026-07-' || lpad((row_number + 1)::text, 2, '0') || 'T16:00:00Z')::timestamptz
from m8_entities;
alter table public.messages enable trigger messages_scaled_release_gate;

insert into public.provider_events (
  id, organization_id, source, source_record_type, external_event_id, message_id,
  payload_json, observed_at, processed_at, event_kind, reply_classification,
  correlation_id, processing_status
)
select md5('m8-reply-' || row_number)::uuid,
  'a1000000-0000-4000-8000-000000000001', 'gmail', 'message',
  'm8-reply-event-' || row_number, message_id, '{}',
  ('2026-07-' || lpad((row_number + 5)::text, 2, '0') || 'T16:00:00Z')::timestamptz,
  ('2026-07-' || lpad((row_number + 5)::text, 2, '0') || 'T16:01:00Z')::timestamptz,
  'REPLY', 'POSITIVE', md5('m8-reply-correlation-' || row_number)::uuid, 'PROCESSED'
from m8_entities where row_number <= 2;

insert into public.leads (
  id, organization_id, account_id, contact_id, origin_message_id,
  status, contractual_qualified, evidence_class, created_at
)
select lead_id, 'a1000000-0000-4000-8000-000000000001', account_id, contact_id,
  message_id, 'CAPTURED', false, 'live',
  ('2026-07-' || lpad((row_number + 5)::text, 2, '0') || 'T16:02:00Z')::timestamptz
from m8_entities where row_number <= 2;

insert into public.qualification_checks (
  organization_id, lead_id, industrial_over_100_kwp, outside_annex_a,
  verified_target_role, explicit_interest, monthly_spend_mxn,
  evidence_record_ids, evaluated_by, evaluated_at
)
select 'a1000000-0000-4000-8000-000000000001', lead_id,
  true, true, true, true, 25000,
  array[md5('m8-lead-evidence-' || row_number)::uuid],
  'a8000000-0000-4000-8000-000000000008',
  ('2026-07-' || lpad((row_number + 6)::text, 2, '0') || 'T16:00:00Z')::timestamptz
from m8_entities where row_number <= 2;

update public.leads
set status = 'QUALIFIED', contractual_qualified = true, qualification_reason = 'STRICT_EVIDENCE_VERIFIED'
where organization_id = 'a1000000-0000-4000-8000-000000000001';

insert into public.opportunities (
  id, organization_id, account_id, lead_id, stage, economic_buyer, active_pain,
  business_impact, timing_under_90_days, value_mxn, next_action, next_action_at
)
select 'a5000000-0000-4000-8000-000000000005',
  'a1000000-0000-4000-8000-000000000001', account_id, lead_id,
  'PROSPECTING', true, true, true, true, 1000000, 'Synthetic next action', now() + interval '1 day'
from m8_entities where row_number = 1;

update public.opportunities set stage = 'CONVERSATION' where id = 'a5000000-0000-4000-8000-000000000005';
update public.opportunities set stage = 'MEETING_CONFIRMED' where id = 'a5000000-0000-4000-8000-000000000005';
update public.opportunities set stage = 'DISCOVERY_HELD' where id = 'a5000000-0000-4000-8000-000000000005';
update public.opportunities set stage = 'QUALIFIED' where id = 'a5000000-0000-4000-8000-000000000005';

insert into public.commercial_stage_events (
  organization_id, opportunity_id, from_stage, to_stage, evidence_class, changed_by, changed_at
) values (
  'a1000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000005',
  'DISCOVERY_HELD', 'QUALIFIED', 'live',
  'a8000000-0000-4000-8000-000000000008', '2026-07-15T16:00:00Z'
);

insert into public.meetings (
  id, organization_id, opportunity_id, scheduled_at, held_at, attendance_verified, outcome_notes
) values (
  'a6000000-0000-4000-8000-000000000006',
  'a1000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000005',
  '2026-07-14T16:00:00Z', '2026-07-14T16:00:00Z', true, 'Synthetic held meeting'
);

insert into public.proposals (
  id, organization_id, opportunity_id, version, value_mxn, delivered_at
) values (
  'a7000000-0000-4000-8000-000000000007',
  'a1000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000005', 'M8-SYNTHETIC-1', 1000000, '2026-07-20T16:00:00Z'
);

insert into public.payments (
  id, organization_id, opportunity_id, amount_mxn, paid_at, is_first_payment, evidence_record_id
) values (
  'aa000000-0000-4000-8000-00000000000a',
  'a1000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000005', 100000, '2026-07-25T16:00:00Z', true,
  'ab000000-0000-4000-8000-00000000000b'
);

insert into public.tasks (
  id, organization_id, account_id, contact_id, task_type, normalized_objective,
  due_at, status, created_at
)
select 'ac000000-0000-4000-8000-00000000000c',
  'a1000000-0000-4000-8000-000000000001', account_id, contact_id,
  'REPLY_FOLLOW_UP', 'synthetic response follow up',
  '2026-07-10T20:00:00Z', 'OPEN', '2026-07-10T16:00:00Z'
from m8_entities where row_number = 1;

set role service_role;
insert into public.campaign_operation_days (
  organization_id, campaign_id, observed_on, status, evidence_class, evidence_sha256, recorded_by
)
select 'a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000002', observed_on::date,
  'OPERATING', 'live', encode(digest('m8-operation:' || observed_on::text, 'sha256'), 'hex'),
  'a9000000-0000-4000-8000-000000000009'
from generate_series('2026-07-01'::date, '2026-07-31'::date, interval '1 day') days(observed_on);

insert into public.reporting_calendar_days (
  organization_id, calendar_date, jurisdiction, is_business_day,
  evidence_class, source_sha256, recorded_by
) values
  ('a1000000-0000-4000-8000-000000000001', '2026-08-01', 'MX', false, 'live', repeat('6', 64), 'a9000000-0000-4000-8000-000000000009'),
  ('a1000000-0000-4000-8000-000000000001', '2026-08-02', 'MX', false, 'live', repeat('7', 64), 'a9000000-0000-4000-8000-000000000009'),
  ('a1000000-0000-4000-8000-000000000001', '2026-08-03', 'MX', true, 'live', repeat('8', 64), 'a9000000-0000-4000-8000-000000000009'),
  ('a1000000-0000-4000-8000-000000000001', '2026-08-04', 'MX', true, 'live', repeat('9', 64), 'a9000000-0000-4000-8000-000000000009'),
  ('a1000000-0000-4000-8000-000000000001', '2026-08-05', 'MX', true, 'live', repeat('a', 64), 'a9000000-0000-4000-8000-000000000009');

do $$
begin
  begin
    perform app.generate_contractual_monthly_report(
      'a1000000-0000-4000-8000-000000000001',
      'a2000000-0000-4000-8000-000000000002',
      '2026-06-01', repeat('d', 64), 'a9000000-0000-4000-8000-000000000009'
    );
    raise exception 'expected incomplete operation days rejection';
  exception when others then
    if sqlerrm <> 'MONTHLY_REPORT_OPERATION_DAYS_INCOMPLETE' then raise; end if;
  end;
end;
$$;

select app.generate_contractual_monthly_report(
  'a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000002',
  '2026-07-01', repeat('e', 64), 'a9000000-0000-4000-8000-000000000009'
) as report_id \gset

do $$
declare
  report_record public.contractual_monthly_reports%rowtype;
  item_count integer;
  second_id uuid;
begin
  select * into report_record from public.contractual_monthly_reports
  where organization_id = 'a1000000-0000-4000-8000-000000000001'
    and campaign_id = 'a2000000-0000-4000-8000-000000000002'
    and period_start = '2026-07-01';
  if report_record.operational_days <> 31 or report_record.report_due_on <> '2026-08-05'
    or report_record.generated_on_time or report_record.delivered_messages <> 5
    or report_record.substantive_replies <> 2 or report_record.positive_replies <> 2
    or report_record.email_strict_leads <> 2 or report_record.prequote_strict_leads <> 0
    or report_record.total_strict_leads <> 2 or report_record.target_met
    or report_record.held_meetings <> 1 or report_record.qualified_opportunities <> 1
    or report_record.delivered_proposals <> 1 or report_record.closed_won <> 0
    or report_record.first_payments_mxn <> 100000 or report_record.client_sla_breaches <> 1
  then raise exception 'monthly report counts mismatch: %', row_to_json(report_record); end if;
  select count(*) into item_count from public.contractual_report_items where report_id = report_record.id;
  if item_count <> 16 then raise exception 'monthly report evidence item mismatch: %', item_count; end if;
  second_id := app.generate_contractual_monthly_report(
    report_record.organization_id, report_record.campaign_id, report_record.period_start,
    repeat('e', 64), 'a9000000-0000-4000-8000-000000000009'
  );
  if second_id <> report_record.id then raise exception 'monthly report idempotency failed'; end if;
  begin
    perform app.generate_contractual_monthly_report(
      report_record.organization_id, report_record.campaign_id, report_record.period_start,
      repeat('f', 64), 'a9000000-0000-4000-8000-000000000009'
    );
    raise exception 'expected evidence drift rejection';
  exception when others then
    if sqlerrm <> 'MONTHLY_REPORT_EXISTING_EVIDENCE_DRIFT' then raise; end if;
  end;
  begin
    perform app.issue_contractual_monthly_report(report_record.id);
    raise exception 'expected issue approval requirement';
  exception when others then
    if sqlerrm <> 'MONTHLY_REPORT_APPROVAL_REQUIRED' then raise; end if;
  end;
end;
$$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', 'a9000000-0000-4000-8000-000000000009', false);
insert into public.approvals (
  id, organization_id, subject_type, subject_id, subject_sha256,
  decision, decided_by, rationale, decided_at
)
select 'ad000000-0000-4000-8000-00000000000d',
  organization_id, 'contractual_monthly_report_issue', id, snapshot_sha256,
  'APPROVED', 'a9000000-0000-4000-8000-000000000009',
  'M8_SENTINEL_EMAIL should never reach audit snapshots', now()
from public.contractual_monthly_reports where id = :'report_id'::uuid;
reset role;

set role service_role;
select app.issue_contractual_monthly_report(:'report_id'::uuid) as issuance_id \gset
do $$
declare
  report_id_value uuid;
  issuance_id_value uuid;
begin
  select id into report_id_value from public.contractual_monthly_reports
  where organization_id = 'a1000000-0000-4000-8000-000000000001'
    and campaign_id = 'a2000000-0000-4000-8000-000000000002'
    and period_start = '2026-07-01';
  select id into issuance_id_value from public.contractual_report_issuances where report_id = report_id_value;
  if app.issue_contractual_monthly_report(report_id_value) <> issuance_id_value then
    raise exception 'report issuance idempotency failed';
  end if;
  begin
    perform app.create_recovery_experiment(
      report_id_value, 'MESSAGE', 'SHORTER_CTA_TEST', 25, repeat('1', 64),
      'a9000000-0000-4000-8000-000000000009', true, true, false, true, true
    );
    raise exception 'expected diagnostic order rejection';
  exception when others then
    if sqlerrm <> 'RECOVERY_DIAGNOSTIC_ORDER_INCOMPLETE' then raise; end if;
  end;
end;
$$;

select app.create_recovery_experiment(
  :'report_id'::uuid, 'MESSAGE', 'SHORTER_CTA_TEST', 25, repeat('1', 64),
  'a9000000-0000-4000-8000-000000000009', true, true, true, true, true
) as experiment_id \gset

do $$
declare
  experiment_id_value uuid;
begin
  select id into experiment_id_value from public.recovery_experiments
  where organization_id = 'a1000000-0000-4000-8000-000000000001'
    and hypothesis_code = 'SHORTER_CTA_TEST';
  begin
    perform app.release_recovery_experiment(experiment_id_value);
    raise exception 'expected recovery approval requirement';
  exception when others then
    if sqlerrm <> 'RECOVERY_APPROVAL_REQUIRED' then raise; end if;
  end;
end;
$$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', 'a9000000-0000-4000-8000-000000000009', false);
insert into public.approvals (
  id, organization_id, subject_type, subject_id, subject_sha256,
  decision, decided_by, rationale, decided_at
) values (
  'ae000000-0000-4000-8000-00000000000e',
  'a1000000-0000-4000-8000-000000000001',
  'recovery_experiment_release', :'experiment_id'::uuid, repeat('1', 64),
  'APPROVED', 'a9000000-0000-4000-8000-000000000009',
  'Approve one synthetic variable only', now()
);
reset role;

set role service_role;
do $$
declare
  experiment_id_value uuid;
  report_id_value uuid;
begin
  select id, report_id into experiment_id_value, report_id_value from public.recovery_experiments
  where organization_id = 'a1000000-0000-4000-8000-000000000001'
    and hypothesis_code = 'SHORTER_CTA_TEST';
  if app.release_recovery_experiment(experiment_id_value) <> experiment_id_value then
    raise exception 'recovery release failed';
  end if;
  if app.release_recovery_experiment(experiment_id_value) <> experiment_id_value then
    raise exception 'recovery release idempotency failed';
  end if;
  begin
    perform app.create_recovery_experiment(
      report_id_value, 'SEGMENT', 'SECOND_ACTIVE_TEST', 25, repeat('2', 64),
      'a9000000-0000-4000-8000-000000000009', true, true, true, true, true
    );
    raise exception 'expected active experiment rejection';
  exception when others then
    if sqlerrm <> 'RECOVERY_ACTIVE_EXPERIMENT_EXISTS' then raise; end if;
  end;
  begin
    insert into public.contractual_monthly_reports (
      organization_id, campaign_id, period_start, period_end_exclusive,
      report_due_on, generated_on, generated_on_time, evidence_class,
      operational_days, delivered_messages, substantive_replies, positive_replies,
      email_strict_leads, prequote_strict_leads, held_meetings, qualified_opportunities,
      delivered_proposals, closed_won, first_payments_mxn, client_sla_breaches,
      source_evidence_sha256, snapshot_sha256, created_by
    ) values (
      'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002',
      '2026-05-01', '2026-06-01', '2026-06-04', '2026-06-05', false, 'live',
      31, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      repeat('3', 64), repeat('4', 64), 'a9000000-0000-4000-8000-000000000009'
    );
    raise exception 'expected direct service insert denial';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

do $$
declare
  report_id_value uuid;
begin
  select id into report_id_value from public.contractual_monthly_reports
  where organization_id = 'a1000000-0000-4000-8000-000000000001'
    and campaign_id = 'a2000000-0000-4000-8000-000000000002'
    and period_start = '2026-07-01';
  begin
    update public.contractual_monthly_reports set client_sla_breaches = 0 where id = report_id_value;
    raise exception 'expected append only report rejection';
  exception when others then
    if sqlerrm <> 'MONTHLY_EVIDENCE_APPEND_ONLY' then raise; end if;
  end;
  if exists (
    select 1 from public.audit_log
    where organization_id = 'a1000000-0000-4000-8000-000000000001'
      and (coalesce(old_data::text, '') || coalesce(new_data::text, '')) ilike '%M8_SENTINEL_EMAIL%'
  ) then raise exception 'audit leaked approval rationale'; end if;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', 'a8000000-0000-4000-8000-000000000008', false);
do $$
begin
  begin
    insert into public.campaign_operation_days (
      organization_id, campaign_id, observed_on, status, evidence_class, evidence_sha256, recorded_by
    ) values (
      'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002',
      '2026-08-01', 'OPERATING', 'live', repeat('5', 64), 'a8000000-0000-4000-8000-000000000008'
    );
    raise exception 'expected operator insert denial';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

select 'CONTRACTUAL_MONTHLY_REPORTING_GATE_PASS' as result;
