\set ON_ERROR_STOP on

insert into public.organizations (id, slug, legal_name) values
  ('11111111-1111-4111-8111-111111111111', 'ennco-m4', 'ENNCO M4'),
  ('12121212-1212-4212-8212-121212121212', 'other-m4', 'Other M4');

insert into public.organization_users (organization_id, user_id, role) values
  ('11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999', 'teckel_admin'),
  ('11111111-1111-4111-8111-111111111111', '98989898-9898-4898-8898-989898989898', 'ennco_operator'),
  ('12121212-1212-4212-8212-121212121212', '97979797-9797-4797-8797-979797979797', 'ennco_operator');

insert into public.runtime_controls (organization_id, global_kill_switch, external_send_allowed) values
  ('11111111-1111-4111-8111-111111111111', true, false),
  ('12121212-1212-4212-8212-121212121212', true, false);

insert into app.private_runtime_config (organization_id, prequote_ingest_secret, gmail_ingest_secret) values
  ('11111111-1111-4111-8111-111111111111', 'synthetic-prequote-secret-at-least-32-bytes', 'synthetic-gmail-secret-at-least-32-bytes');

insert into public.accounts (
  id, organization_id, legal_name, normalized_name, primary_domain, evidence_class, source_confidence
) values
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Synthetic Alpha', 'synthetic alpha', 'alpha.invalid', 'synthetic_demo', 'VERIFIED'),
  ('23232323-2323-4232-8232-232323232323', '11111111-1111-4111-8111-111111111111', 'Synthetic Beta', 'synthetic beta', 'beta.invalid', 'synthetic_demo', 'VERIFIED'),
  ('24242424-2424-4242-8242-242424242424', '12121212-1212-4212-8212-121212121212', 'Foreign Synthetic', 'foreign synthetic', 'foreign.invalid', 'synthetic_demo', 'VERIFIED');

insert into public.contacts (
  id, organization_id, account_id, full_name, role_title, normalized_email,
  verified, verified_at, source_confidence
) values
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'Persona Sintetica A', 'CEO', 'person-a@alpha.invalid', true, now(), 'VERIFIED'),
  ('34343434-3434-4343-8343-343434343434', '11111111-1111-4111-8111-111111111111', '23232323-2323-4232-8232-232323232323', 'Persona Sintetica B', 'Mantenimiento', 'person-b@beta.invalid', true, now(), 'VERIFIED');

insert into public.campaigns (
  id, organization_id, name, status, manifest_json, manifest_sha256
) values (
  '44444444-4444-4444-8444-444444444444',
  '11111111-1111-4111-8111-111111111111',
  'M4 synthetic campaign',
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
  'Synthetic only',
  'Synthetic only. Never send.'
);

insert into public.mailboxes (
  id, organization_id, normalized_email, domain, sender_name
) values
  ('66666666-6666-4666-8666-666666666666', '11111111-1111-4111-8111-111111111111', 'francisco@outreach.invalid', 'outreach.invalid', 'Francisco Cuellar'),
  ('67676767-6767-4767-8767-676767676767', '12121212-1212-4212-8212-121212121212', 'foreign@foreign.invalid', 'foreign.invalid', 'Foreign');

insert into public.mailbox_sync_cursors (
  organization_id, mailbox_id, last_history_id, status
) values (
  '11111111-1111-4111-8111-111111111111',
  '66666666-6666-4666-8666-666666666666',
  '1000',
  'HOLD'
);

insert into public.campaign_enrollments (
  id, organization_id, campaign_id, sequence_version_id, account_id, contact_id, mailbox_id, status
) values
  ('77777777-7777-4777-8777-777777777777', '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '66666666-6666-4666-8666-666666666666', 'ACTIVE'),
  ('78787878-7878-4787-8787-787878787878', '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555', '23232323-2323-4232-8232-232323232323', '34343434-3434-4343-8343-343434343434', '66666666-6666-4666-8666-666666666666', 'ACTIVE');

insert into public.messages (
  id, organization_id, enrollment_id, mailbox_id, contact_id, direction, status,
  touch_number, normalized_to, normalized_from, subject, body_text,
  idempotency_key, provider_message_id, correlation_id, sent_at
) values
  ('88888888-8888-4888-8888-888888888888', '11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777777', '66666666-6666-4666-8666-666666666666', '33333333-3333-4333-8333-333333333333', 'OUTBOUND', 'SENT', 1, 'person-a@alpha.invalid', 'francisco@outreach.invalid', 'Synthetic only', 'Synthetic only', 'm4-outbound-alpha', 'gmail-outbound-alpha', '89898989-8989-4898-8898-898989898989', now()),
  ('82828282-8282-4828-8828-828282828282', '11111111-1111-4111-8111-111111111111', '78787878-7878-4787-8787-787878787878', '66666666-6666-4666-8666-666666666666', '34343434-3434-4343-8343-343434343434', 'OUTBOUND', 'SENT', 1, 'person-b@beta.invalid', 'francisco@outreach.invalid', 'Synthetic only', 'Synthetic only', 'm4-outbound-beta', 'gmail-outbound-beta', '83838383-8383-4838-8838-838383838383', now());

create or replace function pg_temp.invoke_gmail_push(
  target_idempotency_key text,
  target_nonce uuid,
  target_payload jsonb,
  corrupt_signature boolean default false
)
returns jsonb
language plpgsql
as $$
declare
  organization_id_value uuid := '11111111-1111-4111-8111-111111111111';
  synthetic_secret text := 'synthetic-gmail-secret-at-least-32-bytes';
  payload_text text := target_payload::text;
  payload_hash text;
  expiry_epoch bigint;
  signed_value text;
  signature_value text;
begin
  payload_hash := encode(digest(payload_text, 'sha256'), 'hex');
  expiry_epoch := floor(extract(epoch from clock_timestamp()))::bigint + 300;
  signed_value := concat_ws(E'\n',
    organization_id_value::text,
    target_idempotency_key,
    target_nonce::text,
    expiry_epoch::text,
    payload_hash
  );
  signature_value := encode(
    hmac(convert_to(signed_value, 'UTF8'), convert_to(synthetic_secret, 'UTF8'), 'sha256'),
    'hex'
  );
  if corrupt_signature then signature_value := repeat('0', 64); end if;
  return public.capture_gmail_push_notification(
    organization_id_value,
    target_idempotency_key,
    target_nonce,
    expiry_epoch,
    payload_hash,
    signature_value,
    payload_text
  );
end;
$$;

do $$
declare
  payload jsonb := jsonb_build_object(
    'emailAddress', 'francisco@outreach.invalid',
    'historyId', '1001',
    'messageId', 'pubsub-1001',
    'publishTime', clock_timestamp(),
    'subscription', 'projects/synthetic/subscriptions/ennco-gmail'
  );
  accepted jsonb;
  duplicate jsonb;
begin
  accepted := pg_temp.invoke_gmail_push('m4-gmail-push-valid-0001', '11111111-aaaa-4111-8111-111111111111', payload);
  if accepted ->> 'status' <> 'ACCEPTED' then raise exception 'GMAIL_PUSH_NOT_ACCEPTED'; end if;

  duplicate := pg_temp.invoke_gmail_push('m4-gmail-push-valid-0002', '11111111-bbbb-4111-8111-111111111111', payload);
  if duplicate ->> 'status' <> 'DUPLICATE'
    or duplicate ->> 'notification_id' <> accepted ->> 'notification_id'
  then raise exception 'GMAIL_PUSH_IDEMPOTENCY_FAILED'; end if;

  if (select count(*) from public.gmail_push_notifications) <> 1 then
    raise exception 'GMAIL_PUSH_DUPLICATED_NOTIFICATION';
  end if;
  if (select count(*) from public.event_outbox where event_type = 'gmail.history_sync_requested') <> 1 then
    raise exception 'GMAIL_PUSH_OUTBOX_MISSING_OR_DUPLICATED';
  end if;

  begin
    perform pg_temp.invoke_gmail_push('m4-gmail-push-invalid-001', '11111111-cccc-4111-8111-111111111111', payload, true);
    raise exception 'EXPECTED_GMAIL_SIGNATURE_REJECTION';
  exception
    when others then
      if sqlerrm <> 'GMAIL_PUSH_SIGNATURE_INVALID' then raise; end if;
  end;
end;
$$;

set role service_role;

create temporary table m4_provider_results (
  label text primary key,
  result jsonb not null
);

insert into m4_provider_results (label, result)
select 'positive', app.apply_mailbox_provider_event(
  '11111111-1111-4111-8111-111111111111',
  '66666666-6666-4666-8666-666666666666',
  'gmail-event-positive-001',
  'gmail-inbound-positive-001',
  '88888888-8888-4888-8888-888888888888',
  'REPLY',
  'UNREVIEWED',
  'person-a@alpha.invalid',
  'Re: Synthetic only',
  'SENTINEL-M4-PRIVATE-BODY interested in a review',
  now(),
  '91919191-9191-4919-8919-919191919191'
);

insert into m4_provider_results (label, result)
select 'duplicate', app.apply_mailbox_provider_event(
  '11111111-1111-4111-8111-111111111111',
  '66666666-6666-4666-8666-666666666666',
  'gmail-event-positive-001',
  'gmail-inbound-positive-001',
  '88888888-8888-4888-8888-888888888888',
  'REPLY',
  'UNREVIEWED',
  'person-a@alpha.invalid',
  'Re: Synthetic only',
  'SENTINEL-M4-PRIVATE-BODY interested in a review',
  now(),
  '91919191-9191-4919-8919-919191919191'
);

reset role;

set request.jwt.claim.sub = '98989898-9898-4898-8898-989898989898';
set role authenticated;

select app.review_reply_event(
  '11111111-1111-4111-8111-111111111111',
  (select id from public.provider_events where external_event_id = 'gmail-event-positive-001'),
  'POSITIVE'
);

select app.review_reply_event(
  '11111111-1111-4111-8111-111111111111',
  (select id from public.provider_events where external_event_id = 'gmail-event-positive-001'),
  'POSITIVE'
);

reset role;
reset request.jwt.claim.sub;

do $$
begin
  if (select result ->> 'status' from m4_provider_results where label = 'positive') <> 'PROCESSED' then
    raise exception 'POSITIVE_REPLY_NOT_PROCESSED';
  end if;
  if (select result ->> 'status' from m4_provider_results where label = 'duplicate') <> 'DUPLICATE' then
    raise exception 'PROVIDER_EVENT_IDEMPOTENCY_FAILED';
  end if;
  if (select status from public.campaign_enrollments where id = '77777777-7777-4777-8777-777777777777') <> 'REPLIED' then
    raise exception 'REPLY_DID_NOT_STOP_ENROLLMENT';
  end if;
  if (select count(*) from public.messages where direction = 'INBOUND' and provider_message_id = 'gmail-inbound-positive-001') <> 1 then
    raise exception 'INBOUND_MESSAGE_MISSING_OR_DUPLICATED';
  end if;
  if (select count(*) from public.leads where origin_message_id is not null) <> 1 then
    raise exception 'POSITIVE_REPLY_LEAD_MISSING_OR_DUPLICATED';
  end if;
  if exists (select 1 from public.leads where contractual_qualified) then
    raise exception 'REPLY_WAS_FALSELY_COUNTED_AS_CONTRACTUAL_LEAD';
  end if;
  if (select count(*) from public.tasks where task_type = 'REPLY_FOLLOW_UP' and status = 'OPEN') <> 1 then
    raise exception 'REPLY_FOLLOW_UP_TASK_MISSING';
  end if;
  if exists (
    select 1 from public.audit_log
    where coalesce(old_data::text, '') like '%SENTINEL-M4-PRIVATE-BODY%'
       or coalesce(new_data::text, '') like '%SENTINEL-M4-PRIVATE-BODY%'
  ) then raise exception 'AUDIT_LOG_LEAKED_MESSAGE_BODY'; end if;
end;
$$;

set role service_role;

select app.apply_mailbox_provider_event(
  '11111111-1111-4111-8111-111111111111',
  '66666666-6666-4666-8666-666666666666',
  'gmail-event-bounce-001',
  'gmail-bounce-001',
  '82828282-8282-4828-8828-828282828282',
  'HARD_BOUNCE',
  'NOT_APPLICABLE',
  null,
  null,
  null,
  now(),
  '92929292-9292-4929-8929-929292929292'
);

select app.apply_mailbox_provider_event(
  '11111111-1111-4111-8111-111111111111',
  '66666666-6666-4666-8666-666666666666',
  'gmail-event-ambiguous-001',
  'gmail-ambiguous-001',
  '81818181-8181-4818-8818-818181818181',
  'REPLY',
  'UNREVIEWED',
  'nobody@unknown.invalid',
  'Unknown',
  'Do not persist this body',
  now(),
  '93939393-9393-4939-8939-939393939393'
);

reset role;

do $$
begin
  if (select status from public.campaign_enrollments where id = '78787878-7878-4787-8787-787878787878') <> 'BOUNCED' then
    raise exception 'BOUNCE_DID_NOT_STOP_ENROLLMENT';
  end if;
  if not exists (
    select 1 from public.suppression_entries
    where kind = 'HARD_BOUNCE'
      and normalized_email = 'person-b@beta.invalid'
      and account_id is null
      and normalized_domain is null
  ) then raise exception 'BOUNCE_EMAIL_SUPPRESSION_MISSING_OR_OVERBROAD'; end if;
  if (select count(*) from public.provider_events where processing_status = 'QUARANTINED') <> 1 then
    raise exception 'AMBIGUOUS_EVENT_NOT_QUARANTINED';
  end if;
  if (select count(*) from public.dead_letters where reason = 'OUTBOUND_MESSAGE_NOT_RESOLVED') <> 1 then
    raise exception 'AMBIGUOUS_EVENT_DEAD_LETTER_MISSING';
  end if;
end;
$$;

do $$
declare
  lead_id_value uuid;
  opportunity_id_value uuid;
begin
  select id into lead_id_value
  from public.leads
  where origin_message_id is not null;

  begin
    insert into public.leads (
      organization_id, account_id, contact_id, status, contractual_qualified,
      qualification_reason, evidence_class
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      'QUALIFIED', true, 'forged', 'live'
    );
    raise exception 'EXPECTED_STRICT_LEAD_INSERT_REJECTION';
  exception
    when others then
      if sqlerrm <> 'STRICT_LEAD_CREATION_MUST_START_UNQUALIFIED' then raise; end if;
  end;

  begin
    update public.leads
    set status = 'QUALIFIED', contractual_qualified = true
    where id = lead_id_value;
    raise exception 'EXPECTED_STRICT_LEAD_EVIDENCE_REJECTION';
  exception
    when others then
      if sqlerrm <> 'STRICT_LEAD_EVIDENCE_INCOMPLETE' then raise; end if;
  end;

  insert into public.qualification_checks (
    organization_id, lead_id, industrial_over_100_kwp, outside_annex_a,
    verified_target_role, explicit_interest, monthly_spend_mxn, evidence_record_ids
  ) values (
    '11111111-1111-4111-8111-111111111111', lead_id_value, true, true,
    true, true, 25000, array['95959595-9595-4959-8959-959595959595'::uuid]
  );
  update public.leads
  set status = 'QUALIFIED', contractual_qualified = true
  where id = lead_id_value;

  insert into public.opportunities (
    organization_id, account_id, lead_id, stage, economic_buyer, active_pain,
    business_impact, timing_under_90_days, value_mxn, next_action, next_action_at
  ) values (
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    lead_id_value,
    'PROSPECTING', true, true, true, true, 1000000,
    'synthetic technical review', now() + interval '1 day'
  ) returning id into opportunity_id_value;

  begin
    insert into public.opportunities (
      organization_id, account_id, lead_id, stage
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      lead_id_value,
      'QUALIFIED'
    );
    raise exception 'EXPECTED_OPPORTUNITY_INSERT_STAGE_REJECTION';
  exception
    when others then
      if sqlerrm <> 'OPPORTUNITY_CREATION_STAGE_INVALID' then raise; end if;
  end;

  begin
    update public.opportunities set stage = 'QUALIFIED' where id = opportunity_id_value;
    raise exception 'EXPECTED_OPPORTUNITY_STAGE_SKIP_REJECTION';
  exception
    when others then
      if sqlerrm <> 'OPPORTUNITY_STAGE_SKIP_REJECTED' then raise; end if;
  end;

  update public.opportunities set stage = 'CONVERSATION' where id = opportunity_id_value;
  update public.opportunities set stage = 'MEETING_CONFIRMED' where id = opportunity_id_value;

  begin
    insert into public.meetings (
      organization_id, opportunity_id, scheduled_at, held_at, attendance_verified, outcome_notes
    ) values (
      '11111111-1111-4111-8111-111111111111', opportunity_id_value,
      now() - interval '2 hours', now() - interval '1 hour', false, 'synthetic notes'
    );
    raise exception 'EXPECTED_MEETING_EVIDENCE_REJECTION';
  exception
    when others then
      if sqlerrm <> 'MEETING_HELD_REQUIRES_ATTENDANCE_VERIFICATION' then raise; end if;
  end;

  insert into public.meetings (
    organization_id, opportunity_id, scheduled_at, held_at, attendance_verified, outcome_notes
  ) values (
    '11111111-1111-4111-8111-111111111111', opportunity_id_value,
    now() - interval '2 hours', now() - interval '1 hour', true, 'synthetic held meeting verified'
  );
  update public.opportunities set stage = 'DISCOVERY_HELD' where id = opportunity_id_value;
  update public.opportunities set stage = 'QUALIFIED' where id = opportunity_id_value;
end;
$$;

set request.jwt.claim.sub = '98989898-9898-4898-8898-989898989898';
set role authenticated;

do $$
declare
  lead_id_value uuid;
  task_id_value uuid;
  meeting_id_value uuid;
  opportunity_id_value uuid;
begin
  if (select count(*) from public.gmail_push_notifications) <> 1 then
    raise exception 'MEMBER_CANNOT_READ_GMAIL_PUSH_STATUS';
  end if;
  if (select count(*) from public.mailbox_sync_cursors) <> 1 then
    raise exception 'MEMBER_CANNOT_READ_SYNC_CURSOR';
  end if;
  select id into lead_id_value from public.leads where contractual_qualified limit 1;
  perform app.qualify_lead_strict(
    '11111111-1111-4111-8111-111111111111', lead_id_value,
    true, true, true, true, 25000,
    array['95959595-9595-4959-8959-959595959595'::uuid]
  );
  select id into task_id_value from public.tasks where status = 'OPEN' limit 1;
  perform app.complete_operational_task('11111111-1111-4111-8111-111111111111', task_id_value);
  if (select status from public.tasks where id = task_id_value) <> 'DONE' then
    raise exception 'TASK_COMPLETION_RPC_FAILED';
  end if;
  select id, opportunity_id into meeting_id_value, opportunity_id_value from public.meetings limit 1;
  perform app.record_meeting_outcome(
    '11111111-1111-4111-8111-111111111111', meeting_id_value,
    now() - interval '30 minutes', true, 'SENTINEL-M4-MEETING-NOTES'
  );
  perform app.transition_opportunity(
    '11111111-1111-4111-8111-111111111111', opportunity_id_value,
    'TECHNICAL_VISIT', 1000000, 'synthetic technical visit', now() + interval '1 day'
  );
  if exists (
    select 1 from public.audit_log
    where coalesce(old_data::text, '') like '%SENTINEL-M4-MEETING-NOTES%'
       or coalesce(new_data::text, '') like '%SENTINEL-M4-MEETING-NOTES%'
  ) then raise exception 'AUDIT_LOG_LEAKED_MEETING_NOTES'; end if;
  perform app.record_export_run(
    '11111111-1111-4111-8111-111111111111',
    'companies_contacts',
    2,
    repeat('e', 64),
    '94949494-9494-4949-8949-949494949494'
  );
  if (select count(*) from public.export_runs) <> 1 then
    raise exception 'EXPORT_RUN_NOT_RECORDED';
  end if;
  begin
    insert into public.gmail_push_notifications (
      organization_id, mailbox_id, pubsub_message_id, history_id,
      subscription_sha256, published_at, correlation_id
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '66666666-6666-4666-8666-666666666666',
      'forged', '9999', repeat('f', 64), now(), gen_random_uuid()
    );
    raise exception 'EXPECTED_GMAIL_PUSH_DIRECT_WRITE_REJECTION';
  exception
    when insufficient_privilege then null;
  end;
  begin
    insert into public.provider_events (
      organization_id, source, source_record_type, external_event_id,
      payload_json, observed_at, event_kind, reply_classification
    ) values (
      '11111111-1111-4111-8111-111111111111', 'gmail', 'message', 'forged-provider',
      '{"body":"forged"}', now(), 'UNKNOWN', 'UNREVIEWED'
    );
    raise exception 'EXPECTED_PROVIDER_DIRECT_WRITE_REJECTION';
  exception
    when insufficient_privilege then null;
  end;
  begin
    update public.messages set body_text = 'forged-body' where id = '88888888-8888-4888-8888-888888888888';
    raise exception 'EXPECTED_MESSAGE_DIRECT_WRITE_REJECTION';
  exception
    when insufficient_privilege then null;
  end;
  begin
    insert into public.export_runs (
      organization_id, requested_by, dataset, row_count, sha256, correlation_id
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '98989898-9898-4898-8898-989898989898',
      'companies_contacts', 99, repeat('f', 64), gen_random_uuid()
    );
    raise exception 'EXPECTED_EXPORT_DIRECT_WRITE_REJECTION';
  exception
    when insufficient_privilege then null;
  end;
  begin
    perform app.apply_mailbox_provider_event(
      '11111111-1111-4111-8111-111111111111',
      '66666666-6666-4666-8666-666666666666',
      'forged-event', 'forged-message',
      '88888888-8888-4888-8888-888888888888',
      'DELIVERY', 'NOT_APPLICABLE', null, null, null, now(), gen_random_uuid()
    );
    raise exception 'EXPECTED_PROVIDER_APPLY_PERMISSION_REJECTION';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;
reset request.jwt.claim.sub;

set request.jwt.claim.sub = '97979797-9797-4797-8797-979797979797';
set role authenticated;

do $$
begin
  if exists (select 1 from public.gmail_push_notifications) then
    raise exception 'CROSS_TENANT_GMAIL_PUSH_VISIBLE';
  end if;
  if exists (select 1 from public.mailbox_sync_cursors) then
    raise exception 'CROSS_TENANT_SYNC_CURSOR_VISIBLE';
  end if;
  if exists (select 1 from public.export_runs) then
    raise exception 'CROSS_TENANT_EXPORT_RUN_VISIBLE';
  end if;
end;
$$;

reset role;
reset request.jwt.claim.sub;

do $$
begin
  if exists (
    select 1 from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated')
      and table_schema = 'app'
      and table_name = 'private_runtime_config'
  ) then raise exception 'PRIVATE_RUNTIME_CONFIG_GRANT_LEAK'; end if;
end;
$$;

select 'GMAIL_OPERATIONS_GATE_PASS' as result;
