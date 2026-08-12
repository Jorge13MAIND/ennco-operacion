\set ON_ERROR_STOP on

insert into public.organizations (id, slug, legal_name) values
  ('81111111-1111-4111-8111-111111111111', 'm6-org', 'M6 Synthetic Organization');

insert into public.runtime_controls (
  organization_id, global_kill_switch, external_send_allowed
) values (
  '81111111-1111-4111-8111-111111111111', true, false
);

insert into public.organization_users (organization_id, user_id, role) values
  ('81111111-1111-4111-8111-111111111111', '89999999-9999-4999-8999-999999999999', 'teckel_admin');

insert into public.campaigns (
  id, organization_id, name, status, manifest_json, manifest_sha256,
  suppression_snapshot_at, shadow_canary_decision, approved_by, approved_at
) values (
  '82222222-2222-4222-8222-222222222222',
  '81111111-1111-4111-8111-111111111111',
  'M6 synthetic first send campaign',
  'ACTIVE',
  '{}',
  repeat('a', 64),
  now(),
  'PASS',
  '89999999-9999-4999-8999-999999999999',
  now()
);

insert into public.sequence_versions (
  id, organization_id, campaign_id, version, sender_name, sender_title,
  content_sha256, approved_by, approved_at
) values (
  '83333333-3333-4333-8333-333333333333',
  '81111111-1111-4111-8111-111111111111',
  '82222222-2222-4222-8222-222222222222',
  1,
  'Francisco',
  'CEO',
  repeat('b', 64),
  '89999999-9999-4999-8999-999999999999',
  now()
);

insert into public.sequence_touches (
  organization_id, sequence_version_id, touch_number, day_offset,
  subject_template, body_template
) values (
  '81111111-1111-4111-8111-111111111111',
  '83333333-3333-4333-8333-333333333333',
  1,
  0,
  'Synthetic subject',
  'Synthetic body'
);

insert into public.mailboxes (
  id, organization_id, normalized_email, domain, sender_name,
  domain_ready_at, auth_spf, auth_dkim, auth_dmarc, auth_tls,
  health_status, kill_switch
) values (
  '84444444-4444-4444-8444-444444444444',
  '81111111-1111-4111-8111-111111111111',
  'francisco@synthetic.invalid',
  'synthetic.invalid',
  'Francisco',
  now() - interval '40 days',
  true,
  true,
  true,
  true,
  'HEALTHY',
  false
);

create temporary table m6_ids (
  row_number integer primary key,
  account_id uuid not null,
  contact_id uuid not null,
  enrollment_id uuid not null
);

insert into m6_ids (row_number, account_id, contact_id, enrollment_id)
select
  number_value,
  md5('m6-account-' || number_value::text)::uuid,
  md5('m6-contact-' || number_value::text)::uuid,
  md5('m6-enrollment-' || number_value::text)::uuid
from generate_series(1, 5) as numbers(number_value);

insert into public.accounts (
  id, organization_id, legal_name, normalized_name, primary_domain,
  tier, evidence_class, source_confidence
)
select
  account_id,
  '81111111-1111-4111-8111-111111111111',
  'Synthetic Account ' || row_number::text,
  'synthetic account ' || row_number::text,
  'account-' || row_number::text || '.invalid',
  1,
  'synthetic_demo',
  'VERIFIED'
from m6_ids;

insert into public.contacts (
  id, organization_id, account_id, full_name, role_title,
  normalized_email, verified, verified_at, source_confidence
)
select
  contact_id,
  '81111111-1111-4111-8111-111111111111',
  account_id,
  'Synthetic Contact ' || row_number::text,
  'CEO',
  'contact-' || row_number::text || '@account-' || row_number::text || '.invalid',
  true,
  now(),
  'VERIFIED'
from m6_ids;

insert into public.campaign_enrollments (
  id, organization_id, campaign_id, sequence_version_id, account_id,
  contact_id, mailbox_id, status, next_touch_number
)
select
  enrollment_id,
  '81111111-1111-4111-8111-111111111111',
  '82222222-2222-4222-8222-222222222222',
  '83333333-3333-4333-8333-333333333333',
  account_id,
  contact_id,
  '84444444-4444-4444-8444-444444444444',
  'ACTIVE',
  1
from m6_ids;

set role authenticated;
select set_config('request.jwt.claim.sub', '89999999-9999-4999-8999-999999999999', false);

insert into public.approvals (
  id, organization_id, subject_type, subject_id, subject_sha256,
  decision, decided_by, rationale, decided_at
) values (
  '8ddddddd-dddd-4ddd-8ddd-dddddddddddd',
  '81111111-1111-4111-8111-111111111111',
  'campaign_first_send_release',
  '82222222-2222-4222-8222-222222222222',
  repeat('a', 64),
  'APPROVED',
  '89999999-9999-4999-8999-999999999999',
  'M6 synthetic approval evidence only',
  now()
);

reset role;

insert into public.campaign_release_gates (
  organization_id, campaign_id, gate_code, status, evidence_class,
  evidence_sha256, observed_at, valid_until, recorded_by, approval_id
)
select
  '81111111-1111-4111-8111-111111111111',
  '82222222-2222-4222-8222-222222222222',
  gate_code,
  'PASS',
  'live',
  encode(digest(gate_code::text, 'sha256'), 'hex'),
  case
    when gate_code = 'EXPLICIT_SEND_APPROVAL_JORGE'
      then (select decided_at from public.approvals where id = '8ddddddd-dddd-4ddd-8ddd-dddddddddddd')
    else now()
  end,
  now() + interval '7 days',
  '89999999-9999-4999-8999-999999999999',
  case when gate_code = 'EXPLICIT_SEND_APPROVAL_JORGE'
    then '8ddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid
    else null
  end
from unnest(enum_range(null::public.first_send_gate_code)) as gates(gate_code);

insert into public.first_send_batches (
  id, organization_id, campaign_id, manifest_sha256, status,
  recipient_count, account_count, scheduled_for
) select
  '88888888-8888-4888-8888-888888888888',
  '81111111-1111-4111-8111-111111111111',
  '82222222-2222-4222-8222-222222222222',
  repeat('a', 64),
  'DRAFT',
  5,
  5,
  (candidate_day::date + time '09:30') at time zone 'America/Mexico_City'
from generate_series(current_date + 1, current_date + 7, interval '1 day') as days(candidate_day)
where extract(isodow from candidate_day) between 2 and 4
order by candidate_day
limit 1;

insert into public.first_send_batch_enrollments (
  organization_id, batch_id, enrollment_id, account_id, contact_id,
  mailbox_id, sequence_version_id, contact_email_sha256, sequence_content_sha256
)
select
  '81111111-1111-4111-8111-111111111111',
  '88888888-8888-4888-8888-888888888888',
  enrollment_id,
  account_id,
  contact_id,
  '84444444-4444-4444-8444-444444444444',
  '83333333-3333-4333-8333-333333333333',
  encode(digest('contact-' || row_number::text || '@account-' || row_number::text || '.invalid', 'sha256'), 'hex'),
  repeat('b', 64)
from m6_ids;

do $$
declare
  decision_value public.gate_decision;
begin
  decision_value := app.assess_first_send_batch('88888888-8888-4888-8888-888888888888');
  if decision_value <> 'PASS' then raise exception 'complete live first-send gate should PASS'; end if;

  if not app.is_first_send_window(
    '2025-02-04 15:30:00+00',
    '2025-02-04 16:30:00+00'
  ) then raise exception 'Tuesday release window should pass'; end if;

  if app.is_first_send_window(
    '2025-02-08 15:30:00+00',
    '2025-02-08 16:30:00+00'
  ) then raise exception 'Saturday release window should fail'; end if;

  if app.is_first_send_window(
    '2025-02-04 15:30:00+00',
    '2025-02-04 18:00:00+00'
  ) then raise exception 'late observation should fail'; end if;
end;
$$;

set role service_role;

do $$
declare
  decision_value public.gate_decision;
begin
  decision_value := app.finalize_first_send_batch('88888888-8888-4888-8888-888888888888');
  if decision_value <> 'PASS' then raise exception 'service finalization should PASS'; end if;
  decision_value := app.finalize_first_send_batch('88888888-8888-4888-8888-888888888888');
  if decision_value <> 'PASS' then raise exception 'repeated service finalization should remain PASS'; end if;
end;
$$;

do $$
begin
  begin
    update public.first_send_batches
    set scheduled_for = scheduled_for + interval '1 day'
    where id = '88888888-8888-4888-8888-888888888888';
    raise exception 'expected direct service batch update denial';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.first_send_batch_enrollments
    where batch_id = '88888888-8888-4888-8888-888888888888';
    raise exception 'expected direct service recipient deletion denial';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;

do $$
begin
  begin
    update public.first_send_batch_enrollments
    set contact_email_sha256 = repeat('f', 64)
    where batch_id = '88888888-8888-4888-8888-888888888888';
    raise exception 'expected immutable recipient set';
  exception when others then
    if sqlerrm <> 'FIRST_SEND_RECIPIENT_SET_IMMUTABLE' then raise; end if;
  end;

  begin
    update public.approvals
    set subject_sha256 = repeat('f', 64)
    where id = '8ddddddd-dddd-4ddd-8ddd-dddddddddddd';
    raise exception 'expected append-only approval';
  exception when others then
    if sqlerrm <> 'APPROVAL_APPEND_ONLY' then raise; end if;
  end;

  if (select status from public.first_send_batches where id = '88888888-8888-4888-8888-888888888888') <> 'READY' then
    raise exception 'batch was not made READY';
  end if;
  if (select approved_by from public.first_send_batches where id = '88888888-8888-4888-8888-888888888888')
    <> '89999999-9999-4999-8999-999999999999'::uuid
  then raise exception 'approval actor was not copied from explicit gate'; end if;
end;
$$;

do $$
begin
  begin
    update public.campaign_release_gates
    set evidence_class = 'synthetic_demo'
    where organization_id = '81111111-1111-4111-8111-111111111111'
      and campaign_id = '82222222-2222-4222-8222-222222222222'
      and gate_code = 'SPF_PASS';
    raise exception 'expected synthetic PASS evidence rejection';
  exception when check_violation then null;
  end;
end;
$$;

update public.campaign_release_gates
set observed_at = now() - interval '2 days',
    valid_until = now() - interval '1 day'
where organization_id = '81111111-1111-4111-8111-111111111111'
  and campaign_id = '82222222-2222-4222-8222-222222222222'
  and gate_code = 'SPF_PASS';

do $$
begin
  if app.assess_first_send_batch('88888888-8888-4888-8888-888888888888') <> 'EXTEND' then
    raise exception 'expired gate must EXTEND';
  end if;
end;
$$;

update public.campaign_release_gates
set observed_at = now(), valid_until = now() + interval '7 days'
where organization_id = '81111111-1111-4111-8111-111111111111'
  and campaign_id = '82222222-2222-4222-8222-222222222222'
  and gate_code = 'SPF_PASS';

update public.campaign_release_gates
set status = 'KILL'
where organization_id = '81111111-1111-4111-8111-111111111111'
  and campaign_id = '82222222-2222-4222-8222-222222222222'
  and gate_code = 'MAILBOX_HEALTHY';

do $$
begin
  if app.assess_first_send_batch('88888888-8888-4888-8888-888888888888') <> 'KILL' then
    raise exception 'kill gate must KILL';
  end if;
end;
$$;

update public.campaign_release_gates
set status = 'PASS'
where organization_id = '81111111-1111-4111-8111-111111111111'
  and campaign_id = '82222222-2222-4222-8222-222222222222'
  and gate_code = 'MAILBOX_HEALTHY';

update public.first_send_batches
set manifest_sha256 = repeat('c', 64)
where id = '88888888-8888-4888-8888-888888888888';

do $$
begin
  if app.assess_first_send_batch('88888888-8888-4888-8888-888888888888') <> 'KILL' then
    raise exception 'manifest drift must KILL';
  end if;
end;
$$;

update public.first_send_batches
set manifest_sha256 = repeat('a', 64)
where id = '88888888-8888-4888-8888-888888888888';

insert into public.suppression_entries (
  organization_id, kind, normalized_email, reason
) values (
  '81111111-1111-4111-8111-111111111111',
  'DNC',
  'contact-1@account-1.invalid',
  'M6 synthetic suppression test'
);

do $$
begin
  if app.assess_first_send_batch('88888888-8888-4888-8888-888888888888') <> 'EXTEND' then
    raise exception 'suppressed contact must EXTEND';
  end if;
end;
$$;

delete from public.suppression_entries
where organization_id = '81111111-1111-4111-8111-111111111111'
  and normalized_email = 'contact-1@account-1.invalid';

update public.contacts
set normalized_email = 'changed-contact@account-1.invalid'
where normalized_email = 'contact-1@account-1.invalid';

do $$
begin
  if app.assess_first_send_batch('88888888-8888-4888-8888-888888888888') <> 'EXTEND' then
    raise exception 'recipient identity drift must EXTEND';
  end if;
end;
$$;

update public.contacts
set normalized_email = 'contact-1@account-1.invalid'
where normalized_email = 'changed-contact@account-1.invalid';

update public.sequence_versions
set content_sha256 = repeat('f', 64)
where id = '83333333-3333-4333-8333-333333333333';

do $$
begin
  if app.assess_first_send_batch('88888888-8888-4888-8888-888888888888') <> 'EXTEND' then
    raise exception 'sequence content drift must EXTEND';
  end if;
end;
$$;

update public.sequence_versions
set content_sha256 = repeat('b', 64)
where id = '83333333-3333-4333-8333-333333333333';

do $$
declare
  first_enrollment uuid;
begin
  select enrollment_id into first_enrollment from m6_ids order by row_number limit 1;

  insert into public.messages (
    organization_id, enrollment_id, mailbox_id, contact_id, direction, status,
    touch_number, normalized_to, normalized_from, subject, body_text,
    idempotency_key, correlation_id
  ) values (
    '81111111-1111-4111-8111-111111111111',
    first_enrollment,
    '84444444-4444-4444-8444-444444444444',
    (select contact_id from m6_ids where enrollment_id = first_enrollment),
    'OUTBOUND',
    'DRY_RUN',
    1,
    'contact-1@account-1.invalid',
    'francisco@synthetic.invalid',
    'SENTINEL_SUBJECT_M6',
    'SENTINEL_BODY_M6',
    'm6-dry-run-1',
    '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );

  begin
    insert into public.messages (
      organization_id, enrollment_id, mailbox_id, contact_id, direction, status,
      touch_number, normalized_to, normalized_from, subject, body_text,
      idempotency_key, correlation_id
    ) values (
      '81111111-1111-4111-8111-111111111111',
      first_enrollment,
      '84444444-4444-4444-8444-444444444444',
      (select contact_id from m6_ids where enrollment_id = first_enrollment),
      'OUTBOUND',
      'QUEUED',
      1,
      'contact-1@account-1.invalid',
      'francisco@synthetic.invalid',
      'SENTINEL_FORBIDDEN_SUBJECT_M6',
      'SENTINEL_FORBIDDEN_BODY_M6',
      'm6-live-attempt-1',
      '8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    );
    raise exception 'expected runtime hold';
  exception when others then
    if sqlerrm <> 'FIRST_SEND_RUNTIME_HOLD' then raise; end if;
  end;

  begin
    insert into public.messages (
      organization_id, enrollment_id, mailbox_id, contact_id, direction, status,
      touch_number, normalized_to, normalized_from, subject, body_text,
      idempotency_key, correlation_id
    ) values (
      '81111111-1111-4111-8111-111111111111',
      first_enrollment,
      '84444444-4444-4444-8444-444444444444',
      (select contact_id from m6_ids where enrollment_id = first_enrollment),
      'OUTBOUND',
      'SENT',
      1,
      'contact-1@account-1.invalid',
      'francisco@synthetic.invalid',
      'SENTINEL_DIRECT_SENT_SUBJECT_M6',
      'SENTINEL_DIRECT_SENT_BODY_M6',
      'm6-direct-sent-1',
      '8eeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    );
    raise exception 'expected direct SENT rejection';
  exception when others then
    if sqlerrm <> 'FIRST_SEND_STATUS_TRANSITION_INVALID' then raise; end if;
  end;
end;
$$;

insert into public.organization_users (organization_id, user_id, role) values
  ('81111111-1111-4111-8111-111111111111', '8ccccccc-cccc-4ccc-8ccc-cccccccccccc', 'teckel_admin');

set role authenticated;
select set_config('request.jwt.claim.sub', '8ccccccc-cccc-4ccc-8ccc-cccccccccccc', false);

do $$
begin
  begin
    insert into public.approvals (
      organization_id, subject_type, subject_id, subject_sha256,
      decision, decided_by, rationale
    ) values (
      '81111111-1111-4111-8111-111111111111',
      'campaign_first_send_release',
      '82222222-2222-4222-8222-222222222222',
      repeat('a', 64),
      'APPROVED',
      '89999999-9999-4999-8999-999999999999',
      'forged actor attempt'
    );
    raise exception 'expected approval actor mismatch';
  exception when others then
    if sqlerrm <> 'APPROVAL_ACTOR_MISMATCH' then raise; end if;
  end;

  begin
    update public.first_send_batches
    set scheduled_for = '2025-02-05 15:30:00+00'
    where id = '88888888-8888-4888-8888-888888888888';
    raise exception 'expected operator update denial';
  exception when insufficient_privilege then null;
  end;

  begin
    perform app.finalize_first_send_batch('88888888-8888-4888-8888-888888888888');
    raise exception 'expected operator finalize denial';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;

update public.campaign_release_gates
set status = 'KILL'
where organization_id = '81111111-1111-4111-8111-111111111111'
  and campaign_id = '82222222-2222-4222-8222-222222222222'
  and gate_code = 'MAILBOX_HEALTHY';

set role service_role;

do $$
begin
  if app.finalize_first_send_batch('88888888-8888-4888-8888-888888888888') <> 'KILL' then
    raise exception 'service KILL finalization should return KILL';
  end if;
end;
$$;

reset role;

do $$
begin
  if exists (
    select 1
    from public.audit_log
    where record_type in ('campaign_release_gates', 'first_send_batches', 'first_send_batch_enrollments', 'messages')
      and coalesce(old_data::text, '') || coalesce(new_data::text, '') ~* '(SENTINEL_|contact-[0-9]@|subject|body_text|normalized_to|normalized_from)'
  ) then raise exception 'first-send audit contains non-allowlisted content'; end if;

  if (select count(*) from public.campaign_release_gates where campaign_id = '82222222-2222-4222-8222-222222222222') <> 30 then
    raise exception 'release gate count mismatch';
  end if;
  if (select count(*) from public.first_send_batch_enrollments where batch_id = '88888888-8888-4888-8888-888888888888') <> 5 then
    raise exception 'batch enrollment count mismatch';
  end if;
  if (select count(*) from public.messages where status = 'DRY_RUN') <> 1 then
    raise exception 'dry-run message count mismatch';
  end if;
  if exists (select 1 from public.messages where status in ('QUEUED', 'SENDING', 'SENT', 'DELIVERED')) then
    raise exception 'external outbound side effect persisted';
  end if;
  if (select status from public.first_send_batches where id = '88888888-8888-4888-8888-888888888888') <> 'KILLED' then
    raise exception 'batch was not killed';
  end if;
  if (select killed_at is null or approved_at is null from public.first_send_batches where id = '88888888-8888-4888-8888-888888888888') then
    raise exception 'killed batch did not preserve approval and kill history';
  end if;
end;
$$;

select 'FIRST_SEND_RELEASE_GATE_PASS' as result;
