\set ON_ERROR_STOP on

insert into public.organizations (id, slug, legal_name) values
  ('91111111-1111-4111-8111-111111111111', 'm7-org', 'M7 Synthetic Organization');

insert into public.organization_users (organization_id, user_id, role) values
  ('91111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999', 'teckel_admin'),
  ('91111111-1111-4111-8111-111111111111', '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ennco_operator');

insert into public.runtime_controls (organization_id, global_kill_switch, external_send_allowed) values
  ('91111111-1111-4111-8111-111111111111', true, false);

insert into public.campaigns (
  id, organization_id, name, status, manifest_json, manifest_sha256,
  suppression_snapshot_at, shadow_canary_decision, approved_by, approved_at
) values (
  '92222222-2222-4222-8222-222222222222',
  '91111111-1111-4111-8111-111111111111',
  'M7 synthetic controlled scaling',
  'ACTIVE',
  '{}',
  repeat('a', 64),
  now(),
  'PASS',
  '99999999-9999-4999-8999-999999999999',
  now()
);

insert into public.sequence_versions (
  id, organization_id, campaign_id, version, sender_name, sender_title,
  content_sha256, approved_by, approved_at
) values (
  '93333333-3333-4333-8333-333333333333',
  '91111111-1111-4111-8111-111111111111',
  '92222222-2222-4222-8222-222222222222',
  1,
  'Francisco',
  'CEO',
  repeat('b', 64),
  '99999999-9999-4999-8999-999999999999',
  now()
);

insert into public.sequence_touches (
  organization_id, sequence_version_id, touch_number, day_offset, subject_template, body_template
) values
  ('91111111-1111-4111-8111-111111111111', '93333333-3333-4333-8333-333333333333', 1, 0, 'Synthetic 1', 'Synthetic body 1'),
  ('91111111-1111-4111-8111-111111111111', '93333333-3333-4333-8333-333333333333', 2, 3, 'Synthetic 2', 'Synthetic body 2');

insert into public.mailboxes (
  id, organization_id, normalized_email, domain, sender_name,
  domain_ready_at, auth_spf, auth_dkim, auth_dmarc, auth_tls, health_status, kill_switch
) values (
  '94444444-4444-4444-8444-444444444444',
  '91111111-1111-4111-8111-111111111111',
  'francisco@m7.invalid',
  'm7.invalid',
  'Francisco',
  now() - interval '40 days',
  true, true, true, true, 'HEALTHY', false
);

set role authenticated;
select set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', false);

insert into public.approvals (
  id, organization_id, subject_type, subject_id, subject_sha256,
  decision, decided_by, rationale, decided_at
) values
  (
    '95555555-5555-4555-8555-555555555555',
    '91111111-1111-4111-8111-111111111111',
    'campaign_first_send_release',
    '92222222-2222-4222-8222-222222222222',
    repeat('a', 64),
    'APPROVED',
    '99999999-9999-4999-8999-999999999999',
    'M7 test first release approval',
    now()
  ),
  (
    '96666666-6666-4666-8666-666666666666',
    '91111111-1111-4111-8111-111111111111',
    'rollout_wave_release',
    '98888888-8888-4888-8888-888888888888',
    repeat('a', 64),
    'APPROVED',
    '99999999-9999-4999-8999-999999999999',
    'M7 test wave approval',
    now()
  );

reset role;

insert into public.campaign_release_gates (
  organization_id, campaign_id, gate_code, status, evidence_class,
  evidence_sha256, observed_at, valid_until, recorded_by, approval_id
)
select
  '91111111-1111-4111-8111-111111111111',
  '92222222-2222-4222-8222-222222222222',
  gate_code,
  'PASS',
  'live',
  encode(digest('m7:' || gate_code::text, 'sha256'), 'hex'),
  case when gate_code = 'EXPLICIT_SEND_APPROVAL_JORGE'
    then (select decided_at from public.approvals where id = '95555555-5555-4555-8555-555555555555')
    else now()
  end,
  now() + interval '7 days',
  '99999999-9999-4999-8999-999999999999',
  case when gate_code = 'EXPLICIT_SEND_APPROVAL_JORGE'
    then '95555555-5555-4555-8555-555555555555'::uuid else null end
from unnest(enum_range(null::public.first_send_gate_code)) gates(gate_code);

insert into public.first_send_batches (
  id, organization_id, campaign_id, manifest_sha256, status,
  recipient_count, account_count, scheduled_for, approved_by, approved_at, released_at
) values (
  '97777777-7777-4777-8777-777777777777',
  '91111111-1111-4111-8111-111111111111',
  '92222222-2222-4222-8222-222222222222',
  repeat('a', 64),
  'RELEASED',
  5,
  5,
  now() - interval '48 hours',
  '99999999-9999-4999-8999-999999999999',
  now() - interval '48 hours',
  now() - interval '48 hours'
);

insert into public.rollout_health_observations (
  id, organization_id, campaign_id, source_kind, source_id, observation_number,
  evidence_class, delivered_count, reply_sync_p95_seconds,
  observation_started_at, observed_at, evidence_sha256
) values
  (
    '97111111-1111-4111-8111-111111111111',
    '91111111-1111-4111-8111-111111111111',
    '92222222-2222-4222-8222-222222222222',
    'FIRST_SEND_BATCH', '97777777-7777-4777-8777-777777777777', 1,
    'synthetic_demo', 5, 120, now() - interval '25 hours', now(), repeat('1', 64)
  ),
  (
    '97222222-2222-4222-8222-222222222222',
    '91111111-1111-4111-8111-111111111111',
    '92222222-2222-4222-8222-222222222222',
    'FIRST_SEND_BATCH', '97777777-7777-4777-8777-777777777777', 2,
    'live', 5, 120, now() - interval '25 hours', now(), repeat('2', 64)
  ),
  (
    '97333333-3333-4333-8333-333333333333',
    '91111111-1111-4111-8111-111111111111',
    '92222222-2222-4222-8222-222222222222',
    'FIRST_SEND_BATCH', '97777777-7777-4777-8777-777777777777', 3,
    'live', 5, 120, now() - interval '25 hours', now(), repeat('3', 64)
  );

update public.rollout_health_observations
set spam_complaint_count = 1
where id = '97333333-3333-4333-8333-333333333333';

set role service_role;

do $$
begin
  if app.finalize_scaling_health('97111111-1111-4111-8111-111111111111') <> 'EXTEND' then
    raise exception 'synthetic health must EXTEND';
  end if;
  if app.finalize_scaling_health('97222222-2222-4222-8222-222222222222') <> 'PASS' then
    raise exception 'clean live health should PASS';
  end if;
  if app.finalize_scaling_health('97333333-3333-4333-8333-333333333333') <> 'KILL' then
    raise exception 'spam complaint should KILL';
  end if;
end;
$$;

reset role;

create temporary table m7_wave_ids (
  row_number integer primary key,
  account_id uuid not null,
  contact_id uuid not null,
  enrollment_id uuid not null
);

insert into m7_wave_ids
select
  number_value,
  md5('m7-wave-account-' || number_value::text)::uuid,
  md5('m7-wave-contact-' || number_value::text)::uuid,
  md5('m7-wave-enrollment-' || number_value::text)::uuid
from generate_series(1, 10) values_list(number_value);

insert into public.accounts (
  id, organization_id, legal_name, normalized_name, primary_domain, tier, source_confidence
)
select account_id, '91111111-1111-4111-8111-111111111111',
  'M7 Wave Account ' || row_number, 'm7 wave account ' || row_number,
  'wave-' || row_number || '.invalid', 1, 'VERIFIED'
from m7_wave_ids;

insert into public.contacts (
  id, organization_id, account_id, full_name, role_title, normalized_email,
  verified, verified_at, source_confidence
)
select contact_id, '91111111-1111-4111-8111-111111111111', account_id,
  'M7 Contact ' || row_number, 'CEO', 'contact-' || row_number || '@wave-' || row_number || '.invalid',
  true, now(), 'VERIFIED'
from m7_wave_ids;

insert into public.campaign_enrollments (
  id, organization_id, campaign_id, sequence_version_id, account_id, contact_id,
  mailbox_id, status, next_touch_number
)
select enrollment_id, '91111111-1111-4111-8111-111111111111',
  '92222222-2222-4222-8222-222222222222', '93333333-3333-4333-8333-333333333333',
  account_id, contact_id, '94444444-4444-4444-8444-444444444444', 'ACTIVE', 1
from m7_wave_ids;

insert into public.rollout_waves (
  id, organization_id, campaign_id, wave_number, previous_observation_id,
  manifest_sha256, status, planned_recipient_count, planned_account_count,
  scheduled_for, approval_id
)
select
  '98888888-8888-4888-8888-888888888888',
  '91111111-1111-4111-8111-111111111111',
  '92222222-2222-4222-8222-222222222222',
  1,
  '97222222-2222-4222-8222-222222222222',
  repeat('a', 64),
  'DRAFT',
  10,
  10,
  (candidate_day::date + time '09:30') at time zone 'America/Mexico_City',
  '96666666-6666-4666-8666-666666666666'
from generate_series(current_date + 1, current_date + 7, interval '1 day') days(candidate_day)
where extract(isodow from candidate_day) between 2 and 4
order by candidate_day limit 1;

insert into public.rollout_wave_enrollments (
  organization_id, wave_id, enrollment_id, account_id, contact_id, mailbox_id,
  sequence_version_id, contact_email_sha256, sequence_content_sha256
)
select
  '91111111-1111-4111-8111-111111111111',
  '98888888-8888-4888-8888-888888888888', enrollment_id, account_id, contact_id,
  '94444444-4444-4444-8444-444444444444', '93333333-3333-4333-8333-333333333333',
  encode(digest('contact-' || row_number || '@wave-' || row_number || '.invalid', 'sha256'), 'hex'),
  repeat('b', 64)
from m7_wave_ids;

insert into public.first_send_batches (
  id, organization_id, campaign_id, manifest_sha256, status,
  recipient_count, account_count, scheduled_for
) values (
  '9ddddddd-dddd-4ddd-8ddd-dddddddddddd',
  '91111111-1111-4111-8111-111111111111',
  '92222222-2222-4222-8222-222222222222', repeat('a', 64),
  'DRAFT', 1, 1, now() + interval '1 day'
);

do $$
declare
  enrollment_record record;
begin
  select * into enrollment_record from m7_wave_ids order by row_number limit 1;
  begin
    insert into public.first_send_batch_enrollments (
      organization_id, batch_id, enrollment_id, account_id, contact_id, mailbox_id,
      sequence_version_id, contact_email_sha256, sequence_content_sha256
    ) values (
      '91111111-1111-4111-8111-111111111111',
      '9ddddddd-dddd-4ddd-8ddd-dddddddddddd', enrollment_record.enrollment_id,
      enrollment_record.account_id, enrollment_record.contact_id,
      '94444444-4444-4444-8444-444444444444',
      '93333333-3333-4333-8333-333333333333',
      encode(digest('contact-1@wave-1.invalid', 'sha256'), 'hex'), repeat('b', 64)
    );
    raise exception 'expected release source overlap rejection';
  exception when others then
    if sqlerrm <> 'ENROLLMENT_RELEASE_SOURCE_OVERLAP' then raise; end if;
  end;
end;
$$;

do $$
begin
  if app.assess_rollout_wave('98888888-8888-4888-8888-888888888888') <> 'PASS' then
    raise exception 'valid wave should PASS';
  end if;
end;
$$;

set role service_role;

do $$
begin
  if app.finalize_rollout_wave('98888888-8888-4888-8888-888888888888') <> 'PASS' then
    raise exception 'wave finalization should PASS';
  end if;
  begin
    update public.rollout_waves set planned_recipient_count = 9
    where id = '98888888-8888-4888-8888-888888888888';
    raise exception 'expected direct wave update denial';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;

do $$
declare
  enrollment_value uuid;
  contact_value uuid;
begin
  select enrollment_id, contact_id into enrollment_value, contact_value from m7_wave_ids order by row_number limit 1;
  begin
    insert into public.messages (
      organization_id, enrollment_id, mailbox_id, contact_id, direction, status,
      touch_number, normalized_to, normalized_from, subject, body_text,
      idempotency_key, correlation_id
    ) values (
      '91111111-1111-4111-8111-111111111111', enrollment_value,
      '94444444-4444-4444-8444-444444444444', contact_value,
      'OUTBOUND', 'QUEUED', 1, 'contact-1@wave-1.invalid', 'francisco@m7.invalid',
      'M7_SENTINEL_SUBJECT', 'M7_SENTINEL_BODY', 'm7-wave-live-attempt',
      '9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    );
    raise exception 'expected release window hold';
  exception when others then
    if sqlerrm <> 'OUTBOUND_RELEASE_GATE_NOT_PASS' then raise; end if;
  end;

  begin
    insert into public.messages (
      organization_id, enrollment_id, mailbox_id, contact_id, direction, status,
      touch_number, normalized_to, normalized_from, subject, body_text,
      idempotency_key, correlation_id
    ) values (
      '91111111-1111-4111-8111-111111111111', enrollment_value,
      '94444444-4444-4444-8444-444444444444', contact_value,
      'OUTBOUND', 'SENT', 1, 'contact-1@wave-1.invalid', 'francisco@m7.invalid',
      'M7_DIRECT_SENT', 'M7_DIRECT_SENT_BODY', 'm7-direct-sent-attempt',
      '9ccccccc-cccc-4ccc-8ccc-cccccccccccc'
    );
    raise exception 'expected direct sent rejection';
  exception when others then
    if sqlerrm <> 'OUTBOUND_STATUS_TRANSITION_INVALID' then raise; end if;
  end;
end;
$$;

set role service_role;

do $$
begin
  begin
    perform app.freeze_t0_baseline(
      '91111111-1111-4111-8111-111111111111',
      '92222222-2222-4222-8222-222222222222',
      repeat('e', 64),
      '99999999-9999-4999-8999-999999999999'
    );
    raise exception 'expected fewer than 100 delivery rejection';
  exception when others then
    if sqlerrm <> 'T0_REQUIRES_100_VALID_FIRST_DELIVERIES' then raise; end if;
  end;
end;
$$;

reset role;

create temporary table m7_t0_ids (
  row_number integer primary key,
  account_id uuid not null,
  contact_id uuid not null,
  enrollment_id uuid not null,
  message_id uuid not null
);

insert into m7_t0_ids
select
  number_value,
  md5('m7-t0-account-' || number_value::text)::uuid,
  md5('m7-t0-contact-' || number_value::text)::uuid,
  md5('m7-t0-enrollment-' || number_value::text)::uuid,
  md5('m7-t0-message-' || number_value::text)::uuid
from generate_series(1, 100) values_list(number_value);

insert into public.accounts (id, organization_id, legal_name, normalized_name, primary_domain, tier, source_confidence)
select account_id, '91111111-1111-4111-8111-111111111111',
  'M7 T0 Account ' || row_number, 'm7 t0 account ' || row_number,
  't0-' || row_number || '.invalid', 1, 'VERIFIED'
from m7_t0_ids;

insert into public.contacts (
  id, organization_id, account_id, full_name, role_title, normalized_email,
  verified, verified_at, source_confidence
)
select contact_id, '91111111-1111-4111-8111-111111111111', account_id,
  'M7 T0 Contact ' || row_number, 'CEO', 'contact-' || row_number || '@t0-' || row_number || '.invalid',
  true, now(), 'VERIFIED'
from m7_t0_ids;

insert into public.campaign_enrollments (
  id, organization_id, campaign_id, sequence_version_id, account_id, contact_id,
  mailbox_id, status, next_touch_number
)
select enrollment_id, '91111111-1111-4111-8111-111111111111',
  '92222222-2222-4222-8222-222222222222', '93333333-3333-4333-8333-333333333333',
  account_id, contact_id, '94444444-4444-4444-8444-444444444444', 'COMPLETED', 1
from m7_t0_ids;

alter table public.messages disable trigger messages_scaled_release_gate;

insert into public.messages (
  id, organization_id, enrollment_id, mailbox_id, contact_id, direction, status,
  touch_number, normalized_to, normalized_from, subject, body_text,
  idempotency_key, provider_message_id, correlation_id, sent_at
)
select
  message_id, '91111111-1111-4111-8111-111111111111', enrollment_id,
  '94444444-4444-4444-8444-444444444444', contact_id,
  'OUTBOUND', 'DELIVERED', 1,
  'contact-' || row_number || '@t0-' || row_number || '.invalid',
  'francisco@m7.invalid', 'T0 subject', 'T0 synthetic delivered fixture',
  'm7-t0-' || row_number, 'provider-m7-t0-' || row_number,
  md5('m7-t0-correlation-' || row_number)::uuid,
  now() - interval '10 days' + row_number * interval '1 minute'
from m7_t0_ids;

alter table public.messages enable trigger messages_scaled_release_gate;

insert into public.provider_events (
  organization_id, source, source_record_type, external_event_id, message_id,
  payload_json, observed_at, processed_at, event_kind, reply_classification,
  correlation_id, processing_status
)
select
  '91111111-1111-4111-8111-111111111111', 'gmail', 'message',
  'm7-t0-reply-' || row_number, message_id, '{}', now() - interval '9 days', now() - interval '9 days',
  'REPLY', case when row_number <= 6 then 'POSITIVE'::public.reply_classification else 'NEUTRAL'::public.reply_classification end,
  md5('m7-t0-reply-correlation-' || row_number)::uuid, 'PROCESSED'
from m7_t0_ids where row_number <= 10;

insert into public.leads (
  id, organization_id, account_id, contact_id, origin_message_id, status,
  contractual_qualified, evidence_class
)
select
  md5('m7-t0-lead-' || row_number)::uuid,
  '91111111-1111-4111-8111-111111111111', account_id, contact_id, message_id,
  'CAPTURED', false, 'live'
from m7_t0_ids where row_number <= 4;

insert into public.qualification_checks (
  organization_id, lead_id, industrial_over_100_kwp, outside_annex_a,
  verified_target_role, explicit_interest, monthly_spend_mxn, evidence_record_ids
)
select
  '91111111-1111-4111-8111-111111111111', md5('m7-t0-lead-' || row_number)::uuid,
  true, true, true, true, 25000, array[md5('m7-t0-evidence-' || row_number)::uuid]
from generate_series(1, 4) values_list(row_number);

set role authenticated;
select set_config('request.jwt.claim.sub', '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);

select app.qualify_lead_strict(
  '91111111-1111-4111-8111-111111111111',
  md5('m7-t0-lead-' || number_value)::uuid,
  true, true, true, true, 25000,
  array[md5('m7-t0-evidence-' || number_value)::uuid]
)
from generate_series(1, 4) values_list(number_value);

reset role;

insert into public.opportunities (
  id, organization_id, account_id, lead_id, stage, economic_buyer, active_pain,
  business_impact, timing_under_90_days, value_mxn, next_action, next_action_at
)
select
  md5('m7-t0-opportunity-' || ids.row_number)::uuid,
  '91111111-1111-4111-8111-111111111111', ids.account_id,
  md5('m7-t0-lead-' || ids.row_number)::uuid, 'PROSPECTING',
  true, true, true, true, 1000000, 'Synthetic next action', now() + interval '1 day'
from m7_t0_ids ids where ids.row_number <= 3;

insert into public.meetings (
  organization_id, opportunity_id, scheduled_at, held_at, attendance_verified, outcome_notes
)
select
  '91111111-1111-4111-8111-111111111111',
  md5('m7-t0-opportunity-' || number_value)::uuid,
  now() - interval '8 days', now() - interval '8 days', true, 'Synthetic held meeting evidence'
from generate_series(1, 3) values_list(number_value);

update public.opportunities set stage = 'CONVERSATION'
where organization_id = '91111111-1111-4111-8111-111111111111'
  and id in (select md5('m7-t0-opportunity-' || number_value)::uuid from generate_series(1, 3) values_list(number_value));
update public.opportunities set stage = 'MEETING_CONFIRMED'
where organization_id = '91111111-1111-4111-8111-111111111111'
  and id in (select md5('m7-t0-opportunity-' || number_value)::uuid from generate_series(1, 3) values_list(number_value));
update public.opportunities set stage = 'DISCOVERY_HELD'
where organization_id = '91111111-1111-4111-8111-111111111111'
  and id in (select md5('m7-t0-opportunity-' || number_value)::uuid from generate_series(1, 3) values_list(number_value));
update public.opportunities set stage = 'QUALIFIED'
where organization_id = '91111111-1111-4111-8111-111111111111'
  and id in (select md5('m7-t0-opportunity-' || number_value)::uuid from generate_series(1, 3) values_list(number_value));

set role service_role;

do $$
declare
  baseline_id uuid;
begin
  baseline_id := app.freeze_t0_baseline(
    '91111111-1111-4111-8111-111111111111',
    '92222222-2222-4222-8222-222222222222',
    repeat('e', 64),
    '99999999-9999-4999-8999-999999999999'
  );
  if baseline_id is null then raise exception 'baseline id missing'; end if;
end;
$$;

reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);

do $$
begin
  begin
    insert into public.rollout_health_observations (
      organization_id, campaign_id, source_kind, source_id, observation_number,
      evidence_class, delivered_count, reply_sync_p95_seconds,
      observation_started_at, observed_at, evidence_sha256
    ) values (
      '91111111-1111-4111-8111-111111111111', '92222222-2222-4222-8222-222222222222',
      'FIRST_SEND_BATCH', '97777777-7777-4777-8777-777777777777', 9,
      'live', 5, 120, now() - interval '25 hours', now(), repeat('9', 64)
    );
    raise exception 'expected operator observation insert denial';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;

do $$
begin
  if (select decision from public.rollout_health_observations where id = '97111111-1111-4111-8111-111111111111') <> 'EXTEND' then
    raise exception 'synthetic observation decision mismatch';
  end if;
  if (select decision from public.rollout_health_observations where id = '97222222-2222-4222-8222-222222222222') <> 'PASS' then
    raise exception 'live observation decision mismatch';
  end if;
  if (select status from public.rollout_waves where id = '98888888-8888-4888-8888-888888888888') <> 'READY' then
    raise exception 'wave not ready';
  end if;
  if (select valid_first_deliveries from public.commercial_baselines) <> 100 then raise exception 'T0 denominator mismatch'; end if;
  if (select substantive_replies from public.commercial_baselines) <> 10 then raise exception 'T0 reply count mismatch'; end if;
  if (select positive_replies from public.commercial_baselines) <> 6 then raise exception 'T0 positive count mismatch'; end if;
  if (select strict_leads from public.commercial_baselines) <> 4 then raise exception 'T0 lead count mismatch'; end if;
  if (select held_meetings from public.commercial_baselines) <> 3 then raise exception 'T0 meeting count mismatch'; end if;
  if (select qualified_opportunities from public.commercial_baselines) <> 3 then raise exception 'T0 opportunity count mismatch'; end if;
  if (select reply_rate from public.commercial_baselines) <> 0.1 then raise exception 'T0 reply rate mismatch'; end if;
  if exists (
    select 1 from public.audit_log
    where record_type in ('rollout_health_observations', 'rollout_waves', 'rollout_wave_enrollments', 'commercial_baselines')
      and (coalesce(old_data::text, '') || coalesce(new_data::text, '')) ~* '(M7_SENTINEL|@wave|@t0|body_text|subject)'
  ) then raise exception 'scaling audit contains PII or message text'; end if;
  if exists (select 1 from public.messages where idempotency_key in ('m7-wave-live-attempt', 'm7-direct-sent-attempt')) then
    raise exception 'blocked external message persisted';
  end if;
end;
$$;

select 'CONTROLLED_SCALING_GATE_PASS' as result;
