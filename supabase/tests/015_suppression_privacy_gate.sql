\set ON_ERROR_STOP on

insert into public.organizations (id, slug, legal_name) values
  ('11111111-1111-4111-8111-111111111111', 'suppression-org-a', 'Suppression Org A'),
  ('22222222-2222-4222-8222-222222222222', 'suppression-org-b', 'Suppression Org B'),
  ('33333333-3333-4333-8333-333333333333', 'suppression-org-missing', 'Suppression Missing Secret');

insert into app.private_runtime_config (
  organization_id, prequote_ingest_secret, unsubscribe_ingest_secret, suppression_hmac_secret
) values
  ('11111111-1111-4111-8111-111111111111', repeat('a', 64), repeat('1', 64), repeat('c', 64)),
  ('22222222-2222-4222-8222-222222222222', repeat('b', 64), repeat('2', 64), repeat('d', 64)),
  ('33333333-3333-4333-8333-333333333333', repeat('3', 64), repeat('4', 64), null);

insert into public.accounts (id, organization_id, legal_name, normalized_name, primary_domain, evidence_class) values
  ('21111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Account A', 'account a', 'plant-a.invalid', 'synthetic_demo'),
  ('22222222-2222-4222-8222-222222222221', '22222222-2222-4222-8222-222222222222', 'Account B', 'account b', 'plant-b.invalid', 'synthetic_demo'),
  ('23333333-3333-4333-8333-333333333331', '33333333-3333-4333-8333-333333333333', 'Missing Secret Account', 'missing secret account', 'missing.invalid', 'synthetic_demo');

insert into public.contacts (id, organization_id, account_id, full_name, role_title, normalized_email) values
  ('31111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111111', 'Synthetic Contact', 'CEO', 'one-click@invalid.test'),
  ('32222222-2222-4222-8222-222222222221', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222221', 'Synthetic Tenant B', 'CEO', 'one-click@invalid.test'),
  ('33333333-3333-4333-8333-333333333331', '33333333-3333-4333-8333-333333333333', '23333333-3333-4333-8333-333333333331', 'Missing Secret Contact', 'CEO', 'missing@invalid.test');

do $$
begin
  if not app.is_suppressed(
    '33333333-3333-4333-8333-333333333333',
    '23333333-3333-4333-8333-333333333331',
    'missing@invalid.test', 'missing.invalid'
  ) then raise exception 'MISSING_SECRET_DID_NOT_FAIL_CLOSED'; end if;

  begin
    insert into public.suppression_entries (
      organization_id, kind, normalized_email, reason
    ) values (
      '33333333-3333-4333-8333-333333333333', 'DNC', 'missing@invalid.test', 'MISSING_SECRET_TEST'
    );
    raise exception 'EXPECTED_MISSING_SECRET_INSERT_REJECTION';
  exception when others then
    if sqlerrm <> 'SUPPRESSION_HMAC_SECRET_MISSING' then raise; end if;
  end;
end;
$$;

insert into public.suppression_entries (
  organization_id, kind, account_id, normalized_email, normalized_domain, reason
) values (
  '11111111-1111-4111-8111-111111111111', 'DNC',
  '21111111-1111-4111-8111-111111111111', 'one-click@invalid.test', 'plant-a.invalid',
  'SYNTHETIC_MULTI_KEY_DNC'
);

do $$
begin
  if exists (
    select 1 from public.suppression_entries
    where organization_id = '11111111-1111-4111-8111-111111111111'
      and (account_id is not null or normalized_email is not null or normalized_domain is not null)
  ) then raise exception 'RAW_SUPPRESSION_IDENTITY_PERSISTED'; end if;
  if (
    select num_nonnulls(account_hmac, email_hmac, domain_hmac)
    from public.suppression_entries
    where reason = 'SYNTHETIC_MULTI_KEY_DNC'
  ) <> 3 then raise exception 'SUPPRESSION_HMAC_KEYS_MISSING'; end if;
  if not app.is_suppressed(
    '11111111-1111-4111-8111-111111111111',
    '21111111-1111-4111-8111-111111111111', null, null
  ) then raise exception 'ACCOUNT_HMAC_MATCH_FAILED'; end if;
  if not app.is_suppressed(
    '11111111-1111-4111-8111-111111111111',
    null, 'one-click@invalid.test', null
  ) then raise exception 'EMAIL_HMAC_MATCH_FAILED'; end if;
  if not app.is_suppressed(
    '11111111-1111-4111-8111-111111111111',
    null, null, 'plant-a.invalid'
  ) then raise exception 'DOMAIN_HMAC_MATCH_FAILED'; end if;
  if not app.is_suppressed(
    '11111111-1111-4111-8111-111111111111',
    null, 'somebody@plant-a.invalid', null
  ) then raise exception 'DERIVED_DOMAIN_HMAC_MATCH_FAILED'; end if;
  if app.is_suppressed(
    '22222222-2222-4222-8222-222222222222',
    null, 'one-click@invalid.test', 'plant-a.invalid'
  ) then raise exception 'SUPPRESSION_TENANT_ISOLATION_FAILED'; end if;
end;
$$;

do $$
begin
  begin
    insert into public.suppression_entries (
      organization_id, kind, normalized_email, reason
    ) values (
      '11111111-1111-4111-8111-111111111111', 'DNC', 'one-click@invalid.test', 'DUPLICATE_TEST'
    );
    raise exception 'EXPECTED_DUPLICATE_SUPPRESSION_REJECTION';
  exception when unique_violation then null; end;
  begin
    update app.private_runtime_config set suppression_hmac_secret = repeat('e', 64)
    where organization_id = '11111111-1111-4111-8111-111111111111';
    raise exception 'EXPECTED_SECRET_ROTATION_REJECTION';
  exception when others then
    if sqlerrm <> 'SUPPRESSION_SECRET_ROTATION_REQUIRES_CONTROLLED_REHASH' then raise; end if;
  end;
end;
$$;

insert into public.campaigns (id, organization_id, name, manifest_json, manifest_sha256) values
  ('41111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Synthetic Campaign', '{}'::jsonb, repeat('5', 64));
insert into public.sequence_versions (id, organization_id, campaign_id, version, sender_name, sender_title, content_sha256) values
  ('42111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '41111111-1111-4111-8111-111111111111', 1, 'Synthetic', 'CEO', repeat('6', 64));
insert into public.mailboxes (id, organization_id, normalized_email, domain, sender_name) values
  ('43111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'sender@invalid.test', 'invalid.test', 'Synthetic');
insert into public.campaign_enrollments (
  id, organization_id, campaign_id, sequence_version_id, account_id, contact_id, mailbox_id
) values (
  '44111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111111', '42111111-1111-4111-8111-111111111111',
  '21111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111111',
  '43111111-1111-4111-8111-111111111111'
);

do $$
declare
  token_nonce uuid := '51111111-1111-4111-8111-111111111111';
  request_nonce uuid := '52111111-1111-4111-8111-111111111111';
  idempotency_key text := 'unsubscribe:' || repeat('7', 64);
  expiry_epoch bigint := extract(epoch from clock_timestamp() + interval '3 minutes')::bigint;
  payload_sha256 text;
  canonical_value text;
  request_signature text;
begin
  payload_sha256 := encode(digest(
    '11111111-1111-4111-8111-111111111111:44111111-1111-4111-8111-111111111111:' || token_nonce::text,
    'sha256'
  ), 'hex');
  canonical_value := concat_ws(':',
    '11111111-1111-4111-8111-111111111111',
    '44111111-1111-4111-8111-111111111111', token_nonce::text,
    idempotency_key, request_nonce::text, expiry_epoch::text, payload_sha256
  );
  request_signature := encode(hmac(
    convert_to(canonical_value, 'UTF8'), convert_to(repeat('1', 64), 'UTF8'), 'sha256'
  ), 'hex');
  perform public.apply_one_click_unsubscribe(
    '11111111-1111-4111-8111-111111111111',
    '44111111-1111-4111-8111-111111111111', token_nonce, idempotency_key,
    request_nonce, expiry_epoch, payload_sha256, request_signature
  );
end;
$$;

do $$
begin
  if not exists (
    select 1 from public.suppression_entries
    where organization_id = '11111111-1111-4111-8111-111111111111'
      and kind = 'UNSUBSCRIBE' and email_hmac is not null
  ) then raise exception 'ONE_CLICK_COMPATIBILITY_FAILED'; end if;
  if exists (
    select 1 from public.suppression_entries
    where normalized_email is not null or normalized_domain is not null or account_id is not null
  ) then raise exception 'ONE_CLICK_RAW_EMAIL_PERSISTED'; end if;
end;
$$;

insert into public.suppression_entries (
  organization_id, kind, normalized_email, reason
) values (
  '22222222-2222-4222-8222-222222222222', 'HARD_BOUNCE',
  'one-click@invalid.test', 'GMAIL_HARD_BOUNCE'
);

do $$
begin
  if not exists (
    select 1 from public.suppression_entries
    where organization_id = '22222222-2222-4222-8222-222222222222'
      and kind = 'HARD_BOUNCE' and email_hmac is not null
  ) then raise exception 'HARD_BOUNCE_COMPATIBILITY_FAILED'; end if;
  if has_function_privilege(
    'authenticated', 'app.compute_suppression_hmac(uuid,text,text)', 'EXECUTE'
  ) or has_function_privilege(
    'anon', 'app.compute_suppression_hmac(uuid,text,text)', 'EXECUTE'
  ) then raise exception 'SUPPRESSION_HMAC_ORACLE_EXPOSED'; end if;
  if has_table_privilege('authenticated', 'public.suppression_entries', 'SELECT') then
    raise exception 'SUPPRESSION_HASH_READ_EXPOSED';
  end if;
end;
$$;

set request.jwt.claim.sub = '81111111-1111-4111-8111-111111111111';
set request.jwt.claim.aal = 'aal2';
insert into public.organization_users (organization_id, user_id, role, active) values
  ('11111111-1111-4111-8111-111111111111', '81111111-1111-4111-8111-111111111111', 'teckel_admin', true);
set role authenticated;
insert into public.deletion_batches (
  id, organization_id, reason_code, evidence_class, input_manifest_sha256, requested_by
) values (
  '61111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111',
  'SYNTHETIC_TEST', 'synthetic_demo', repeat('8', 64), '81111111-1111-4111-8111-111111111111'
);
reset role;
reset request.jwt.claim.aal;
reset request.jwt.claim.sub;

set role service_role;
select app.create_contact_deletion_item(
  '61111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111111',
  now() - interval '1 day'
) as deletion_item_id \gset
reset role;

set request.jwt.claim.sub = '82111111-1111-4111-8111-111111111111';
set request.jwt.claim.aal = 'aal2';
insert into public.organization_users (organization_id, user_id, role, active) values
  ('11111111-1111-4111-8111-111111111111', '82111111-1111-4111-8111-111111111111', 'teckel_admin', true);
set role authenticated;
update public.deletion_batches
set status = 'APPROVED', approved_by = '82111111-1111-4111-8111-111111111111', approved_at = now()
where id = '61111111-1111-4111-8111-111111111111';
reset role;
reset request.jwt.claim.aal;
reset request.jwt.claim.sub;

set role service_role;
select app.assess_contact_deletion(:'deletion_item_id') as assessed_status;
select app.execute_contact_deletion(:'deletion_item_id') as deletion_executed;
reset role;

do $$
begin
  if exists (
    select 1 from public.suppression_entries
    where normalized_email is not null or normalized_domain is not null or account_id is not null
  ) then raise exception 'DELETION_LEFT_RAW_SUPPRESSION_IDENTITY'; end if;
  if not exists (
    select 1 from public.suppression_entries
    where organization_id = '11111111-1111-4111-8111-111111111111'
      and kind = 'DNC' and account_hmac is not null and email_hmac is not null
      and expires_at is null
  ) then raise exception 'DELETION_DNC_HMAC_MISSING'; end if;
  if not app.is_suppressed(
    '11111111-1111-4111-8111-111111111111', null, 'one-click@invalid.test', null
  ) then raise exception 'DELETION_DNC_MATCH_LOST'; end if;
  if exists (
    select 1 from public.audit_log
    where coalesce(old_data::text, '') like '%one-click@invalid.test%'
       or coalesce(new_data::text, '') like '%one-click@invalid.test%'
       or coalesce(old_data::text, '') ~ '[a-f0-9]{64}' and record_type = 'suppression_entries'
       or coalesce(new_data::text, '') ~ '[a-f0-9]{64}' and record_type = 'suppression_entries'
  ) then raise exception 'SUPPRESSION_AUDIT_LEAKED_RAW_OR_HMAC'; end if;
  if exists (
    select 1 from public.event_outbox
    where payload_json::text like '%one-click@invalid.test%'
       or aggregate_type = 'suppression' and payload_json::text ~ '[a-f0-9]{64}'
  ) then raise exception 'SUPPRESSION_OUTBOX_LEAKED_RAW_OR_HMAC'; end if;
  if exists (
    select 1 from public.deletion_tombstones where to_jsonb(deletion_tombstones)::text like '%one-click@invalid.test%'
  ) then raise exception 'DELETION_TOMBSTONE_LEAKED_RAW_EMAIL'; end if;
end;
$$;

\echo 'SUPPRESSION_PRIVACY_GATE_PASS'
