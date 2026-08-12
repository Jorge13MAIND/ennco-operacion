\set ON_ERROR_STOP on

insert into public.organizations (id, slug, legal_name) values
  ('11111111-1111-4111-8111-111111111111', 'ennco', 'ENNCO'),
  ('12121212-1212-4212-8212-121212121212', 'other-org', 'Other Org');

insert into public.prequote_models (
  id, organization_id, version, status, assumptions, source_manifest,
  valid_from, valid_until, approved_by, approved_at
) values
  (
    '21111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111',
    'APPROVED-SYNTHETIC-01',
    'APPROVED',
    '{"synthetic":true}',
    '{"synthetic":true}',
    now() - interval '1 day',
    now() + interval '30 days',
    '31111111-1111-4111-8111-111111111111',
    now()
  ),
  (
    '22111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111',
    'DRAFT-SYNTHETIC-01',
    'DRAFT_REVIEW_REQUIRED',
    '{"synthetic":true}',
    '{"synthetic":true}',
    null,
    now() + interval '30 days',
    null,
    null
  ),
  (
    '23121212-1212-4212-8212-121212121212',
    '12121212-1212-4212-8212-121212121212',
    'FOREIGN-SYNTHETIC-01',
    'APPROVED',
    '{"synthetic":true}',
    '{"synthetic":true}',
    now() - interval '1 day',
    now() + interval '30 days',
    '32121212-1212-4212-8212-121212121212',
    now()
  );

insert into app.private_runtime_config (organization_id, prequote_ingest_secret)
values (
  '11111111-1111-4111-8111-111111111111',
  'synthetic-prequote-ingest-secret-at-least-32'
);

create or replace function pg_temp.synthetic_prequote_payload(
  target_model_version text,
  target_correlation_id uuid,
  target_email text default 'M3_PII_SENTINEL@invalid.test',
  target_company text default 'M3 PII SENTINEL COMPANY'
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'correlationId', target_correlation_id,
    'input', jsonb_build_object(
      'needType', 'SOLAR_NEW',
      'monthlySpendMxn', 150000,
      'tariff', 'GDMTH',
      'existingCapacityKwp', 0,
      'coverageTargetPct', 75,
      'city', 'Leon',
      'state', 'Guanajuato',
      'zone', 'URBAN',
      'contact', jsonb_build_object(
        'company', target_company,
        'fullName', 'M3 PII SENTINEL NAME',
        'role', 'Direccion de planta',
        'email', target_email,
        'phone', '4770000000'
      ),
      'consent', true,
      'privacyNoticeVersion', 'DRAFT-2026-08-11',
      'attribution', jsonb_build_object('source', 'synthetic-gate')
    ),
    'estimate', jsonb_build_object(
      'estimateKind', 'SOLAR_RANGE',
      'capacityKwp', jsonb_build_object('min', 210, 'max', 350),
      'investmentMxn', jsonb_build_object('min', 2940000, 'max', 9450000),
      'roofAreaM2', jsonb_build_object('min', 1092, 'max', 2555),
      'estimatedMonthlyKwh', jsonb_build_object('min', 44776, 'max', 53571),
      'panelCount', jsonb_build_object('min', 324, 'max', 565),
      'verdict', 'INDUSTRIAL_REVIEW',
      'evidenceConfidence', 'EXTRAPOLATED_REVIEW_REQUIRED',
      'strictLeadStatus', 'DOES_NOT_COUNT_WITHOUT_HUMAN_EVIDENCE',
      'modelVersion', target_model_version,
      'modelStatus', 'APPROVED',
      'modelValidUntil', '2026-09-10T23:59:59-06:00',
      'calculatedAt', '2026-08-11T18:00:00.000Z',
      'assumptions', jsonb_build_array(),
      'limitations', jsonb_build_array('Synthetic only'),
      'disclaimer', 'Synthetic non-contractual test'
    )
  );
$$;

create or replace function pg_temp.invoke_prequote(
  target_idempotency_key text,
  target_nonce uuid,
  target_payload jsonb,
  target_rate_identity text,
  expiry_offset_seconds integer default 300,
  corrupt_signature boolean default false,
  target_organization_id uuid default '11111111-1111-4111-8111-111111111111'
)
returns jsonb
language plpgsql
as $$
declare
  synthetic_secret text := 'synthetic-prequote-ingest-secret-at-least-32';
  payload_text text := target_payload::text;
  payload_hash text;
  rate_hash text;
  expiry_epoch bigint;
  signed_value text;
  signature_value text;
begin
  payload_hash := encode(digest(payload_text, 'sha256'), 'hex');
  rate_hash := encode(
    hmac(convert_to('rate-limit' || E'\n' || target_rate_identity, 'UTF8'), convert_to(synthetic_secret, 'UTF8'), 'sha256'),
    'hex'
  );
  expiry_epoch := floor(extract(epoch from clock_timestamp()))::bigint + expiry_offset_seconds;
  signed_value := concat_ws(E'\n',
    target_organization_id::text,
    target_idempotency_key,
    target_nonce::text,
    expiry_epoch::text,
    payload_hash,
    rate_hash
  );
  signature_value := encode(
    hmac(convert_to(signed_value, 'UTF8'), convert_to(synthetic_secret, 'UTF8'), 'sha256'),
    'hex'
  );
  if corrupt_signature then signature_value := repeat('0', 64); end if;
  return public.create_public_prequote(
    target_organization_id,
    target_idempotency_key,
    target_nonce,
    expiry_epoch,
    payload_hash,
    signature_value,
    rate_hash,
    payload_text
  );
end;
$$;

do $$
declare
  created_result jsonb;
  duplicate_result jsonb;
  created_payload jsonb;
begin
  created_payload := pg_temp.synthetic_prequote_payload(
    'APPROVED-SYNTHETIC-01',
    '41111111-1111-4111-8111-111111111111'
  );
  created_result := pg_temp.invoke_prequote(
    'm3-valid-idempotency-0001',
    '51111111-1111-4111-8111-111111111111',
    created_payload,
    '198.51.100.10'
  );
  if created_result ->> 'status' <> 'CREATED' then raise exception 'EXPECTED_CREATED_RESULT'; end if;

  duplicate_result := pg_temp.invoke_prequote(
    'm3-valid-idempotency-0001',
    '52111111-1111-4111-8111-111111111111',
    created_payload,
    '198.51.100.10'
  );
  if duplicate_result ->> 'status' <> 'DUPLICATE'
    or duplicate_result ->> 'record_id' <> created_result ->> 'record_id'
    or duplicate_result ->> 'folio' <> created_result ->> 'folio'
  then
    raise exception 'IDEMPOTENCY_RESULT_MISMATCH';
  end if;

  begin
    perform pg_temp.invoke_prequote(
      'm3-replay-idempotency-01',
      '51111111-1111-4111-8111-111111111111',
      pg_temp.synthetic_prequote_payload('APPROVED-SYNTHETIC-01', '42111111-1111-4111-8111-111111111111'),
      '198.51.100.11'
    );
    raise exception 'EXPECTED_REPLAY_REJECTION';
  exception when others then
    if sqlerrm <> 'PUBLIC_PREQUOTE_REPLAY_REJECTED' then raise; end if;
  end;

  begin
    perform pg_temp.invoke_prequote(
      'm3-invalid-signature-001',
      '53111111-1111-4111-8111-111111111111',
      pg_temp.synthetic_prequote_payload('APPROVED-SYNTHETIC-01', '43111111-1111-4111-8111-111111111111'),
      '198.51.100.12',
      300,
      true
    );
    raise exception 'EXPECTED_SIGNATURE_REJECTION';
  exception when others then
    if sqlerrm <> 'PUBLIC_PREQUOTE_SIGNATURE_INVALID' then raise; end if;
  end;

  begin
    perform pg_temp.invoke_prequote(
      'm3-expired-proof-000001',
      '54111111-1111-4111-8111-111111111111',
      pg_temp.synthetic_prequote_payload('APPROVED-SYNTHETIC-01', '44111111-1111-4111-8111-111111111111'),
      '198.51.100.13',
      -60
    );
    raise exception 'EXPECTED_EXPIRED_REJECTION';
  exception when others then
    if sqlerrm <> 'PUBLIC_PREQUOTE_PROOF_EXPIRED' then raise; end if;
  end;

  begin
    perform pg_temp.invoke_prequote(
      'm3-draft-model-00000001',
      '55111111-1111-4111-8111-111111111111',
      pg_temp.synthetic_prequote_payload('DRAFT-SYNTHETIC-01', '45111111-1111-4111-8111-111111111111'),
      '198.51.100.14'
    );
    raise exception 'EXPECTED_DRAFT_MODEL_REJECTION';
  exception when others then
    if sqlerrm <> 'PUBLIC_PREQUOTE_MODEL_NOT_APPROVED' then raise; end if;
  end;
end;
$$;

do $$
declare
  current_index integer;
  nonce_value uuid;
begin
  for current_index in 1..5 loop
    nonce_value := ('56111111-1111-4111-8111-' || lpad(current_index::text, 12, '0'))::uuid;
    perform pg_temp.invoke_prequote(
      'm3-rate-window-' || lpad(current_index::text, 10, '0'),
      nonce_value,
      pg_temp.synthetic_prequote_payload(
        'APPROVED-SYNTHETIC-01',
        ('46111111-1111-4111-8111-' || lpad(current_index::text, 12, '0'))::uuid,
        'm3_rate_' || current_index::text || '@invalid.test',
        'Synthetic Rate ' || current_index::text
      ),
      '203.0.113.90'
    );
  end loop;

  begin
    perform pg_temp.invoke_prequote(
      'm3-rate-window-0000000006',
      '57111111-1111-4111-8111-000000000006',
      pg_temp.synthetic_prequote_payload(
        'APPROVED-SYNTHETIC-01',
        '47111111-1111-4111-8111-000000000006',
        'm3_rate_6@invalid.test',
        'Synthetic Rate 6'
      ),
      '203.0.113.90'
    );
    raise exception 'EXPECTED_RATE_LIMIT_REJECTION';
  exception when others then
    if sqlerrm <> 'PUBLIC_PREQUOTE_RATE_LIMIT_EXCEEDED' then raise; end if;
  end;
end;
$$;

do $$
begin
  begin
    insert into public.prequotes (
      organization_id, model_id, folio, need_type, account_name, contact_name, contact_role,
      normalized_email, monthly_spend_mxn, tariff, coverage_target_pct, city, state, zone,
      result_json, consented_at, evidence_class, correlation_id, idempotency_key, privacy_notice_version
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '23121212-1212-4212-8212-121212121212',
      'ENN-PRE-FOREIGN01', 'SOLAR_NEW', 'Foreign', 'Foreign', 'CEO',
      'foreign@invalid.test', 100000, 'GDMTH', 75, 'Leon', 'Guanajuato', 'URBAN',
      '{}', now(), 'synthetic_demo', '48111111-1111-4111-8111-111111111111',
      'm3-cross-tenant-000001', 'DRAFT-2026-08-11'
    );
    raise exception 'EXPECTED_TENANT_FK_REJECTION';
  exception when foreign_key_violation then null;
  end;
end;
$$;

do $$
declare
  created_count integer;
  outbox_count integer;
  rate_count integer;
  audit_text text;
  outbox_text text;
begin
  select count(*) into created_count
  from public.prequotes
  where organization_id = '11111111-1111-4111-8111-111111111111';
  if created_count <> 6 then raise exception 'UNEXPECTED_CREATED_COUNT:%', created_count; end if;

  select count(*) into outbox_count
  from public.event_outbox
  where event_type = 'prequote.captured';
  if outbox_count <> 6 then raise exception 'UNEXPECTED_OUTBOX_COUNT:%', outbox_count; end if;

  select request_count into rate_count
  from public.public_prequote_rate_windows
  where organization_id = '11111111-1111-4111-8111-111111111111'
    and rate_limit_key_sha256 = encode(
      hmac(
        convert_to('rate-limit' || E'\n' || '198.51.100.10', 'UTF8'),
        convert_to('synthetic-prequote-ingest-secret-at-least-32', 'UTF8'),
        'sha256'
      ),
      'hex'
    );
  if rate_count <> 1 then raise exception 'DUPLICATE_CONSUMED_RATE_LIMIT'; end if;

  select coalesce(string_agg(coalesce(old_data::text, '') || coalesce(new_data::text, ''), E'\n'), '')
  into audit_text
  from public.audit_log;
  select coalesce(string_agg(payload_json::text, E'\n'), '') into outbox_text
  from public.event_outbox;

  if audit_text like '%M3 PII SENTINEL%'
    or audit_text like '%m3_pii_sentinel%'
    or outbox_text like '%M3 PII SENTINEL%'
    or outbox_text like '%m3_pii_sentinel%'
  then
    raise exception 'PII_LEAKED_TO_TECHNICAL_EVIDENCE';
  end if;

  if not exists (
    select 1 from public.prequotes
    where normalized_email = 'm3_pii_sentinel@invalid.test'
      and phone_e164 = '+524770000000'
      and privacy_notice_version = 'DRAFT-2026-08-11'
  ) then
    raise exception 'EXPECTED_NORMALIZED_CONTACT_NOT_FOUND';
  end if;

  if has_table_privilege('anon', 'public.prequotes', 'SELECT')
    or has_table_privilege('anon', 'public.public_prequote_nonces', 'SELECT')
    or has_table_privilege('anon', 'public.public_prequote_rate_windows', 'SELECT')
    or has_table_privilege('anon', 'app.private_runtime_config', 'SELECT')
  then
    raise exception 'ANON_TABLE_PRIVILEGE_TOO_BROAD';
  end if;
  if not has_function_privilege(
    'anon',
    'public.create_public_prequote(uuid,text,uuid,bigint,text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'ANON_RPC_EXECUTE_MISSING';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.create_public_prequote(uuid,text,uuid,bigint,text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'AUTHENTICATED_RPC_EXECUTE_UNEXPECTED';
  end if;
end;
$$;

set role anon;
do $$
begin
  begin
    perform * from public.prequotes limit 1;
    raise exception 'EXPECTED_ANON_READ_REJECTION';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

select 'PUBLIC_PREQUOTE_CAPTURE_GATE_PASS' as result;
