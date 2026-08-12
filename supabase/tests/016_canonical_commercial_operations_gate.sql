\set ON_ERROR_STOP on

insert into public.organizations (id, slug, legal_name) values
  ('11111111-1111-4111-8111-111111111111', 'canonical-org-a', 'Canonical Org A'),
  ('22222222-2222-4222-8222-222222222222', 'canonical-org-b', 'Canonical Org B');
insert into public.organization_users (organization_id, user_id, role, active) values
  ('11111111-1111-4111-8111-111111111111', '81111111-1111-4111-8111-111111111111', 'teckel_admin', true),
  ('22222222-2222-4222-8222-222222222222', '82222222-2222-4222-8222-222222222222', 'teckel_admin', true);

insert into public.accounts (id, organization_id, legal_name, normalized_name, evidence_class) values
  ('21111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Current Account', 'current account', 'synthetic_demo'),
  ('21111111-1111-4111-8111-111111111112', '11111111-1111-4111-8111-111111111111', 'Expired Account', 'expired account', 'synthetic_demo'),
  ('21111111-1111-4111-8111-111111111113', '11111111-1111-4111-8111-111111111111', 'Pending Account', 'pending account', 'synthetic_demo'),
  ('22222222-2222-4222-8222-222222222221', '22222222-2222-4222-8222-222222222222', 'Cross Account', 'cross account', 'synthetic_demo');
insert into public.contacts (id, organization_id, account_id, full_name, role_title, normalized_email) values
  ('31111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111111', 'Synthetic Current', 'CEO', 'current@invalid.test'),
  ('31111111-1111-4111-8111-111111111112', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111112', 'Synthetic Expired', 'CEO', 'expired@invalid.test'),
  ('31111111-1111-4111-8111-111111111113', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111113', 'Synthetic Pending', 'CEO', 'pending@invalid.test'),
  ('32222222-2222-4222-8222-222222222221', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222221', 'Synthetic Cross', 'CEO', 'cross@invalid.test');

insert into public.campaigns (id, organization_id, name, manifest_json, manifest_sha256) values
  ('41111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Canonical A', '{}'::jsonb, repeat('1',64)),
  ('42222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'Canonical B', '{}'::jsonb, repeat('2',64));
insert into public.sequence_versions (id, organization_id, campaign_id, version, sender_name, sender_title, content_sha256) values
  ('42111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '41111111-1111-4111-8111-111111111111', 1, 'Synthetic', 'CEO', repeat('3',64)),
  ('42222222-2222-4222-8222-222222222223', '22222222-2222-4222-8222-222222222222', '42222222-2222-4222-8222-222222222222', 1, 'Synthetic', 'CEO', repeat('4',64));
insert into public.mailboxes (id, organization_id, normalized_email, domain, sender_name) values
  ('43111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'sender-a@invalid.test', 'invalid.test', 'Synthetic'),
  ('43222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'sender-b@invalid.test', 'invalid.test', 'Synthetic');
insert into public.campaign_enrollments (
  id, organization_id, campaign_id, sequence_version_id, account_id, contact_id, mailbox_id
) values
  ('44111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '41111111-1111-4111-8111-111111111111', '42111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111111', '43111111-1111-4111-8111-111111111111'),
  ('44111111-1111-4111-8111-111111111112', '11111111-1111-4111-8111-111111111111', '41111111-1111-4111-8111-111111111111', '42111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111112', '31111111-1111-4111-8111-111111111112', '43111111-1111-4111-8111-111111111111'),
  ('44222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', '42222222-2222-4222-8222-222222222222', '42222222-2222-4222-8222-222222222223', '22222222-2222-4222-8222-222222222221', '32222222-2222-4222-8222-222222222221', '43222222-2222-4222-8222-222222222222');

alter table public.messages disable trigger messages_scaled_release_gate;
insert into public.messages (
  id, organization_id, enrollment_id, mailbox_id, contact_id, direction, status,
  touch_number, normalized_to, normalized_from, idempotency_key, correlation_id, created_at
) values
  ('51111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '44111111-1111-4111-8111-111111111111', '43111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111111', 'OUTBOUND', 'QUEUED', 1, 'current@invalid.test', 'sender-a@invalid.test', 'canonical-current-first', '51111111-1111-4111-8111-111111111101', clock_timestamp() - interval '3 hours'),
  ('51111111-1111-4111-8111-111111111112', '11111111-1111-4111-8111-111111111111', '44111111-1111-4111-8111-111111111111', '43111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111111', 'OUTBOUND', 'DRY_RUN', 2, 'current@invalid.test', 'sender-a@invalid.test', 'canonical-current-dry', '51111111-1111-4111-8111-111111111102', clock_timestamp() - interval '2 hours'),
  ('51111111-1111-4111-8111-111111111121', '11111111-1111-4111-8111-111111111111', '44111111-1111-4111-8111-111111111112', '43111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111112', 'OUTBOUND', 'QUEUED', 1, 'expired@invalid.test', 'sender-a@invalid.test', 'canonical-expired-first', '51111111-1111-4111-8111-111111111121', clock_timestamp() - interval '14 months'),
  ('52222222-2222-4222-8222-222222222221', '22222222-2222-4222-8222-222222222222', '44222222-2222-4222-8222-222222222222', '43222222-2222-4222-8222-222222222222', '32222222-2222-4222-8222-222222222221', 'OUTBOUND', 'QUEUED', 1, 'cross@invalid.test', 'sender-b@invalid.test', 'canonical-cross-first', '52222222-2222-4222-8222-222222222201', clock_timestamp() - interval '1 hour');

do $$
begin
  if exists (select 1 from public.attribution_events) then
    raise exception 'DRY_RUN_OR_QUEUED_CREATED_ATTRIBUTION';
  end if;
end;
$$;

update public.messages set status = 'SENT', provider_message_id = 'provider-current-first', sent_at = clock_timestamp() - interval '2 hours'
where id = '51111111-1111-4111-8111-111111111111';
update public.messages set status = 'DELIVERED'
where id = '51111111-1111-4111-8111-111111111111';
insert into public.messages (
  id, organization_id, enrollment_id, mailbox_id, contact_id, direction, status,
  touch_number, normalized_to, normalized_from, idempotency_key, provider_message_id,
  correlation_id, sent_at, created_at
) values (
  '51111111-1111-4111-8111-111111111113', '11111111-1111-4111-8111-111111111111',
  '44111111-1111-4111-8111-111111111111', '43111111-1111-4111-8111-111111111111',
  '31111111-1111-4111-8111-111111111111', 'OUTBOUND', 'SENT', 3,
  'current@invalid.test', 'sender-a@invalid.test', 'canonical-current-second',
  'provider-current-second', '51111111-1111-4111-8111-111111111103',
  clock_timestamp() - interval '1 hour', clock_timestamp() - interval '1 hour'
);
update public.messages set status = 'SENT', provider_message_id = 'provider-expired-first', sent_at = clock_timestamp() - interval '14 months'
where id = '51111111-1111-4111-8111-111111111121';
alter table public.messages enable trigger messages_scaled_release_gate;

do $$
begin
  if (select count(*) from public.attribution_events) <> 2 then
    raise exception 'AUTOMATIC_ATTRIBUTION_EXACTLY_ONCE_FAILED';
  end if;
  if not exists (
    select 1 from public.attribution_events
    where account_id = '21111111-1111-4111-8111-111111111111'
      and first_contact_message_id = '51111111-1111-4111-8111-111111111111'
  ) then raise exception 'AUTOMATIC_ATTRIBUTION_DID_NOT_USE_EARLIEST_REAL_OUTBOUND'; end if;
end;
$$;

insert into public.leads (id, organization_id, account_id, contact_id, status, contractual_qualified, evidence_class) values
  ('61111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111111', 'CAPTURED', false, 'synthetic_demo'),
  ('61111111-1111-4111-8111-111111111112', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111112', '31111111-1111-4111-8111-111111111112', 'CAPTURED', false, 'synthetic_demo'),
  ('61111111-1111-4111-8111-111111111113', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111113', '31111111-1111-4111-8111-111111111113', 'CAPTURED', false, 'synthetic_demo'),
  ('62222222-2222-4222-8222-222222222221', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222221', '32222222-2222-4222-8222-222222222221', 'CAPTURED', false, 'synthetic_demo');

insert into public.source_evidence (
  id, organization_id, subject_type, subject_id, field_name, source_url, source_name,
  observed_at, confidence, value_json, checksum
) values
  ('71111111-1111-4111-8111-111111111101', '11111111-1111-4111-8111-111111111111', 'account', '21111111-1111-4111-8111-111111111111', 'industrial_over_100_kwp', 'https://evidence.invalid/a1', 'Synthetic', clock_timestamp(), 'VERIFIED', 'true', repeat('a',64)),
  ('71111111-1111-4111-8111-111111111102', '11111111-1111-4111-8111-111111111111', 'account', '21111111-1111-4111-8111-111111111111', 'outside_annex_a', 'https://evidence.invalid/a2', 'Synthetic', clock_timestamp(), 'VERIFIED', 'true', repeat('b',64)),
  ('71111111-1111-4111-8111-111111111103', '11111111-1111-4111-8111-111111111111', 'contact', '31111111-1111-4111-8111-111111111111', 'verified_target_role', 'https://evidence.invalid/a3', 'Synthetic', clock_timestamp(), 'VERIFIED', 'true', repeat('c',64)),
  ('71111111-1111-4111-8111-111111111104', '11111111-1111-4111-8111-111111111111', 'lead', '61111111-1111-4111-8111-111111111111', 'explicit_interest', 'https://evidence.invalid/a4', 'Synthetic', clock_timestamp(), 'VERIFIED', 'true', repeat('d',64)),
  ('71111111-1111-4111-8111-111111111121', '11111111-1111-4111-8111-111111111111', 'account', '21111111-1111-4111-8111-111111111112', 'industrial_over_100_kwp', 'https://evidence.invalid/b1', 'Synthetic', clock_timestamp(), 'VERIFIED', 'true', repeat('1',64)),
  ('71111111-1111-4111-8111-111111111122', '11111111-1111-4111-8111-111111111111', 'account', '21111111-1111-4111-8111-111111111112', 'outside_annex_a', 'https://evidence.invalid/b2', 'Synthetic', clock_timestamp(), 'VERIFIED', 'true', repeat('2',64)),
  ('71111111-1111-4111-8111-111111111123', '11111111-1111-4111-8111-111111111111', 'contact', '31111111-1111-4111-8111-111111111112', 'verified_target_role', 'https://evidence.invalid/b3', 'Synthetic', clock_timestamp(), 'VERIFIED', 'true', repeat('3',64)),
  ('71111111-1111-4111-8111-111111111124', '11111111-1111-4111-8111-111111111111', 'lead', '61111111-1111-4111-8111-111111111112', 'explicit_interest', 'https://evidence.invalid/b4', 'Synthetic', clock_timestamp(), 'VERIFIED', 'true', repeat('4',64)),
  ('72222222-2222-4222-8222-222222222201', '22222222-2222-4222-8222-222222222222', 'account', '22222222-2222-4222-8222-222222222221', 'industrial_over_100_kwp', 'https://evidence.invalid/c1', 'Synthetic', clock_timestamp(), 'VERIFIED', 'true', repeat('5',64)),
  ('72222222-2222-4222-8222-222222222202', '22222222-2222-4222-8222-222222222222', 'account', '22222222-2222-4222-8222-222222222221', 'outside_annex_a', 'https://evidence.invalid/c2', 'Synthetic', clock_timestamp(), 'VERIFIED', 'true', repeat('6',64)),
  ('72222222-2222-4222-8222-222222222203', '22222222-2222-4222-8222-222222222222', 'contact', '32222222-2222-4222-8222-222222222221', 'verified_target_role', 'https://evidence.invalid/c3', 'Synthetic', clock_timestamp(), 'VERIFIED', 'true', repeat('7',64)),
  ('72222222-2222-4222-8222-222222222204', '22222222-2222-4222-8222-222222222222', 'lead', '62222222-2222-4222-8222-222222222221', 'explicit_interest', 'https://evidence.invalid/c4', 'Synthetic', clock_timestamp(), 'VERIFIED', 'true', repeat('8',64));

set request.jwt.claim.sub = '81111111-1111-4111-8111-111111111111';
set request.jwt.claim.aal = 'aal2';
set role authenticated;

select app.qualify_lead_strict(
  '11111111-1111-4111-8111-111111111111', '61111111-1111-4111-8111-111111111111',
  true, true, true, true, 0,
  array['71111111-1111-4111-8111-111111111101','71111111-1111-4111-8111-111111111102','71111111-1111-4111-8111-111111111103','71111111-1111-4111-8111-111111111104']::uuid[]
);
select app.qualify_lead_strict(
  '11111111-1111-4111-8111-111111111111', '61111111-1111-4111-8111-111111111112',
  true, true, true, true, 0,
  array['71111111-1111-4111-8111-111111111121','71111111-1111-4111-8111-111111111122','71111111-1111-4111-8111-111111111123','71111111-1111-4111-8111-111111111124']::uuid[]
);

do $$
declare result jsonb;
begin
  begin
    perform app.create_opportunity_from_strict_lead(
      '11111111-1111-4111-8111-111111111111', '61111111-1111-4111-8111-111111111113',
      'PROSPECTING', 'opportunity-unqualified'
    );
    raise exception 'EXPECTED_UNQUALIFIED_LEAD_REJECTION';
  exception when others then
    if sqlerrm <> 'OPPORTUNITY_REQUIRES_STRICT_LEAD' then raise; end if;
  end;
  begin
    perform app.create_opportunity_from_strict_lead(
      '11111111-1111-4111-8111-111111111111', '62222222-2222-4222-8222-222222222221',
      'PROSPECTING', 'opportunity-cross-tenant'
    );
    raise exception 'EXPECTED_CROSS_TENANT_LEAD_REJECTION';
  exception when others then
    if sqlerrm <> 'STRICT_LEAD_NOT_FOUND_OR_TENANT_MISMATCH' then raise; end if;
  end;

  result := app.create_opportunity_from_strict_lead(
    '11111111-1111-4111-8111-111111111111', '61111111-1111-4111-8111-111111111111',
    'PROSPECTING', 'opportunity-current-ok'
  );
  if result->>'status' <> 'CREATED' then raise exception 'OPPORTUNITY_CREATE_FAILED'; end if;
  result := app.create_opportunity_from_strict_lead(
    '11111111-1111-4111-8111-111111111111', '61111111-1111-4111-8111-111111111111',
    'PROSPECTING', 'opportunity-current-ok'
  );
  if result->>'status' <> 'DUPLICATE' then raise exception 'OPPORTUNITY_IDEMPOTENCY_FAILED'; end if;
  begin
    perform app.create_opportunity_from_strict_lead(
      '11111111-1111-4111-8111-111111111111', '61111111-1111-4111-8111-111111111111',
      'CONVERSATION', 'opportunity-current-ok'
    );
    raise exception 'EXPECTED_OPPORTUNITY_IDEMPOTENCY_DRIFT';
  exception when others then
    if sqlerrm <> 'OPPORTUNITY_IDEMPOTENCY_DRIFT' then raise; end if;
  end;
  begin
    insert into public.opportunities (organization_id, account_id, lead_id)
    values ('11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111111', '61111111-1111-4111-8111-111111111111');
    raise exception 'EXPECTED_DIRECT_OPPORTUNITY_DML_REJECTION';
  exception when insufficient_privilege then null; end;
  if has_function_privilege(
    'authenticated', 'app.transition_opportunity(uuid,uuid,public.commercial_stage,numeric,text,timestamptz)', 'EXECUTE'
  ) then raise exception 'LEGACY_TRANSITION_OVERLOAD_EXPOSED'; end if;
end;
$$;

select (app.create_opportunity_from_strict_lead(
  '11111111-1111-4111-8111-111111111111', '61111111-1111-4111-8111-111111111112',
  'PROSPECTING', 'opportunity-expired-ok'
)->>'opportunity_id') as expired_opportunity_id \gset
select id as current_opportunity_id from public.opportunities
where organization_id = '11111111-1111-4111-8111-111111111111'
  and lead_id = '61111111-1111-4111-8111-111111111111' \gset

select app.transition_opportunity('11111111-1111-4111-8111-111111111111', :'current_opportunity_id', 'CONVERSATION', false, false, false, false, null, null, null);
select app.transition_opportunity('11111111-1111-4111-8111-111111111111', :'current_opportunity_id', 'MEETING_CONFIRMED', false, false, false, false, null, null, null);
select app.transition_opportunity('11111111-1111-4111-8111-111111111111', :'current_opportunity_id', 'DISCOVERY_HELD', false, false, false, false, null, null, null);
select app.transition_opportunity('11111111-1111-4111-8111-111111111111', :'current_opportunity_id', 'QUALIFIED', true, true, true, true, 100000, 'Review proposal', clock_timestamp() + interval '2 days');

do $$
begin
  begin
    perform app.transition_opportunity(
      '11111111-1111-4111-8111-111111111111',
      (select id from public.opportunities where lead_id = '61111111-1111-4111-8111-111111111111'),
      'QUALIFIED',
      true, false, true, true, 100000, 'Review proposal', clock_timestamp() + interval '2 days'
    );
    raise exception 'EXPECTED_QUALIFIED_DEGRADATION_REJECTION';
  exception when others then
    if sqlerrm <> 'QUALIFIED_PIPELINE_EVIDENCE_INCOMPLETE' then raise; end if;
  end;
end;
$$;

select (app.schedule_meeting(
  '11111111-1111-4111-8111-111111111111', :'current_opportunity_id',
  clock_timestamp() + interval '3 days', 'meeting-current-ok'
)->>'meeting_id') as current_meeting_id \gset

do $$
declare scheduled_at_value timestamptz;
  current_opportunity uuid;
  current_meeting uuid;
begin
  select id into current_opportunity from public.opportunities
  where lead_id = '61111111-1111-4111-8111-111111111111';
  select id, scheduled_at into current_meeting, scheduled_at_value from public.meetings
  where idempotency_key = encode(digest('meeting-current-ok', 'sha256'), 'hex');
  if app.schedule_meeting(
    '11111111-1111-4111-8111-111111111111', current_opportunity,
    scheduled_at_value, 'meeting-current-ok'
  )->>'status' <> 'DUPLICATE' then raise exception 'MEETING_IDEMPOTENCY_FAILED'; end if;
  begin
    perform app.schedule_meeting(
      '11111111-1111-4111-8111-111111111111', current_opportunity,
      scheduled_at_value + interval '1 hour', 'meeting-current-ok'
    );
    raise exception 'EXPECTED_MEETING_IDEMPOTENCY_DRIFT';
  exception when others then
    if sqlerrm <> 'MEETING_IDEMPOTENCY_DRIFT' then raise; end if;
  end;
  begin
    perform app.schedule_meeting(
      '11111111-1111-4111-8111-111111111111', gen_random_uuid(),
      clock_timestamp() + interval '3 days', 'meeting-cross-tenant'
    );
    raise exception 'EXPECTED_MEETING_TENANT_REJECTION';
  exception when others then
    if sqlerrm <> 'MEETING_OPPORTUNITY_NOT_FOUND_OR_TENANT_MISMATCH' then raise; end if;
  end;
  begin
    insert into public.meetings (organization_id, opportunity_id, scheduled_at, idempotency_key)
    values ('11111111-1111-4111-8111-111111111111', current_opportunity, clock_timestamp() + interval '1 day', repeat('9',64));
    raise exception 'EXPECTED_DIRECT_MEETING_DML_REJECTION';
  exception when insufficient_privilege then null; end;
end;
$$;

select app.record_meeting_outcome(
  '11111111-1111-4111-8111-111111111111', :'current_meeting_id',
  clock_timestamp(), true, 'Synthetic held meeting'
);

select app.transition_opportunity('11111111-1111-4111-8111-111111111111', :'current_opportunity_id', 'TECHNICAL_VISIT', true, true, true, true, 100000, 'Prepare proposal', clock_timestamp() + interval '2 days');
insert into public.proposals (organization_id, opportunity_id, version, value_mxn, delivered_at)
values ('11111111-1111-4111-8111-111111111111', :'current_opportunity_id', 'v1', 100000, clock_timestamp());
select app.transition_opportunity('11111111-1111-4111-8111-111111111111', :'current_opportunity_id', 'PROPOSAL', true, true, true, true, 100000, 'Decision', clock_timestamp() + interval '2 days');
select app.transition_opportunity('11111111-1111-4111-8111-111111111111', :'current_opportunity_id', 'DECISION', true, true, true, true, 100000, 'Sign', clock_timestamp() + interval '2 days');
insert into public.approvals (organization_id, subject_type, subject_id, subject_sha256, decision, decided_by)
values ('11111111-1111-4111-8111-111111111111', 'opportunity_closed_won', :'current_opportunity_id', repeat('9',64), 'APPROVED', '81111111-1111-4111-8111-111111111111');
select app.transition_opportunity('11111111-1111-4111-8111-111111111111', :'current_opportunity_id', 'CLOSED_WON', true, true, true, true, 100000, 'Handoff', clock_timestamp() + interval '2 days');

select app.transition_opportunity('11111111-1111-4111-8111-111111111111', :'expired_opportunity_id', 'CONVERSATION', false, false, false, false, null, null, null);
select app.transition_opportunity('11111111-1111-4111-8111-111111111111', :'expired_opportunity_id', 'MEETING_CONFIRMED', false, false, false, false, null, null, null);
select app.transition_opportunity('11111111-1111-4111-8111-111111111111', :'expired_opportunity_id', 'DISCOVERY_HELD', false, false, false, false, null, null, null);
select app.transition_opportunity('11111111-1111-4111-8111-111111111111', :'expired_opportunity_id', 'QUALIFIED', true, true, true, true, 50000, 'Next', clock_timestamp() + interval '2 days');
select app.transition_opportunity('11111111-1111-4111-8111-111111111111', :'expired_opportunity_id', 'TECHNICAL_VISIT', true, true, true, true, 50000, 'Next', clock_timestamp() + interval '2 days');
insert into public.proposals (organization_id, opportunity_id, version, value_mxn, delivered_at)
values ('11111111-1111-4111-8111-111111111111', :'expired_opportunity_id', 'v1', 50000, clock_timestamp());
select app.transition_opportunity('11111111-1111-4111-8111-111111111111', :'expired_opportunity_id', 'PROPOSAL', true, true, true, true, 50000, 'Next', clock_timestamp() + interval '2 days');
select app.transition_opportunity('11111111-1111-4111-8111-111111111111', :'expired_opportunity_id', 'DECISION', true, true, true, true, 50000, 'Next', clock_timestamp() + interval '2 days');
insert into public.approvals (organization_id, subject_type, subject_id, subject_sha256, decision, decided_by)
values ('11111111-1111-4111-8111-111111111111', 'opportunity_closed_won', :'expired_opportunity_id', repeat('8',64), 'APPROVED', '81111111-1111-4111-8111-111111111111');
select app.transition_opportunity('11111111-1111-4111-8111-111111111111', :'expired_opportunity_id', 'CLOSED_WON', true, true, true, true, 50000, 'Handoff', clock_timestamp() + interval '2 days');

select (clock_timestamp() - interval '30 minutes') as current_paid_at \gset
select clock_timestamp() as current_observed_at \gset
select app.record_first_payment_with_evidence(
  '11111111-1111-4111-8111-111111111111', :'current_opportunity_id', 100000,
  :'current_paid_at', 'https://evidence.invalid/payment-current', 'Synthetic bank',
  :'current_observed_at', 'VERIFIED', repeat('e',64), 'payment-current-auto-commission'
);
select (clock_timestamp() - interval '30 minutes') as expired_paid_at \gset
select clock_timestamp() as expired_observed_at \gset
select app.record_first_payment_with_evidence(
  '11111111-1111-4111-8111-111111111111', :'expired_opportunity_id', 50000,
  :'expired_paid_at', 'https://evidence.invalid/payment-expired', 'Synthetic bank',
  :'expired_observed_at', 'VERIFIED', repeat('f',64), 'payment-expired-review'
);
select app.record_first_payment_with_evidence(
  '11111111-1111-4111-8111-111111111111', :'current_opportunity_id', 100000,
  :'current_paid_at', 'https://evidence.invalid/payment-current', 'Synthetic bank',
  :'current_observed_at', 'VERIFIED', repeat('e',64), 'payment-current-auto-commission'
);

do $$
declare
  current_opportunity uuid;
  current_paid_at timestamptz;
begin
  select o.id, p.paid_at into current_opportunity, current_paid_at
  from public.opportunities o
  join public.payments p on p.organization_id = o.organization_id and p.opportunity_id = o.id
  where o.lead_id = '61111111-1111-4111-8111-111111111111';
  begin
    perform app.record_first_payment_with_evidence(
      '11111111-1111-4111-8111-111111111111', current_opportunity, 100001,
      current_paid_at, 'https://evidence.invalid/payment-current-drift', 'Synthetic bank',
      clock_timestamp(), 'VERIFIED', repeat('0',64), 'payment-current-auto-commission'
    );
    raise exception 'EXPECTED_PAYMENT_IDEMPOTENCY_DRIFT';
  exception when others then
    if sqlerrm <> 'FIRST_PAYMENT_IDEMPOTENCY_CONFLICT' then raise; end if;
  end;
  if exists (select 1 from public.source_evidence where checksum = repeat('0',64)) then
    raise exception 'ATOMIC_PAYMENT_DRIFT_LEFT_ORPHAN_EVIDENCE';
  end if;
  if (select count(*) from public.payments) <> 2 then
    raise exception 'PAYMENT_IDEMPOTENCY_CREATED_DUPLICATE';
  end if;
  if (select count(*) from public.commissions) <> 1
    or (select commission_rate from public.commissions) <> 0.02
    or (select commission_mxn from public.commissions) <> 2000.00
  then raise exception 'AUTOMATIC_COMMISSION_INVALID'; end if;
  if not exists (
    select 1 from public.tasks
    where organization_id = '11111111-1111-4111-8111-111111111111'
      and account_id = '21111111-1111-4111-8111-111111111112'
      and task_type = 'ATTRIBUTION_REVIEW'
      and normalized_objective = 'FIRST_PAYMENT_WITHOUT_ACTIVE_ATTRIBUTION'
      and status = 'OPEN'
  ) then raise exception 'EXPIRED_ATTRIBUTION_FOLLOW_UP_MISSING'; end if;
  if not exists (
    select 1 from public.event_outbox
    where event_type = 'payment.attribution_review_required'
      and payload_json->>'reason_code' = 'NO_ACTIVE_ATTRIBUTION'
  ) then raise exception 'EXPIRED_ATTRIBUTION_OUTBOX_MISSING'; end if;
  if has_function_privilege(
    'authenticated', 'app.record_earned_commission(uuid,uuid,uuid,uuid,text)', 'EXECUTE'
  ) then raise exception 'MANUAL_COMMISSION_RPC_EXPOSED'; end if;
  if has_function_privilege(
    'authenticated', 'app.record_first_payment(uuid,uuid,numeric,timestamptz,uuid,text)', 'EXECUTE'
  ) then raise exception 'LOW_LEVEL_PAYMENT_RPC_EXPOSED'; end if;
  begin
    update public.opportunities set value_mxn = 1
    where lead_id = '61111111-1111-4111-8111-111111111111';
    raise exception 'EXPECTED_DIRECT_OPPORTUNITY_UPDATE_REJECTION';
  exception when insufficient_privilege then null; end;
end;
$$;

reset role;
reset request.jwt.claim.aal;
reset request.jwt.claim.sub;

do $$
begin
  if exists (
    select 1 from public.opportunities
    where creation_idempotency_key is not null and creation_idempotency_key !~ '^[a-f0-9]{64}$'
  ) or exists (
    select 1 from public.meetings where idempotency_key !~ '^[a-f0-9]{64}$'
  ) then raise exception 'CANONICAL_IDEMPOTENCY_KEY_NOT_HASHED'; end if;
  if (select count(*) from public.event_outbox where event_type = 'attribution.first_contact_recorded') <> 2 then
    raise exception 'AUTOMATIC_ATTRIBUTION_OUTBOX_COUNT_INVALID';
  end if;
end;
$$;

\echo 'CANONICAL_COMMERCIAL_OPERATIONS_GATE_PASS'
