\set ON_ERROR_STOP on

insert into public.organizations (id, slug, legal_name) values
  ('11111111-1111-4111-8111-111111111111', 'commercial-org-a', 'Commercial Org A'),
  ('22222222-2222-4222-8222-222222222222', 'commercial-org-b', 'Commercial Org B');

insert into public.organization_users (organization_id, user_id, role, active) values
  ('11111111-1111-4111-8111-111111111111', '81111111-1111-4111-8111-111111111111', 'teckel_admin', true),
  ('22222222-2222-4222-8222-222222222222', '82222222-2222-4222-8222-222222222222', 'teckel_admin', true);

insert into public.accounts (id, organization_id, legal_name, normalized_name, evidence_class) values
  ('21111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Current Account', 'current account', 'synthetic_demo'),
  ('21111111-1111-4111-8111-111111111112', '11111111-1111-4111-8111-111111111111', 'Expired Account', 'expired account', 'synthetic_demo'),
  ('22222222-2222-4222-8222-222222222221', '22222222-2222-4222-8222-222222222222', 'Cross Tenant Account', 'cross tenant account', 'synthetic_demo');

insert into public.contacts (id, organization_id, account_id, full_name, role_title, normalized_email) values
  ('31111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111111', 'Synthetic One', 'CEO', 'synthetic-one@invalid.test'),
  ('31111111-1111-4111-8111-111111111112', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111112', 'Synthetic Two', 'CEO', 'synthetic-two@invalid.test'),
  ('32222222-2222-4222-8222-222222222221', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222221', 'Synthetic Cross', 'CEO', 'synthetic-cross@invalid.test');

insert into public.campaigns (id, organization_id, name, manifest_json, manifest_sha256) values
  ('41111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Synthetic Campaign A', '{}'::jsonb, repeat('1', 64)),
  ('42222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'Synthetic Campaign B', '{}'::jsonb, repeat('2', 64));

insert into public.sequence_versions (id, organization_id, campaign_id, version, sender_name, sender_title, content_sha256) values
  ('42111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '41111111-1111-4111-8111-111111111111', 1, 'Synthetic', 'CEO', repeat('3', 64)),
  ('42222222-2222-4222-8222-222222222223', '22222222-2222-4222-8222-222222222222', '42222222-2222-4222-8222-222222222222', 1, 'Synthetic', 'CEO', repeat('4', 64));

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
  touch_number, normalized_to, normalized_from, idempotency_key,
  provider_message_id, correlation_id, sent_at, created_at
) values
  ('51111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '44111111-1111-4111-8111-111111111111', '43111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111111', 'OUTBOUND', 'SENT', 1, 'synthetic-one@invalid.test', 'sender-a@invalid.test', 'msg-current-first', 'provider-current-first', '51111111-1111-4111-8111-111111111101', '2026-08-10 15:00:00+00', '2026-08-10 15:00:00+00'),
  ('51111111-1111-4111-8111-111111111112', '11111111-1111-4111-8111-111111111111', '44111111-1111-4111-8111-111111111111', '43111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111111', 'OUTBOUND', 'DELIVERED', 2, 'synthetic-one@invalid.test', 'sender-a@invalid.test', 'msg-current-second', 'provider-current-second', '51111111-1111-4111-8111-111111111102', '2026-08-11 15:00:00+00', '2026-08-11 15:00:00+00'),
  ('51111111-1111-4111-8111-111111111113', '11111111-1111-4111-8111-111111111111', '44111111-1111-4111-8111-111111111111', '43111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111111', 'INBOUND', 'DELIVERED', null, 'sender-a@invalid.test', 'synthetic-one@invalid.test', 'msg-current-reply', 'provider-current-reply', '51111111-1111-4111-8111-111111111103', null, '2026-08-11 16:00:00+00'),
  ('51111111-1111-4111-8111-111111111121', '11111111-1111-4111-8111-111111111111', '44111111-1111-4111-8111-111111111112', '43111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111112', 'OUTBOUND', 'SENT', 1, 'synthetic-two@invalid.test', 'sender-a@invalid.test', 'msg-expired-first', 'provider-expired-first', '51111111-1111-4111-8111-111111111121', '2025-06-01 15:00:00+00', '2025-06-01 15:00:00+00'),
  ('51111111-1111-4111-8111-111111111123', '11111111-1111-4111-8111-111111111111', '44111111-1111-4111-8111-111111111112', '43111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111112', 'INBOUND', 'DELIVERED', null, 'sender-a@invalid.test', 'synthetic-two@invalid.test', 'msg-expired-reply', 'provider-expired-reply', '51111111-1111-4111-8111-111111111123', null, '2025-06-02 15:00:00+00'),
  ('52222222-2222-4222-8222-222222222221', '22222222-2222-4222-8222-222222222222', '44222222-2222-4222-8222-222222222222', '43222222-2222-4222-8222-222222222222', '32222222-2222-4222-8222-222222222221', 'OUTBOUND', 'SENT', 1, 'synthetic-cross@invalid.test', 'sender-b@invalid.test', 'msg-cross-first', 'provider-cross-first', '52222222-2222-4222-8222-222222222221', '2026-08-10 14:00:00+00', '2026-08-10 14:00:00+00');
alter table public.messages enable trigger messages_scaled_release_gate;

insert into public.leads (
  id, organization_id, account_id, contact_id, origin_message_id,
  status, contractual_qualified, qualification_reason, evidence_class
) values
  ('61111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111111', '51111111-1111-4111-8111-111111111113', 'CAPTURED', false, 'TEST_PENDING', 'synthetic_demo'),
  ('61111111-1111-4111-8111-111111111112', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111112', '31111111-1111-4111-8111-111111111112', '51111111-1111-4111-8111-111111111123', 'CAPTURED', false, 'TEST_PENDING', 'synthetic_demo');

insert into public.source_evidence (
  id, organization_id, subject_type, subject_id, field_name, source_url, source_name,
  observed_at, confidence, value_json, checksum
) values
  ('71111111-1111-4111-8111-111111111101', '11111111-1111-4111-8111-111111111111', 'account', '21111111-1111-4111-8111-111111111111', 'industrial_over_100_kwp', 'https://evidence.invalid/industrial-a', 'Synthetic source', '2026-08-11 18:00:00+00', 'VERIFIED', 'true', repeat('a', 64)),
  ('71111111-1111-4111-8111-111111111102', '11111111-1111-4111-8111-111111111111', 'account', '21111111-1111-4111-8111-111111111111', 'outside_annex_a', 'https://evidence.invalid/annex-a', 'Synthetic source', '2026-08-11 18:00:00+00', 'HIGH', 'true', repeat('b', 64)),
  ('71111111-1111-4111-8111-111111111103', '11111111-1111-4111-8111-111111111111', 'contact', '31111111-1111-4111-8111-111111111111', 'verified_target_role', 'https://evidence.invalid/role-a', 'Synthetic source', '2026-08-11 18:00:00+00', 'VERIFIED', 'true', repeat('c', 64)),
  ('71111111-1111-4111-8111-111111111104', '11111111-1111-4111-8111-111111111111', 'message', '51111111-1111-4111-8111-111111111113', 'explicit_interest', 'https://evidence.invalid/interest-a', 'Synthetic source', '2026-08-11 18:00:00+00', 'HIGH', 'true', repeat('d', 64)),
  ('71111111-1111-4111-8111-111111111105', '11111111-1111-4111-8111-111111111111', 'message', '51111111-1111-4111-8111-111111111113', 'wrong_field', 'https://evidence.invalid/wrong-a', 'Synthetic source', '2026-08-11 18:00:00+00', 'VERIFIED', '{"note":"SENTINEL-PII-CONTENT"}', repeat('e', 64)),
  ('71111111-1111-4111-8111-111111111106', '11111111-1111-4111-8111-111111111111', 'message', '51111111-1111-4111-8111-111111111113', 'explicit_interest', 'https://evidence.invalid/low-a', 'Synthetic source', '2026-08-11 18:00:00+00', 'LOW', 'true', repeat('f', 64)),
  ('72222222-2222-4222-8222-222222222201', '22222222-2222-4222-8222-222222222222', 'account', '22222222-2222-4222-8222-222222222221', 'industrial_over_100_kwp', 'https://evidence.invalid/cross', 'Synthetic source', '2026-08-11 18:00:00+00', 'VERIFIED', 'true', repeat('9', 64)),
  ('71111111-1111-4111-8111-111111111121', '11111111-1111-4111-8111-111111111111', 'account', '21111111-1111-4111-8111-111111111112', 'industrial_over_100_kwp', 'https://evidence.invalid/industrial-b', 'Synthetic source', '2026-08-11 18:00:00+00', 'VERIFIED', 'true', repeat('1', 64)),
  ('71111111-1111-4111-8111-111111111122', '11111111-1111-4111-8111-111111111111', 'account', '21111111-1111-4111-8111-111111111112', 'outside_annex_a', 'https://evidence.invalid/annex-b', 'Synthetic source', '2026-08-11 18:00:00+00', 'VERIFIED', 'true', repeat('2', 64)),
  ('71111111-1111-4111-8111-111111111123', '11111111-1111-4111-8111-111111111111', 'contact', '31111111-1111-4111-8111-111111111112', 'verified_target_role', 'https://evidence.invalid/role-b', 'Synthetic source', '2026-08-11 18:00:00+00', 'VERIFIED', 'true', repeat('3', 64)),
  ('71111111-1111-4111-8111-111111111124', '11111111-1111-4111-8111-111111111111', 'message', '51111111-1111-4111-8111-111111111123', 'explicit_interest', 'https://evidence.invalid/interest-b', 'Synthetic source', '2026-08-11 18:00:00+00', 'VERIFIED', 'true', repeat('4', 64));

set request.jwt.claim.sub = '81111111-1111-4111-8111-111111111111';
set request.jwt.claim.aal = 'aal2';
set role authenticated;

do $$
begin
  begin
    perform app.qualify_lead_strict(
      '11111111-1111-4111-8111-111111111111', '61111111-1111-4111-8111-111111111111',
      true, true, true, true, 0,
      array['71111111-1111-4111-8111-111111111101','71111111-1111-4111-8111-111111111102','71111111-1111-4111-8111-111111111103','79999999-9999-4999-8999-999999999999']::uuid[]
    );
    raise exception 'EXPECTED_ARBITRARY_EVIDENCE_REJECTION';
  exception when others then
    if sqlerrm <> 'QUALIFICATION_EVIDENCE_NOT_FOUND_OR_TENANT_MISMATCH' then raise; end if;
  end;

  begin
    perform app.qualify_lead_strict(
      '11111111-1111-4111-8111-111111111111', '61111111-1111-4111-8111-111111111111',
      true, true, true, true, 0,
      array['71111111-1111-4111-8111-111111111101','71111111-1111-4111-8111-111111111102','71111111-1111-4111-8111-111111111103','72222222-2222-4222-8222-222222222201']::uuid[]
    );
    raise exception 'EXPECTED_CROSS_TENANT_EVIDENCE_REJECTION';
  exception when others then
    if sqlerrm <> 'QUALIFICATION_EVIDENCE_NOT_FOUND_OR_TENANT_MISMATCH' then raise; end if;
  end;

  begin
    perform app.qualify_lead_strict(
      '11111111-1111-4111-8111-111111111111', '61111111-1111-4111-8111-111111111111',
      true, true, true, true, 0,
      array['71111111-1111-4111-8111-111111111101','71111111-1111-4111-8111-111111111102','71111111-1111-4111-8111-111111111103','71111111-1111-4111-8111-111111111105']::uuid[]
    );
    raise exception 'EXPECTED_WRONG_FIELD_REJECTION';
  exception when others then
    if sqlerrm <> 'QUALIFICATION_EVIDENCE_FIELD_INVALID' then raise; end if;
  end;

  begin
    perform app.qualify_lead_strict(
      '11111111-1111-4111-8111-111111111111', '61111111-1111-4111-8111-111111111111',
      true, true, true, true, 0,
      array['71111111-1111-4111-8111-111111111101','71111111-1111-4111-8111-111111111102','71111111-1111-4111-8111-111111111103','71111111-1111-4111-8111-111111111106']::uuid[]
    );
    raise exception 'EXPECTED_LOW_CONFIDENCE_REJECTION';
  exception when others then
    if sqlerrm <> 'QUALIFICATION_EVIDENCE_NOT_VERIFIABLE' then raise; end if;
  end;
end;
$$;

select app.qualify_lead_strict(
  '11111111-1111-4111-8111-111111111111', '61111111-1111-4111-8111-111111111111',
  true, true, true, true, 0,
  array['71111111-1111-4111-8111-111111111101','71111111-1111-4111-8111-111111111102','71111111-1111-4111-8111-111111111103','71111111-1111-4111-8111-111111111104']::uuid[]
) as qualification_a \gset

select app.qualify_lead_strict(
  '11111111-1111-4111-8111-111111111111', '61111111-1111-4111-8111-111111111112',
  true, true, true, true, 0,
  array['71111111-1111-4111-8111-111111111121','71111111-1111-4111-8111-111111111122','71111111-1111-4111-8111-111111111123','71111111-1111-4111-8111-111111111124']::uuid[]
) as qualification_b \gset

do $$
begin
  if (select count(*) from public.qualification_evidence_links) <> 8 then
    raise exception 'RELATIONAL_EVIDENCE_LINK_COUNT_INVALID';
  end if;
  begin
    update public.leads set qualification_reason = 'FORGED'
    where id = '61111111-1111-4111-8111-111111111111';
    raise exception 'EXPECTED_DIRECT_LEAD_DML_REJECTION';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.qualification_checks (organization_id, lead_id)
    values ('11111111-1111-4111-8111-111111111111', '61111111-1111-4111-8111-111111111111');
    raise exception 'EXPECTED_DIRECT_QUALIFICATION_DML_REJECTION';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.source_evidence (
      organization_id, subject_type, subject_id, field_name, source_name,
      observed_at, confidence, value_json
    ) values (
      '11111111-1111-4111-8111-111111111111', 'lead',
      '61111111-1111-4111-8111-111111111111', 'explicit_interest', 'Forged',
      now(), 'VERIFIED', 'true'
    );
    raise exception 'EXPECTED_DIRECT_SOURCE_EVIDENCE_DML_REJECTION';
  exception when insufficient_privilege then null; end;
end;
$$;

insert into public.opportunities (
  id, organization_id, account_id, lead_id, stage,
  economic_buyer, active_pain, business_impact, timing_under_90_days,
  value_mxn, next_action, next_action_at
) values
  ('81111111-1111-4111-8111-111111111101', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111111', '61111111-1111-4111-8111-111111111111', 'PROSPECTING', true, true, true, true, 100000, 'Synthetic next action', '2026-08-20 15:00:00+00'),
  ('81111111-1111-4111-8111-111111111102', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111112', '61111111-1111-4111-8111-111111111112', 'PROSPECTING', true, true, true, true, 50000, 'Synthetic next action', '2026-08-20 15:00:00+00');

update public.opportunities set stage = 'CONVERSATION' where organization_id = '11111111-1111-4111-8111-111111111111';
update public.opportunities set stage = 'MEETING_CONFIRMED' where organization_id = '11111111-1111-4111-8111-111111111111';
update public.opportunities set stage = 'DISCOVERY_HELD' where organization_id = '11111111-1111-4111-8111-111111111111';
update public.opportunities set stage = 'QUALIFIED' where organization_id = '11111111-1111-4111-8111-111111111111';

do $$
begin
  begin
    update public.opportunities set active_pain = false
    where id = '81111111-1111-4111-8111-111111111101';
    raise exception 'EXPECTED_POST_QUALIFIED_DEGRADATION_REJECTION';
  exception when others then
    if sqlerrm <> 'QUALIFIED_PIPELINE_EVIDENCE_INCOMPLETE' then raise; end if;
  end;
end;
$$;

insert into public.approvals (
  organization_id, subject_type, subject_id, subject_sha256, decision, decided_by
) values
  ('11111111-1111-4111-8111-111111111111', 'opportunity_closed_won', '81111111-1111-4111-8111-111111111101', repeat('7', 64), 'APPROVED', '81111111-1111-4111-8111-111111111111'),
  ('11111111-1111-4111-8111-111111111111', 'opportunity_closed_won', '81111111-1111-4111-8111-111111111102', repeat('8', 64), 'APPROVED', '81111111-1111-4111-8111-111111111111');
update public.opportunities set stage = 'CLOSED_WON' where organization_id = '11111111-1111-4111-8111-111111111111';

do $$
begin
  begin
    perform app.record_first_contact_attribution(
      '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111111',
      '51111111-1111-4111-8111-111111111112', 'attribution-current-wrong'
    );
    raise exception 'EXPECTED_NON_FIRST_ATTRIBUTION_REJECTION';
  exception when others then
    if sqlerrm <> 'ATTRIBUTION_MESSAGE_NOT_FIRST' then raise; end if;
  end;
  begin
    perform app.record_first_contact_attribution(
      '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111111',
      '52222222-2222-4222-8222-222222222221', 'attribution-cross-wrong'
    );
    raise exception 'EXPECTED_CROSS_TENANT_ATTRIBUTION_REJECTION';
  exception when others then
    if sqlerrm <> 'ATTRIBUTION_MESSAGE_NOT_REAL_OR_TENANT_MISMATCH' then raise; end if;
  end;
end;
$$;

select (app.record_first_contact_attribution(
  '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111111',
  '51111111-1111-4111-8111-111111111111', 'attribution-current-ok'
)->>'attribution_event_id') as current_attribution_id \gset
select (app.record_first_contact_attribution(
  '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111112',
  '51111111-1111-4111-8111-111111111121', 'attribution-expired-ok'
)->>'attribution_event_id') as expired_attribution_id \gset

reset role;
reset request.jwt.claim.aal;
reset request.jwt.claim.sub;

insert into public.source_evidence (
  id, organization_id, subject_type, subject_id, field_name, source_url, source_name,
  observed_at, confidence, value_json, checksum
) values
  ('91111111-1111-4111-8111-111111111101', '11111111-1111-4111-8111-111111111111', 'opportunity', '81111111-1111-4111-8111-111111111101', 'first_payment_mxn', 'https://evidence.invalid/payment-a', 'Synthetic bank proof', '2026-08-11 13:00:00+00', 'VERIFIED', '{"amount_mxn":100000,"paid_at":"2026-08-11T12:00:00+00:00"}', repeat('5', 64)),
  ('91111111-1111-4111-8111-111111111102', '11111111-1111-4111-8111-111111111111', 'opportunity', '81111111-1111-4111-8111-111111111102', 'first_payment_mxn', 'https://evidence.invalid/payment-b', 'Synthetic bank proof', '2026-08-11 13:00:00+00', 'VERIFIED', '{"amount_mxn":50000,"paid_at":"2026-08-11T12:00:00+00:00"}', repeat('6', 64));

set request.jwt.claim.sub = '81111111-1111-4111-8111-111111111111';
set request.jwt.claim.aal = 'aal2';
set role authenticated;

do $$
begin
  begin
    perform app.record_first_payment(
      '11111111-1111-4111-8111-111111111111', '81111111-1111-4111-8111-111111111101',
      100000, '2026-08-11 12:00:00+00', '99999999-9999-4999-8999-999999999999', 'payment-no-evidence'
    );
    raise exception 'EXPECTED_PAYMENT_WITHOUT_EVIDENCE_REJECTION';
  exception when others then
    if sqlerrm <> 'FIRST_PAYMENT_EVIDENCE_NOT_VERIFIED' then raise; end if;
  end;
end;
$$;

select (app.record_first_payment(
  '11111111-1111-4111-8111-111111111111', '81111111-1111-4111-8111-111111111101',
  100000, '2026-08-11 12:00:00+00', '91111111-1111-4111-8111-111111111101', 'payment-current-ok'
)->>'payment_id') as current_payment_id \gset
select (app.record_first_payment(
  '11111111-1111-4111-8111-111111111111', '81111111-1111-4111-8111-111111111102',
  50000, '2026-08-11 12:00:00+00', '91111111-1111-4111-8111-111111111102', 'payment-expired-ok'
)->>'payment_id') as expired_payment_id \gset

do $$
declare duplicate_result jsonb;
begin
  duplicate_result := app.record_first_payment(
    '11111111-1111-4111-8111-111111111111', '81111111-1111-4111-8111-111111111101',
    100000, '2026-08-11 12:00:00+00', '91111111-1111-4111-8111-111111111101', 'payment-current-ok'
  );
  if duplicate_result ->> 'status' <> 'DUPLICATE' then
    raise exception 'PAYMENT_IDEMPOTENCY_FAILED';
  end if;
  begin
    perform app.record_earned_commission(
      '11111111-1111-4111-8111-111111111111', '81111111-1111-4111-8111-111111111102',
      (select id from public.payments where idempotency_key = encode(digest('payment-expired-ok', 'sha256'), 'hex')),
      (select id from public.attribution_events where idempotency_key = encode(digest('attribution-expired-ok', 'sha256'), 'hex')),
      'commission-expired-reject'
    );
    raise exception 'EXPECTED_EXPIRED_ATTRIBUTION_REJECTION';
  exception when others then
    if sqlerrm <> 'COMMISSION_NOT_EARNED' then raise; end if;
  end;
end;
$$;

select app.record_earned_commission(
  '11111111-1111-4111-8111-111111111111', '81111111-1111-4111-8111-111111111101',
  :'current_payment_id', :'current_attribution_id', 'commission-current-ok'
) as commission_result \gset

do $$
begin
  begin
    insert into public.payments (
      organization_id, opportunity_id, amount_mxn, paid_at, is_first_payment,
      evidence_record_id, idempotency_key
    ) values (
      '11111111-1111-4111-8111-111111111111', '81111111-1111-4111-8111-111111111101',
      1, now(), true, '91111111-1111-4111-8111-111111111101', 'direct-payment-forged'
    );
    raise exception 'EXPECTED_DIRECT_PAYMENT_DML_REJECTION';
  exception when insufficient_privilege then null; end;
  begin
    update public.attribution_events set attribution_expires_at = now()
    where id = (select id from public.attribution_events where idempotency_key = encode(digest('attribution-current-ok', 'sha256'), 'hex'));
    raise exception 'EXPECTED_DIRECT_ATTRIBUTION_DML_REJECTION';
  exception when insufficient_privilege then null; end;
  begin
    update public.commissions set commission_rate = 0.50;
    raise exception 'EXPECTED_DIRECT_COMMISSION_DML_REJECTION';
  exception when insufficient_privilege then null; end;
end;
$$;

reset role;
reset request.jwt.claim.aal;
reset request.jwt.claim.sub;

do $$
begin
  begin
    update public.source_evidence set source_name = 'Mutated'
    where id = '71111111-1111-4111-8111-111111111101';
    raise exception 'EXPECTED_SOURCE_EVIDENCE_APPEND_ONLY_REJECTION';
  exception when others then
    if sqlerrm <> 'SOURCE_EVIDENCE_APPEND_ONLY' then raise; end if;
  end;
  begin
    update public.payments set amount_mxn = amount_mxn + 1
    where id = (select id from public.payments where idempotency_key = encode(digest('payment-current-ok', 'sha256'), 'hex'));
    raise exception 'EXPECTED_PAYMENT_APPEND_ONLY_REJECTION';
  exception when others then
    if sqlerrm <> 'COMMERCIAL_INTEGRITY_EVENT_APPEND_ONLY:payments' then raise; end if;
  end;
  if exists (
    select 1 from public.audit_log
    where coalesce(old_data::text, '') like '%SENTINEL-PII-CONTENT%'
       or coalesce(new_data::text, '') like '%SENTINEL-PII-CONTENT%'
  ) then raise exception 'COMMERCIAL_AUDIT_LEAKED_SENTINEL_CONTENT'; end if;
  if exists (
    select 1 from (
      select idempotency_key from public.payments
      union all select idempotency_key from public.attribution_events
      union all select idempotency_key from public.commissions
    ) commercial_keys
    where idempotency_key !~ '^[a-f0-9]{64}$'
  ) then raise exception 'COMMERCIAL_IDEMPOTENCY_KEY_NOT_HASHED'; end if;
  if exists (
    select 1 from public.audit_log
    where coalesce(old_data::text, '') like '%payment-current-ok%'
       or coalesce(new_data::text, '') like '%payment-current-ok%'
  ) or exists (
    select 1 from public.event_outbox
    where idempotency_key like '%payment-current-ok%'
       or payload_json::text like '%payment-current-ok%'
  ) then raise exception 'COMMERCIAL_IDEMPOTENCY_RAW_VALUE_PERSISTED'; end if;
  if (select count(*) from public.event_outbox where event_type in (
    'lead.contractual_qualified', 'attribution.first_contact_recorded',
    'payment.first_verified', 'commission.earned'
  )) <> 7 then raise exception 'COMMERCIAL_OUTBOX_EVENT_COUNT_INVALID'; end if;
  if (select commission_rate from public.commissions where idempotency_key = encode(digest('commission-current-ok', 'sha256'), 'hex')) <> 0.02
    or (select commission_mxn from public.commissions where idempotency_key = encode(digest('commission-current-ok', 'sha256'), 'hex')) <> 2000.00
  then raise exception 'COMMISSION_CALCULATION_INVALID'; end if;
end;
$$;

\echo 'COMMERCIAL_INTEGRITY_GATE_PASS'
