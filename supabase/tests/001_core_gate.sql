\set ON_ERROR_STOP on

insert into public.organizations (id, slug, legal_name) values
  ('11111111-1111-4111-8111-111111111111', 'ennco', 'ENNCO'),
  ('12121212-1212-4212-8212-121212121212', 'other-org', 'Other Org');

insert into public.organization_users (organization_id, user_id, role) values
  ('11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999', 'teckel_admin'),
  ('11111111-1111-4111-8111-111111111111', '98989898-9898-4898-8898-989898989898', 'ennco_operator');

insert into public.runtime_controls (organization_id, global_kill_switch, external_send_allowed) values
  ('11111111-1111-4111-8111-111111111111', true, false),
  ('12121212-1212-4212-8212-121212121212', true, false);

insert into public.accounts (
  id, organization_id, legal_name, normalized_name, primary_domain, evidence_class, source_confidence
) values
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Golden Path SA', 'golden path sa', 'golden.example', 'synthetic_demo', 'VERIFIED'),
  ('23232323-2323-4232-8232-232323232323', '11111111-1111-4111-8111-111111111111', 'Suppressed SA', 'suppressed sa', 'suppressed.example', 'synthetic_demo', 'VERIFIED'),
  ('24242424-2424-4242-8242-242424242424', '12121212-1212-4212-8212-121212121212', 'Foreign Tenant SA', 'foreign tenant sa', 'foreign.example', 'synthetic_demo', 'VERIFIED');

insert into public.contacts (
  id, organization_id, account_id, full_name, role_title, normalized_email,
  verified, verified_at, source_confidence
) values
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'Ana Prueba', 'CEO', 'ana@golden.example', true, now(), 'VERIFIED'),
  ('34343434-3434-4343-8343-343434343434', '11111111-1111-4111-8111-111111111111', '23232323-2323-4232-8232-232323232323', 'Beto Bloqueado', 'CEO', 'beto@blocked.example', true, now(), 'VERIFIED');

insert into public.campaigns (
  id, organization_id, name, status, manifest_json, manifest_sha256
) values (
  '44444444-4444-4444-8444-444444444444',
  '11111111-1111-4111-8111-111111111111',
  'Synthetic golden path',
  'DRAFT',
  '{"evidence_class":"synthetic_demo"}',
  repeat('a', 64)
);

insert into public.sequence_versions (
  id, organization_id, campaign_id, version, sender_name, sender_title, content_sha256
) values (
  '55555555-5555-4555-8555-555555555555',
  '11111111-1111-4111-8111-111111111111',
  '44444444-4444-4444-8444-444444444444',
  1,
  'Francisco Cuellar',
  'CEO',
  repeat('b', 64)
);

insert into public.sequence_touches (
  organization_id, sequence_version_id, touch_number, day_offset, subject_template, body_template
) values (
  '11111111-1111-4111-8111-111111111111',
  '55555555-5555-4555-8555-555555555555',
  1,
  0,
  'Prueba sintética',
  'Mensaje sintético. No enviar.'
);

insert into public.mailboxes (
  id, organization_id, normalized_email, domain, sender_name
) values (
  '66666666-6666-4666-8666-666666666666',
  '11111111-1111-4111-8111-111111111111',
  'francisco@outreach.example',
  'outreach.example',
  'Francisco Cuellar'
);

insert into public.campaign_enrollments (
  id, organization_id, campaign_id, sequence_version_id, account_id, contact_id, mailbox_id, status
) values
  ('77777777-7777-4777-8777-777777777777', '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '66666666-6666-4666-8666-666666666666', 'PENDING'),
  ('78787878-7878-4787-8787-787878787878', '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555', '23232323-2323-4232-8232-232323232323', '34343434-3434-4343-8343-343434343434', '66666666-6666-4666-8666-666666666666', 'PENDING');

do $$
begin
  begin
    insert into public.contacts (
      organization_id, account_id, full_name, role_title, normalized_email
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '24242424-2424-4242-8242-242424242424',
      'Cross Tenant',
      'CEO',
      'cross@foreign.example'
    );
    raise exception 'EXPECTED_TENANT_REFERENCE_REJECTION';
  exception
    when others then
      if sqlerrm not like 'TENANT_REFERENCE_MISMATCH:%' then raise; end if;
  end;
end;
$$;

insert into public.suppression_entries (
  organization_id, kind, account_id, normalized_email, normalized_domain, reason
) values
  ('11111111-1111-4111-8111-111111111111', 'CURRENT_CLIENT', '23232323-2323-4232-8232-232323232323', null, null, 'Synthetic account suppression'),
  ('11111111-1111-4111-8111-111111111111', 'DNC', null, 'beto@blocked.example', null, 'Synthetic email suppression'),
  ('11111111-1111-4111-8111-111111111111', 'ANNEX_A', null, null, 'blocked.example', 'Synthetic Annex A domain suppression');

do $$
begin
  if not app.is_suppressed(
    '11111111-1111-4111-8111-111111111111',
    '23232323-2323-4232-8232-232323232323',
    'unlisted@different.example',
    'different.example'
  ) then raise exception 'ACCOUNT_SUPPRESSION_NOT_MATCHED'; end if;

  if not app.is_suppressed(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'beto@blocked.example',
    'different.example'
  ) then raise exception 'EMAIL_SUPPRESSION_NOT_MATCHED'; end if;

  if not app.is_suppressed(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'someone@blocked.example',
    'different.example'
  ) then raise exception 'EMAIL_DOMAIN_SUPPRESSION_NOT_MATCHED'; end if;
end;
$$;

do $$
declare
  message_id uuid;
begin
  message_id := app.enqueue_outbound_message(
    '11111111-1111-4111-8111-111111111111',
    '78787878-7878-4787-8787-787878787878',
    1,
    'No debe enviarse',
    'Suprimido',
    'suppressed-attempt-1',
    '88888888-8888-4888-8888-888888888888',
    true
  );

  if message_id is not null then raise exception 'SUPPRESSION_DID_NOT_FAIL_CLOSED'; end if;
  if (select status from public.campaign_enrollments where id = '78787878-7878-4787-8787-787878787878') <> 'SUPPRESSED' then
    raise exception 'SUPPRESSION_STATUS_NOT_PERSISTED';
  end if;
  if exists (select 1 from public.messages where enrollment_id = '78787878-7878-4787-8787-787878787878') then
    raise exception 'SUPPRESSED_MESSAGE_WAS_CREATED';
  end if;
  if (select count(*) from public.event_outbox where event_type = 'enrollment.suppressed') <> 1 then
    raise exception 'SUPPRESSION_OUTBOX_EVENT_MISSING';
  end if;
end;
$$;

do $$
declare
  first_id uuid;
  replay_id uuid;
begin
  first_id := app.enqueue_outbound_message(
    '11111111-1111-4111-8111-111111111111',
    '77777777-7777-4777-8777-777777777777',
    1,
    'Prueba sintética',
    'Mensaje sintético. No enviar.',
    'dry-run-idempotency-1',
    '89898989-8989-4898-8898-898989898989',
    true
  );
  replay_id := app.enqueue_outbound_message(
    '11111111-1111-4111-8111-111111111111',
    '77777777-7777-4777-8777-777777777777',
    1,
    'Prueba sintética',
    'Mensaje sintético. No enviar.',
    'dry-run-idempotency-1',
    '89898989-8989-4898-8898-898989898989',
    true
  );

  if first_id is null or replay_id <> first_id then raise exception 'IDEMPOTENT_REPLAY_CHANGED_RESULT'; end if;
  if (select count(*) from public.messages where idempotency_key = 'dry-run-idempotency-1') <> 1 then
    raise exception 'IDEMPOTENT_REPLAY_DUPLICATED_MESSAGE';
  end if;
  if (select count(*) from public.event_outbox where aggregate_id = first_id and event_type = 'message.dry_run_created') <> 1 then
    raise exception 'IDEMPOTENT_REPLAY_DUPLICATED_OUTBOX';
  end if;

  begin
    perform app.enqueue_outbound_message(
      '11111111-1111-4111-8111-111111111111',
      '77777777-7777-4777-8777-777777777777',
      1,
      'Prueba sintética',
      'Payload distinto',
      'dry-run-idempotency-1',
      '89898989-8989-4898-8898-898989898989',
      true
    );
    raise exception 'EXPECTED_IDEMPOTENCY_MISMATCH';
  exception
    when others then
      if sqlerrm <> 'IDEMPOTENCY_KEY_REUSE_MISMATCH' then raise; end if;
  end;
end;
$$;

do $$
begin
  if not exists (
    select 1 from public.audit_log
    where record_type = 'messages' and action = 'INSERT'
  ) then raise exception 'MESSAGE_AUDIT_EVENT_MISSING'; end if;

  begin
    update public.audit_log set action = 'FORGED' where record_type = 'messages';
    raise exception 'EXPECTED_AUDIT_UPDATE_REJECTION';
  exception
    when others then
      if sqlerrm <> 'AUDIT_LOG_APPEND_ONLY' then raise; end if;
  end;

  begin
    delete from public.audit_log where record_type = 'messages';
    raise exception 'EXPECTED_AUDIT_DELETE_REJECTION';
  exception
    when others then
      if sqlerrm <> 'AUDIT_LOG_APPEND_ONLY' then raise; end if;
  end;
end;
$$;

set request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999';
set role authenticated;

do $$
begin
  if (select count(*) from public.accounts) <> 2 then
    raise exception 'TENANT_RLS_ACCOUNT_ISOLATION_FAILED';
  end if;

  if not exists (select 1 from public.audit_log where record_type = 'messages') then
    raise exception 'MEMBER_CANNOT_READ_AUDIT';
  end if;

  begin
    insert into public.audit_log (organization_id, action, record_type)
    values ('11111111-1111-4111-8111-111111111111', 'FORGED', 'messages');
    raise exception 'EXPECTED_AUDIT_INSERT_REJECTION';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform app.enqueue_outbound_message(
      '11111111-1111-4111-8111-111111111111',
      '77777777-7777-4777-8777-777777777777',
      1,
      'Unauthorized',
      'Unauthorized',
      'unauthorized',
      gen_random_uuid(),
      true
    );
    raise exception 'EXPECTED_ENQUEUE_EXECUTE_REJECTION';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;
reset request.jwt.claim.sub;

set request.jwt.claim.sub = '98989898-9898-4898-8898-989898989898';
set role authenticated;

do $$
declare
  affected_count integer;
begin
  update public.runtime_controls
  set global_kill_switch = false, external_send_allowed = true
  where organization_id = '11111111-1111-4111-8111-111111111111';
  get diagnostics affected_count = row_count;
  if affected_count <> 0 then raise exception 'NON_ADMIN_CHANGED_RUNTIME_CONTROLS'; end if;
end;
$$;

reset role;
reset request.jwt.claim.sub;

update public.sequence_versions
set approved_by = '99999999-9999-4999-8999-999999999999', approved_at = now()
where id = '55555555-5555-4555-8555-555555555555';

update public.campaigns
set status = 'ACTIVE',
    shadow_canary_decision = 'PASS',
    approved_by = '99999999-9999-4999-8999-999999999999',
    approved_at = now(),
    suppression_snapshot_at = now()
where id = '44444444-4444-4444-8444-444444444444';

update public.mailboxes
set health_status = 'HEALTHY',
    auth_spf = true,
    auth_dkim = true,
    auth_dmarc = true,
    auth_tls = true,
    domain_ready_at = now() - interval '36 days'
where id = '66666666-6666-4666-8666-666666666666';

update public.campaign_enrollments
set status = 'ACTIVE'
where id = '77777777-7777-4777-8777-777777777777';

do $$
begin
  begin
    perform app.enqueue_outbound_message(
      '11111111-1111-4111-8111-111111111111',
      '77777777-7777-4777-8777-777777777777',
      1,
      'Prueba sintética',
      'Mensaje sintético. No enviar.',
      'live-global-hold',
      '90909090-9090-4090-8090-909090909090',
      false
    );
    raise exception 'EXPECTED_GLOBAL_HOLD';
  exception
    when others then
      if sqlerrm <> 'GLOBAL_SEND_HOLD' then raise; end if;
  end;
end;
$$;

update public.runtime_controls
set global_kill_switch = false, external_send_allowed = true
where organization_id = '11111111-1111-4111-8111-111111111111';

do $$
begin
  begin
    perform app.enqueue_outbound_message(
      '11111111-1111-4111-8111-111111111111',
      '77777777-7777-4777-8777-777777777777',
      1,
      'Prueba sintética',
      'Mensaje sintético. No enviar.',
      'live-mailbox-hold',
      '91919191-9191-4191-8191-919191919191',
      false
    );
    raise exception 'EXPECTED_MAILBOX_HOLD';
  exception
    when others then
      if sqlerrm <> 'MAILBOX_HOLD' then raise; end if;
  end;
end;
$$;

update public.mailboxes set kill_switch = false
where id = '66666666-6666-4666-8666-666666666666';

do $$
declare
  queued_id uuid;
begin
  queued_id := app.enqueue_outbound_message(
    '11111111-1111-4111-8111-111111111111',
    '77777777-7777-4777-8777-777777777777',
    1,
    'Prueba sintética',
    'Mensaje sintético. No enviar.',
    'live-queue-only',
    '92929292-9292-4292-8292-929292929292',
    false
  );
  if (select status from public.messages where id = queued_id) <> 'QUEUED' then
    raise exception 'RELEASED_MESSAGE_NOT_QUEUED';
  end if;
end;
$$;

update public.runtime_controls
set global_kill_switch = true, external_send_allowed = false
where organization_id = '11111111-1111-4111-8111-111111111111';

update public.event_outbox set next_attempt_at = now() + interval '1 day';

insert into public.event_outbox (
  id, organization_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload_json
) values
  ('a1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'test', 'a2111111-1111-4111-8111-111111111111', 'test.retry', 'outbox-retry', '{"synthetic":true}'),
  ('a3111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'test', 'a4111111-1111-4111-8111-111111111111', 'test.complete', 'outbox-complete', '{"synthetic":true}'),
  ('a5111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'test', 'a6111111-1111-4111-8111-111111111111', 'test.stale', 'outbox-stale', '{"synthetic":true}');

do $$
declare
  claimed public.event_outbox%rowtype;
  retry_status public.notification_status;
begin
  select * into claimed from app.claim_outbox_events('11111111-1111-4111-8111-111111111111', 1);
  if claimed.id <> 'a1111111-1111-4111-8111-111111111111' or claimed.attempt_count <> 1 or claimed.status <> 'PROCESSING' then
    raise exception 'OUTBOX_FIRST_CLAIM_INVALID';
  end if;

  retry_status := app.fail_outbox_event(
    '11111111-1111-4111-8111-111111111111', claimed.id, 'synthetic failure', 2
  );
  if retry_status <> 'FAILED' then raise exception 'OUTBOX_RETRY_NOT_SCHEDULED'; end if;

  update public.event_outbox set next_attempt_at = now() - interval '1 minute' where id = claimed.id;
  select * into claimed from app.claim_outbox_events('11111111-1111-4111-8111-111111111111', 1);
  if claimed.id <> 'a1111111-1111-4111-8111-111111111111' or claimed.attempt_count <> 2 then
    raise exception 'OUTBOX_SECOND_CLAIM_INVALID';
  end if;

  retry_status := app.fail_outbox_event(
    '11111111-1111-4111-8111-111111111111', claimed.id, 'terminal synthetic failure', 2
  );
  if retry_status <> 'DEAD_LETTER' then raise exception 'OUTBOX_NOT_DEAD_LETTERED'; end if;
  if (select count(*) from public.dead_letters where source_id = claimed.id) <> 1 then
    raise exception 'DEAD_LETTER_RECORD_MISSING';
  end if;
end;
$$;

do $$
declare
  claimed public.event_outbox%rowtype;
begin
  select * into claimed from app.claim_outbox_events('11111111-1111-4111-8111-111111111111', 1);
  if claimed.id <> 'a3111111-1111-4111-8111-111111111111' then raise exception 'OUTBOX_COMPLETE_CLAIM_INVALID'; end if;
  if not app.complete_outbox_event('11111111-1111-4111-8111-111111111111', claimed.id) then
    raise exception 'OUTBOX_COMPLETE_FAILED';
  end if;
  if app.complete_outbox_event('11111111-1111-4111-8111-111111111111', claimed.id) then
    raise exception 'OUTBOX_COMPLETE_NOT_IDEMPOTENT';
  end if;
end;
$$;

do $$
declare
  claimed public.event_outbox%rowtype;
  requeued integer;
begin
  select * into claimed from app.claim_outbox_events('11111111-1111-4111-8111-111111111111', 1);
  if claimed.id <> 'a5111111-1111-4111-8111-111111111111' then raise exception 'OUTBOX_STALE_CLAIM_INVALID'; end if;
  update public.event_outbox set locked_at = now() - interval '10 minutes' where id = claimed.id;
  requeued := app.requeue_stale_outbox_events('11111111-1111-4111-8111-111111111111', interval '5 minutes');
  if requeued <> 1 then raise exception 'OUTBOX_STALE_LEASE_NOT_REQUEUED'; end if;
end;
$$;

do $$
begin
  begin
    insert into public.event_outbox (
      organization_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload_json
    ) values (
      '11111111-1111-4111-8111-111111111111', 'test', gen_random_uuid(), 'test.duplicate', 'outbox-retry', '{}'
    );
    raise exception 'EXPECTED_OUTBOX_IDEMPOTENCY_REJECTION';
  exception
    when unique_violation then null;
  end;
end;
$$;

do $$
begin
  if exists (
    select 1 from public.messages
    where idempotency_key in ('live-global-hold', 'live-mailbox-hold')
  ) then raise exception 'KILL_SWITCH_CREATED_MESSAGE'; end if;

  if not exists (
    select 1 from public.audit_log
    where record_type = 'runtime_controls' and action = 'UPDATE'
  ) then raise exception 'KILL_SWITCH_AUDIT_MISSING'; end if;
end;
$$;

\echo 'CORE_DATABASE_GATE_PASS'
