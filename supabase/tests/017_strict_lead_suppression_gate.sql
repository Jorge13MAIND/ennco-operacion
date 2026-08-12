\set ON_ERROR_STOP on

insert into public.organizations (id, slug, legal_name) values
  ('11111111-1111-4111-8111-111111111111', 'suppression-qualification-a', 'Suppression Qualification A'),
  ('22222222-2222-4222-8222-222222222222', 'suppression-qualification-b', 'Suppression Qualification B'),
  ('33333333-3333-4333-8333-333333333333', 'suppression-qualification-missing', 'Suppression Qualification Missing');
insert into public.organization_users (organization_id, user_id, role, active) values
  ('11111111-1111-4111-8111-111111111111', '81111111-1111-4111-8111-111111111111', 'teckel_admin', true),
  ('33333333-3333-4333-8333-333333333333', '81111111-1111-4111-8111-111111111111', 'teckel_admin', true),
  ('22222222-2222-4222-8222-222222222222', '82222222-2222-4222-8222-222222222222', 'teckel_admin', true);
insert into app.private_runtime_config (
  organization_id, prequote_ingest_secret, unsubscribe_ingest_secret, suppression_hmac_secret
) values
  ('11111111-1111-4111-8111-111111111111', repeat('1',64), repeat('2',64), repeat('a',64)),
  ('22222222-2222-4222-8222-222222222222', repeat('3',64), repeat('4',64), repeat('b',64)),
  ('33333333-3333-4333-8333-333333333333', repeat('5',64), repeat('6',64), null);

insert into public.accounts (id, organization_id, legal_name, normalized_name, primary_domain, evidence_class) values
  ('21111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Clean Account', 'clean account', 'clean.invalid', 'synthetic_demo'),
  ('21111111-1111-4111-8111-111111111112', '11111111-1111-4111-8111-111111111111', 'Annex Account', 'annex account', 'annex.invalid', 'synthetic_demo'),
  ('21111111-1111-4111-8111-111111111113', '11111111-1111-4111-8111-111111111111', 'Current Account', 'current account', 'current.invalid', 'synthetic_demo'),
  ('21111111-1111-4111-8111-111111111114', '11111111-1111-4111-8111-111111111111', 'Unsubscribe Account', 'unsubscribe account', 'unsubscribe.invalid', 'synthetic_demo'),
  ('21111111-1111-4111-8111-111111111115', '11111111-1111-4111-8111-111111111111', 'Bounce Account', 'bounce account', null, 'synthetic_demo'),
  ('21111111-1111-4111-8111-111111111199', '11111111-1111-4111-8111-111111111111', 'Race Account', 'race account', 'race.invalid', 'synthetic_demo'),
  ('22222222-2222-4222-8222-222222222221', '22222222-2222-4222-8222-222222222222', 'Cross Account', 'cross account', 'cross.invalid', 'synthetic_demo'),
  ('23333333-3333-4333-8333-333333333331', '33333333-3333-4333-8333-333333333333', 'Missing Secret Account', 'missing secret account', 'missing.invalid', 'synthetic_demo');

insert into public.contacts (id, organization_id, account_id, full_name, role_title, normalized_email) values
  ('31111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111111', 'Clean Synthetic', 'CEO', 'clean@clean.invalid'),
  ('31111111-1111-4111-8111-111111111112', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111112', 'Annex Synthetic', 'CEO', 'annex@annex.invalid'),
  ('31111111-1111-4111-8111-111111111113', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111113', 'Current Synthetic', 'CEO', 'current@current.invalid'),
  ('31111111-1111-4111-8111-111111111114', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111114', 'Unsubscribe Synthetic', 'CEO', 'unsubscribe@unsubscribe.invalid'),
  ('31111111-1111-4111-8111-111111111115', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111115', 'Bounce Synthetic', 'CEO', 'bounce@bounce.invalid'),
  ('31111111-1111-4111-8111-111111111199', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111199', 'Race Synthetic', 'CEO', 'race@race.invalid'),
  ('32222222-2222-4222-8222-222222222221', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222221', 'Cross Synthetic', 'CEO', 'cross@cross.invalid'),
  ('33333333-3333-4333-8333-333333333331', '33333333-3333-4333-8333-333333333333', '23333333-3333-4333-8333-333333333331', 'Missing Synthetic', 'CEO', 'missing@missing.invalid');

insert into public.leads (id, organization_id, account_id, contact_id, status, contractual_qualified, evidence_class) values
  ('61111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111111', 'CAPTURED', false, 'synthetic_demo'),
  ('61111111-1111-4111-8111-111111111112', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111112', '31111111-1111-4111-8111-111111111112', 'CAPTURED', false, 'synthetic_demo'),
  ('61111111-1111-4111-8111-111111111113', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111113', '31111111-1111-4111-8111-111111111113', 'CAPTURED', false, 'synthetic_demo'),
  ('61111111-1111-4111-8111-111111111114', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111114', '31111111-1111-4111-8111-111111111114', 'CAPTURED', false, 'synthetic_demo'),
  ('61111111-1111-4111-8111-111111111115', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111115', '31111111-1111-4111-8111-111111111115', 'CAPTURED', false, 'synthetic_demo'),
  ('61111111-1111-4111-8111-111111111199', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111199', '31111111-1111-4111-8111-111111111199', 'CAPTURED', false, 'synthetic_demo'),
  ('62222222-2222-4222-8222-222222222221', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222221', '32222222-2222-4222-8222-222222222221', 'CAPTURED', false, 'synthetic_demo'),
  ('63333333-3333-4333-8333-333333333331', '33333333-3333-4333-8333-333333333333', '23333333-3333-4333-8333-333333333331', '33333333-3333-4333-8333-333333333331', 'CAPTURED', false, 'synthetic_demo');

insert into public.suppression_entries (organization_id, kind, account_id, reason) values
  ('11111111-1111-4111-8111-111111111111', 'ANNEX_A', '21111111-1111-4111-8111-111111111112', 'SYNTHETIC_ANNEX'),
  ('11111111-1111-4111-8111-111111111111', 'CURRENT_CLIENT', '21111111-1111-4111-8111-111111111113', 'SYNTHETIC_CURRENT');
insert into public.suppression_entries (organization_id, kind, normalized_email, reason) values
  ('11111111-1111-4111-8111-111111111111', 'UNSUBSCRIBE', 'unsubscribe@unsubscribe.invalid', 'SYNTHETIC_UNSUBSCRIBE');
insert into public.suppression_entries (organization_id, kind, normalized_domain, reason) values
  ('11111111-1111-4111-8111-111111111111', 'HARD_BOUNCE', 'bounce.invalid', 'SYNTHETIC_BOUNCE_DOMAIN');

insert into public.source_evidence (
  id, organization_id, subject_type, subject_id, field_name, source_url, source_name,
  observed_at, confidence, value_json, checksum
) values
  ('71111111-1111-4111-8111-111111111101', '11111111-1111-4111-8111-111111111111', 'account', '21111111-1111-4111-8111-111111111111', 'industrial_over_100_kwp', 'https://evidence.invalid/clean-1', 'Synthetic', clock_timestamp(), 'VERIFIED', 'true', repeat('a',64)),
  ('71111111-1111-4111-8111-111111111102', '11111111-1111-4111-8111-111111111111', 'account', '21111111-1111-4111-8111-111111111111', 'outside_annex_a', 'https://evidence.invalid/clean-2', 'Synthetic', clock_timestamp(), 'VERIFIED', 'true', repeat('b',64)),
  ('71111111-1111-4111-8111-111111111103', '11111111-1111-4111-8111-111111111111', 'contact', '31111111-1111-4111-8111-111111111111', 'verified_target_role', 'https://evidence.invalid/clean-3', 'Synthetic', clock_timestamp(), 'VERIFIED', 'true', repeat('c',64)),
  ('71111111-1111-4111-8111-111111111104', '11111111-1111-4111-8111-111111111111', 'lead', '61111111-1111-4111-8111-111111111111', 'explicit_interest', 'https://evidence.invalid/clean-4', 'Synthetic', clock_timestamp(), 'VERIFIED', 'true', repeat('d',64)),
  ('71111111-1111-4111-8111-111111111191', '11111111-1111-4111-8111-111111111111', 'account', '21111111-1111-4111-8111-111111111199', 'industrial_over_100_kwp', 'https://evidence.invalid/race-1', 'Synthetic', clock_timestamp(), 'VERIFIED', 'true', repeat('1',64)),
  ('71111111-1111-4111-8111-111111111192', '11111111-1111-4111-8111-111111111111', 'account', '21111111-1111-4111-8111-111111111199', 'outside_annex_a', 'https://evidence.invalid/race-2', 'Synthetic', clock_timestamp(), 'VERIFIED', 'true', repeat('2',64)),
  ('71111111-1111-4111-8111-111111111193', '11111111-1111-4111-8111-111111111111', 'contact', '31111111-1111-4111-8111-111111111199', 'verified_target_role', 'https://evidence.invalid/race-3', 'Synthetic', clock_timestamp(), 'VERIFIED', 'true', repeat('3',64)),
  ('71111111-1111-4111-8111-111111111194', '11111111-1111-4111-8111-111111111111', 'lead', '61111111-1111-4111-8111-111111111199', 'explicit_interest', 'https://evidence.invalid/race-4', 'Synthetic', clock_timestamp(), 'VERIFIED', 'true', repeat('4',64));

set request.jwt.claim.sub = '81111111-1111-4111-8111-111111111111';
set request.jwt.claim.aal = 'aal2';
set role authenticated;

do $$
declare
  lead_audit_before bigint := (select count(*) from public.audit_log where record_type = 'leads');
  commercial_audit_before bigint := (select count(*) from public.audit_log where record_type in ('qualification_checks', 'qualification_evidence_links'));
  outbox_before bigint := (select count(*) from public.event_outbox);
  suppressed_lead uuid;
  test_evidence uuid[] := array[
    '79999999-9999-4999-8999-999999999991',
    '79999999-9999-4999-8999-999999999992',
    '79999999-9999-4999-8999-999999999993',
    '79999999-9999-4999-8999-999999999994'
  ]::uuid[];
begin
  foreach suppressed_lead in array array[
    '61111111-1111-4111-8111-111111111112',
    '61111111-1111-4111-8111-111111111113',
    '61111111-1111-4111-8111-111111111114',
    '61111111-1111-4111-8111-111111111115'
  ]::uuid[] loop
    begin
      perform app.qualify_lead_strict(
        '11111111-1111-4111-8111-111111111111', suppressed_lead,
        true, true, true, true, 0, test_evidence
      );
      raise exception 'EXPECTED_SUPPRESSED_LEAD_REJECTION';
    exception when others then
      if sqlerrm <> 'STRICT_LEAD_SUPPRESSED' then raise; end if;
    end;
  end loop;

  begin
    perform app.qualify_lead_strict(
      '33333333-3333-4333-8333-333333333333',
      '63333333-3333-4333-8333-333333333331',
      true, true, true, true, 0, test_evidence
    );
    raise exception 'EXPECTED_MISSING_SECRET_FAIL_CLOSED';
  exception when others then
    if sqlerrm <> 'STRICT_LEAD_SUPPRESSED' then raise; end if;
  end;

  begin
    perform app.qualify_lead_strict(
      '11111111-1111-4111-8111-111111111111',
      '62222222-2222-4222-8222-222222222221',
      true, true, true, true, 0, test_evidence
    );
    raise exception 'EXPECTED_CROSS_TENANT_LEAD_REJECTION';
  exception when others then
    if sqlerrm <> 'LEAD_NOT_FOUND_OR_TENANT_MISMATCH' then raise; end if;
  end;

  if exists (
    select 1 from public.leads
    where id in (
      '61111111-1111-4111-8111-111111111112',
      '61111111-1111-4111-8111-111111111113',
      '61111111-1111-4111-8111-111111111114',
      '61111111-1111-4111-8111-111111111115',
      '63333333-3333-4333-8333-333333333331'
    ) and (status <> 'CAPTURED' or contractual_qualified)
  ) then raise exception 'SUPPRESSED_QUALIFICATION_MUTATED_LEAD'; end if;
  if exists (select 1 from public.qualification_checks) then
    raise exception 'SUPPRESSED_QUALIFICATION_CREATED_CHECK';
  end if;
  if (select count(*) from public.event_outbox) <> outbox_before then
    raise exception 'SUPPRESSED_QUALIFICATION_CREATED_OUTBOX';
  end if;
  if (select count(*) from public.audit_log where record_type = 'leads') <> lead_audit_before
    or (select count(*) from public.audit_log where record_type in ('qualification_checks', 'qualification_evidence_links')) <> commercial_audit_before
  then raise exception 'SUPPRESSED_QUALIFICATION_CREATED_AUDIT'; end if;
end;
$$;

select app.qualify_lead_strict(
  '11111111-1111-4111-8111-111111111111', '61111111-1111-4111-8111-111111111111',
  true, true, true, true, 0,
  array[
    '71111111-1111-4111-8111-111111111101',
    '71111111-1111-4111-8111-111111111102',
    '71111111-1111-4111-8111-111111111103',
    '71111111-1111-4111-8111-111111111104'
  ]::uuid[]
);
select app.qualify_lead_strict(
  '11111111-1111-4111-8111-111111111111', '61111111-1111-4111-8111-111111111111',
  true, true, true, true, 0,
  array[
    '71111111-1111-4111-8111-111111111101',
    '71111111-1111-4111-8111-111111111102',
    '71111111-1111-4111-8111-111111111103',
    '71111111-1111-4111-8111-111111111104'
  ]::uuid[]
);

do $$
begin
  if (select count(*) from public.qualification_checks where lead_id = '61111111-1111-4111-8111-111111111111') <> 1
    or (select count(*) from public.event_outbox where event_type = 'lead.contractual_qualified') <> 1
  then raise exception 'QUALIFICATION_IDEMPOTENCY_NOT_PRESERVED'; end if;
  if has_function_privilege(
    'authenticated',
    'app.qualify_lead_strict_without_suppression(uuid,uuid,boolean,boolean,boolean,boolean,numeric,uuid[])',
    'EXECUTE'
  ) then raise exception 'SUPPRESSION_BYPASS_FUNCTION_EXPOSED'; end if;
  if position(
    'app.is_suppressed'
    in pg_get_functiondef('app.qualify_lead_strict(uuid,uuid,boolean,boolean,boolean,boolean,numeric,uuid[])'::regprocedure)
  ) = 0 then raise exception 'QUALIFICATION_FUNCTION_MISSING_SUPPRESSION_CALL'; end if;
  if position(
    'app.lock_suppression_subjects'
    in pg_get_functiondef('app.lock_suppression_entry_mutation()'::regprocedure)
  ) = 0 then raise exception 'SUPPRESSION_MUTATION_MISSING_SHARED_MUTEX'; end if;
end;
$$;

reset role;
reset request.jwt.claim.aal;
reset request.jwt.claim.sub;

\echo 'STRICT_LEAD_SUPPRESSION_GATE_PASS'
