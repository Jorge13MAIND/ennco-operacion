\set ON_ERROR_STOP on

insert into public.organizations (id, slug, legal_name)
values ('11111111-1111-4111-8111-111111111111', 'ennco', 'ENNCO');

insert into app.private_runtime_config (organization_id, prequote_ingest_secret)
values (
  '11111111-1111-4111-8111-111111111111',
  'synthetic-analytics-ingest-secret-at-least-32'
);

create or replace function pg_temp.analytics_payload(
  target_event_name text,
  target_session_id uuid,
  target_properties jsonb default '{}'::jsonb
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'eventName', target_event_name,
    'sessionId', target_session_id,
    'correlationId', null,
    'path', '/diagnostico',
    'properties', target_properties,
    'occurredAt', clock_timestamp(),
    'evidenceClass', 'live'
  );
$$;

create or replace function pg_temp.invoke_analytics(
  target_idempotency_key text,
  target_nonce uuid,
  target_payload jsonb,
  target_rate_identity text,
  corrupt_signature boolean default false
)
returns jsonb
language plpgsql
as $$
declare
  organization_id_value uuid := '11111111-1111-4111-8111-111111111111';
  synthetic_secret text := 'synthetic-analytics-ingest-secret-at-least-32';
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
  expiry_epoch := floor(extract(epoch from clock_timestamp()))::bigint + 300;
  signed_value := concat_ws(E'\n',
    organization_id_value::text,
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
  return public.capture_public_analytics_event(
    organization_id_value,
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
  valid_payload jsonb;
begin
  valid_payload := pg_temp.analytics_payload(
    'PREQUOTE_SUCCEEDED',
    '21111111-1111-4111-8111-111111111111',
    '{"estimate_kind":"SOLAR_RANGE","verdict":"INDUSTRIAL_REVIEW"}'
  );
  created_result := pg_temp.invoke_analytics(
    'm3-analytics-valid-0001',
    '31111111-1111-4111-8111-111111111111',
    valid_payload,
    '198.51.100.20'
  );
  if created_result ->> 'status' <> 'CREATED' then raise exception 'EXPECTED_ANALYTICS_CREATED'; end if;

  duplicate_result := pg_temp.invoke_analytics(
    'm3-analytics-valid-0001',
    '32111111-1111-4111-8111-111111111111',
    valid_payload,
    '198.51.100.20'
  );
  if duplicate_result ->> 'status' <> 'DUPLICATE'
    or duplicate_result ->> 'event_id' <> created_result ->> 'event_id'
  then
    raise exception 'ANALYTICS_IDEMPOTENCY_FAILED';
  end if;

  begin
    perform pg_temp.invoke_analytics(
      'm3-analytics-replay-001',
      '31111111-1111-4111-8111-111111111111',
      pg_temp.analytics_payload('DIAGNOSTIC_VIEWED', '22111111-1111-4111-8111-111111111111'),
      '198.51.100.21'
    );
    raise exception 'EXPECTED_ANALYTICS_REPLAY_REJECTION';
  exception when others then
    if sqlerrm <> 'ANALYTICS_REPLAY_REJECTED' then raise; end if;
  end;

  begin
    perform pg_temp.invoke_analytics(
      'm3-analytics-signature-001',
      '33111111-1111-4111-8111-111111111111',
      pg_temp.analytics_payload('DIAGNOSTIC_VIEWED', '23111111-1111-4111-8111-111111111111'),
      '198.51.100.22',
      true
    );
    raise exception 'EXPECTED_ANALYTICS_SIGNATURE_REJECTION';
  exception when others then
    if sqlerrm <> 'ANALYTICS_SIGNATURE_INVALID' then raise; end if;
  end;

  begin
    perform pg_temp.invoke_analytics(
      'm3-analytics-property-0001',
      '34111111-1111-4111-8111-111111111111',
      pg_temp.analytics_payload(
        'PREQUOTE_FAILED',
        '24111111-1111-4111-8111-111111111111',
        '{"email":"pii_sentinel@invalid.test"}'
      ),
      '198.51.100.23'
    );
    raise exception 'EXPECTED_ANALYTICS_PROPERTY_REJECTION';
  exception when others then
    if sqlerrm <> 'ANALYTICS_PROPERTIES_REJECTED' then raise; end if;
  end;

  begin
    perform pg_temp.invoke_analytics(
      'm3-analytics-pii-value-001',
      '35111111-1111-4111-8111-111111111111',
      pg_temp.analytics_payload(
        'PREQUOTE_FAILED',
        '25111111-1111-4111-8111-111111111111',
        '{"error_code":"pii_sentinel@invalid.test"}'
      ),
      '198.51.100.24'
    );
    raise exception 'EXPECTED_ANALYTICS_PII_VALUE_REJECTION';
  exception when others then
    if sqlerrm <> 'ANALYTICS_PROPERTIES_REJECTED' then raise; end if;
  end;
end;
$$;

do $$
declare
  current_index integer;
begin
  for current_index in 1..120 loop
    perform pg_temp.invoke_analytics(
      'm3-analytics-rate-' || lpad(current_index::text, 10, '0'),
      ('36111111-1111-4111-8111-' || lpad(current_index::text, 12, '0'))::uuid,
      pg_temp.analytics_payload(
        'DIAGNOSTIC_VIEWED',
        ('26111111-1111-4111-8111-' || lpad(current_index::text, 12, '0'))::uuid
      ),
      '203.0.113.120'
    );
  end loop;

  begin
    perform pg_temp.invoke_analytics(
      'm3-analytics-rate-0000000121',
      '37111111-1111-4111-8111-000000000121',
      pg_temp.analytics_payload('DIAGNOSTIC_VIEWED', '27111111-1111-4111-8111-000000000121'),
      '203.0.113.120'
    );
    raise exception 'EXPECTED_ANALYTICS_RATE_LIMIT_REJECTION';
  exception when others then
    if sqlerrm <> 'ANALYTICS_RATE_LIMIT_EXCEEDED' then raise; end if;
  end;
end;
$$;

do $$
declare
  event_count integer;
  technical_text text;
begin
  select count(*) into event_count from public.analytics_events;
  if event_count <> 121 then raise exception 'UNEXPECTED_ANALYTICS_COUNT:%', event_count; end if;

  select coalesce(string_agg(properties::text, E'\n'), '') into technical_text
  from public.analytics_events;
  if technical_text like '%pii_sentinel%' or technical_text like '%@%' then
    raise exception 'ANALYTICS_PII_LEAK';
  end if;

  if has_table_privilege('anon', 'public.analytics_events', 'SELECT')
    or has_table_privilege('anon', 'public.analytics_rate_windows', 'SELECT')
  then
    raise exception 'ANON_ANALYTICS_TABLE_PRIVILEGE_TOO_BROAD';
  end if;
  if not has_function_privilege(
    'anon',
    'public.capture_public_analytics_event(uuid,text,uuid,bigint,text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'ANON_ANALYTICS_RPC_EXECUTE_MISSING';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.capture_public_analytics_event(uuid,text,uuid,bigint,text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'AUTHENTICATED_ANALYTICS_RPC_EXECUTE_UNEXPECTED';
  end if;
end;
$$;

select 'CONVERSION_ANALYTICS_GATE_PASS' as result;
