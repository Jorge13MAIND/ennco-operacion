\set ON_ERROR_STOP on

insert into public.organizations (id, slug, legal_name) values
  ('c1000000-0000-4000-8000-000000000001', 'unsubscribe-org', 'Unsubscribe Synthetic Org'),
  ('c1000000-0000-4000-8000-000000000002', 'unsubscribe-other', 'Unsubscribe Other Org');

insert into public.runtime_controls (organization_id) values
  ('c1000000-0000-4000-8000-000000000001'),
  ('c1000000-0000-4000-8000-000000000002');

insert into app.private_runtime_config (
  organization_id, prequote_ingest_secret, gmail_ingest_secret, unsubscribe_ingest_secret
) values
  ('c1000000-0000-4000-8000-000000000001', repeat('p', 40), repeat('g', 40), 'unsubscribe-ingest-secret-for-db-tests'),
  ('c1000000-0000-4000-8000-000000000002', repeat('p', 40), repeat('g', 40), 'unsubscribe-other-secret-for-db-tests');

insert into public.accounts (
  id, organization_id, legal_name, normalized_name, primary_domain, evidence_class, source_confidence
) values
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Synthetic Account', 'synthetic account', 'synthetic.invalid', 'synthetic_demo', 'VERIFIED');

insert into public.contacts (
  id, organization_id, account_id, full_name, role_title, normalized_email, verified, verified_at, source_confidence
) values (
  'c3000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001', 'Persona Sintetica', 'CEO',
  'unsubscribe@synthetic.invalid', true, now(), 'VERIFIED'
);

insert into public.campaigns (
  id, organization_id, name, manifest_json, manifest_sha256
) values (
  'c4000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
  'Synthetic unsubscribe campaign', '{"evidence_class":"synthetic_demo"}', repeat('a', 64)
);
insert into public.sequence_versions (
  id, organization_id, campaign_id, version, sender_name, sender_title, content_sha256
) values (
  'c5000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
  'c4000000-0000-4000-8000-000000000001', 1, 'Francisco', 'CEO', repeat('b', 64)
);
insert into public.mailboxes (
  id, organization_id, normalized_email, domain, sender_name
) values (
  'c6000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
  'francisco@synthetic.invalid', 'synthetic.invalid', 'Francisco'
);
insert into public.campaign_enrollments (
  id, organization_id, campaign_id, sequence_version_id, account_id, contact_id, mailbox_id, status
) values (
  'c7000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
  'c4000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001',
  'c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001',
  'c6000000-0000-4000-8000-000000000001', 'ACTIVE'
);

create or replace function pg_temp.invoke_unsubscribe(
  target_idempotency_key text,
  target_token_nonce uuid,
  target_request_nonce uuid,
  corrupt_signature boolean default false
)
returns jsonb
language plpgsql
as $$
declare
  organization_id_value uuid := 'c1000000-0000-4000-8000-000000000001';
  enrollment_id_value uuid := 'c7000000-0000-4000-8000-000000000001';
  secret_value text := 'unsubscribe-ingest-secret-for-db-tests';
  payload_hash text;
  expiry_epoch bigint;
  canonical_value text;
  signature_value text;
begin
  payload_hash := encode(digest(
    organization_id_value::text || ':' || enrollment_id_value::text || ':' || target_token_nonce::text,
    'sha256'
  ), 'hex');
  expiry_epoch := floor(extract(epoch from clock_timestamp()))::bigint + 300;
  canonical_value := concat_ws(':',
    organization_id_value::text, enrollment_id_value::text, target_token_nonce::text,
    target_idempotency_key, target_request_nonce::text, expiry_epoch::text, payload_hash
  );
  signature_value := encode(
    hmac(convert_to(canonical_value, 'UTF8'), convert_to(secret_value, 'UTF8'), 'sha256'), 'hex'
  );
  if corrupt_signature then signature_value := repeat('0', 64); end if;
  return public.apply_one_click_unsubscribe(
    organization_id_value, enrollment_id_value, target_token_nonce, target_idempotency_key,
    target_request_nonce, expiry_epoch, payload_hash, signature_value
  );
end;
$$;

set role anon;
create temporary table unsubscribe_results (label text primary key, result jsonb);
insert into unsubscribe_results values (
  'created', pg_temp.invoke_unsubscribe(
    'unsubscribe:' || repeat('1', 64),
    'c8000000-0000-4000-8000-000000000001',
    'c9000000-0000-4000-8000-000000000001'
  )
);
insert into unsubscribe_results values (
  'duplicate', pg_temp.invoke_unsubscribe(
    'unsubscribe:' || repeat('1', 64),
    'c8000000-0000-4000-8000-000000000001',
    'c9000000-0000-4000-8000-000000000002'
  )
);
reset role;

do $$
begin
  if (select result ->> 'status' from unsubscribe_results where label = 'created') <> 'CREATED' then
    raise exception 'UNSUBSCRIBE_NOT_CREATED';
  end if;
  if (select result ->> 'status' from unsubscribe_results where label = 'duplicate') <> 'DUPLICATE' then
    raise exception 'UNSUBSCRIBE_NOT_IDEMPOTENT';
  end if;
  if (select count(*) from public.unsubscribe_requests) <> 1 then raise exception 'UNSUBSCRIBE_REQUEST_COUNT_INVALID'; end if;
  if (select status from public.campaign_enrollments where id = 'c7000000-0000-4000-8000-000000000001') <> 'UNSUBSCRIBED' then
    raise exception 'UNSUBSCRIBE_ENROLLMENT_NOT_STOPPED';
  end if;
  if (select count(*) from public.suppression_entries where kind = 'UNSUBSCRIBE' and normalized_email = 'unsubscribe@synthetic.invalid') <> 1 then
    raise exception 'UNSUBSCRIBE_SUPPRESSION_MISSING';
  end if;
  if (select count(*) from public.event_outbox where event_type = 'contact.unsubscribed') <> 1 then
    raise exception 'UNSUBSCRIBE_OUTBOX_INVALID';
  end if;
  if (select count(*) from public.audit_log where record_type = 'unsubscribe_requests' and action = 'ONE_CLICK_APPLIED') <> 1 then
    raise exception 'UNSUBSCRIBE_AUDIT_MISSING';
  end if;
  if exists (
    select 1 from public.audit_log
    where coalesce(old_data::text, '') || coalesce(new_data::text, '') like '%unsubscribe@synthetic.invalid%'
  ) then raise exception 'UNSUBSCRIBE_EMAIL_LEAKED_TO_AUDIT'; end if;
end;
$$;

set role anon;
do $$
begin
  begin
    perform pg_temp.invoke_unsubscribe(
      'unsubscribe:' || repeat('2', 64),
      'c8000000-0000-4000-8000-000000000002',
      'c9000000-0000-4000-8000-000000000003',
      true
    );
    raise exception 'FORGED_UNSUBSCRIBE_ACCEPTED';
  exception when others then
    if sqlerrm = 'FORGED_UNSUBSCRIBE_ACCEPTED' then raise; end if;
    if position('UNSUBSCRIBE_SIGNATURE_INVALID' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform pg_temp.invoke_unsubscribe(
      'unsubscribe:' || repeat('1', 64),
      'c8000000-0000-4000-8000-000000000001',
      'c9000000-0000-4000-8000-000000000001'
    );
    raise exception 'UNSUBSCRIBE_REPLAY_ACCEPTED';
  exception when others then
    if sqlerrm = 'UNSUBSCRIBE_REPLAY_ACCEPTED' then raise; end if;
    if position('UNSUBSCRIBE_REPLAY_REJECTED' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    insert into public.unsubscribe_requests (
      organization_id, enrollment_id, token_nonce, idempotency_key, payload_sha256
    ) values (
      'c1000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001',
      gen_random_uuid(), 'unsubscribe:' || repeat('9', 64), repeat('9', 64)
    );
    raise exception 'ANON_UNSUBSCRIBE_DML_ACCEPTED';
  exception when others then
    if sqlerrm = 'ANON_UNSUBSCRIBE_DML_ACCEPTED' then raise; end if;
  end;
end;
$$;
reset role;

select 'ONE_CLICK_UNSUBSCRIBE_GATE_PASS' as result;
