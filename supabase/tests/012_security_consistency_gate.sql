\set ON_ERROR_STOP on

insert into public.organizations (id, slug, legal_name) values
  ('11111111-1111-4111-8111-111111111111', 'security-org-a', 'Security Org A'),
  ('12121212-1212-4212-8212-121212121212', 'security-org-b', 'Security Org B');

insert into public.organization_users (organization_id, user_id, role, active) values
  ('11111111-1111-4111-8111-111111111111', '81111111-1111-4111-8111-111111111111', 'teckel_admin', true),
  ('11111111-1111-4111-8111-111111111111', '82111111-1111-4111-8111-111111111111', 'teckel_admin', true),
  ('11111111-1111-4111-8111-111111111111', '83111111-1111-4111-8111-111111111111', 'teckel_operator', true),
  ('11111111-1111-4111-8111-111111111111', '84111111-1111-4111-8111-111111111111', 'ennco_operator', true);

insert into public.accounts (id, organization_id, legal_name, normalized_name, evidence_class) values
  ('21111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Security Account A', 'security account a', 'synthetic_demo'),
  ('22121212-1212-4212-8212-121212121212', '12121212-1212-4212-8212-121212121212', 'Security Account B', 'security account b', 'synthetic_demo');

insert into public.contacts (
  id, organization_id, account_id, full_name, role_title, normalized_email
) values
  ('31111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111111', 'Security Contact One', 'CEO', 'security-one@invalid.test'),
  ('32111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111111', 'Security Contact Two', 'CEO', 'security-two@invalid.test');

set request.jwt.claim.sub = '83111111-1111-4111-8111-111111111111';
set request.jwt.claim.aal = 'aal1';
set role authenticated;

do $$
begin
  if app.is_member('11111111-1111-4111-8111-111111111111') then
    raise exception 'AAL1_MEMBER_HELPER_BYPASS';
  end if;
  if exists (select 1 from public.contacts) then
    raise exception 'AAL1_RLS_READ_BYPASS';
  end if;
end;
$$;

reset role;
reset request.jwt.claim.aal;
set request.jwt.claims = '{"aal":"aal2"}';
set role authenticated;

do $$
begin
  if not app.is_member('11111111-1111-4111-8111-111111111111') then
    raise exception 'AAL2_CLAIMS_FALLBACK_REJECTED aal=%', app.current_request_aal();
  end if;
  if (select count(*) from public.contacts) <> 2 then
    raise exception 'AAL2_MEMBER_READ_REJECTED aal=% count=%',
      app.current_request_aal(), (select count(*) from public.contacts);
  end if;
end;
$$;

do $$
begin
  begin
    insert into public.event_outbox (
      organization_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload_json
    ) values (
      '11111111-1111-4111-8111-111111111111', 'message',
      '31111111-1111-4111-8111-111111111111', 'message.queued',
      'security-direct-outbox-0001', '{"forged":true}'::jsonb
    );
    raise exception 'EXPECTED_DIRECT_OUTBOX_REJECTION';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;
reset request.jwt.claims;
reset request.jwt.claim.sub;

set request.jwt.claim.sub = '84111111-1111-4111-8111-111111111111';
set request.jwt.claim.aal = 'aal2';
set role authenticated;

do $$
begin
  begin
    insert into public.leads (
      organization_id, account_id, status, contractual_qualified, evidence_class
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22121212-1212-4212-8212-121212121212',
      'CAPTURED', false, 'synthetic_demo'
    );
    raise exception 'EXPECTED_CROSS_TENANT_LEAD_REJECTION';
  exception
    when foreign_key_violation then null;
  end;

  begin
    insert into public.leads (
      organization_id, account_id, contact_id, status, contractual_qualified, evidence_class
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '21111111-1111-4111-8111-111111111111',
      '32111111-1111-4111-8111-111111111111',
      'CAPTURED', false, 'synthetic_demo'
    );
  exception
    when others then raise exception 'VALID_TENANT_LEAD_REJECTED:%', sqlerrm;
  end;
end;
$$;

reset role;
reset request.jwt.claim.aal;
reset request.jwt.claim.sub;

set request.jwt.claim.sub = '81111111-1111-4111-8111-111111111111';
set request.jwt.claim.aal = 'aal2';
set role authenticated;

insert into public.deletion_batches (
  id, organization_id, reason_code, evidence_class, input_manifest_sha256, requested_by
) values (
  '61111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  'SYNTHETIC_TEST', 'synthetic_demo', repeat('a', 64),
  '81111111-1111-4111-8111-111111111111'
);

reset role;
reset request.jwt.claim.aal;
reset request.jwt.claim.sub;

set role service_role;
select app.create_contact_deletion_item(
  '61111111-1111-4111-8111-111111111111',
  '31111111-1111-4111-8111-111111111111',
  now() - interval '1 day'
) as first_deletion_item_id \gset
reset role;

set request.jwt.claim.sub = '82111111-1111-4111-8111-111111111111';
set request.jwt.claim.aal = 'aal2';
set role authenticated;

update public.deletion_batches
set status = 'APPROVED',
    approved_by = '82111111-1111-4111-8111-111111111111',
    approved_at = now()
where id = '61111111-1111-4111-8111-111111111111';

do $$
begin
  if not exists (
    select 1 from public.deletion_batches
    where id = '61111111-1111-4111-8111-111111111111'
      and approved_item_count = 1
      and approved_items_sha256 ~ '^[a-f0-9]{64}$'
  ) then raise exception 'DELETION_BATCH_APPROVED_ITEM_SNAPSHOT_MISSING'; end if;
end;
$$;

reset role;
reset request.jwt.claim.aal;
reset request.jwt.claim.sub;

set role service_role;
do $$
begin
  begin
    perform app.create_contact_deletion_item(
      '61111111-1111-4111-8111-111111111111',
      '32111111-1111-4111-8111-111111111111',
      now() - interval '1 day'
    );
    raise exception 'EXPECTED_POST_APPROVAL_ITEM_REJECTION';
  exception
    when others then
      if sqlerrm <> 'DELETION_BATCH_NOT_DRAFT' then raise; end if;
  end;
end;
$$;
reset role;

do $$
begin
  begin
    insert into public.deletion_items (
      organization_id, batch_id, subject_id, subject_hash, retention_due_at
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '61111111-1111-4111-8111-111111111111',
      '32111111-1111-4111-8111-111111111111',
      repeat('b', 64),
      now() - interval '1 day'
    );
    raise exception 'EXPECTED_DIRECT_POST_APPROVAL_ITEM_REJECTION';
  exception
    when others then
      if sqlerrm <> 'DELETION_BATCH_ITEMS_FROZEN' then raise; end if;
  end;
end;
$$;

do $$
begin
  if has_table_privilege('authenticated', 'public.event_outbox', 'INSERT')
    or has_table_privilege('authenticated', 'public.event_outbox', 'UPDATE')
    or has_table_privilege('authenticated', 'public.event_outbox', 'DELETE')
  then raise exception 'AUTHENTICATED_OUTBOX_DML_PRIVILEGE_REMAINS'; end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'event_outbox'
      and policyname = 'event_outbox_technical_write'
  ) then raise exception 'OUTBOX_DIRECT_WRITE_POLICY_REMAINS'; end if;
end;
$$;

\echo 'SECURITY_CONSISTENCY_GATE_PASS'
