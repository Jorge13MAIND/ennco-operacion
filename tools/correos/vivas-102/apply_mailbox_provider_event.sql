CREATE OR REPLACE FUNCTION app.apply_mailbox_provider_event(target_organization_id uuid, target_mailbox_id uuid, target_external_event_id text, target_provider_message_id text, target_related_outbound_message_id uuid, target_event_kind provider_event_kind, target_reply_classification reply_classification, target_normalized_from text, target_subject text, target_body_text text, target_observed_at timestamp with time zone, target_correlation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare
  outbound_record public.messages%rowtype;
  enrollment_record public.campaign_enrollments%rowtype;
  contact_record public.contacts%rowtype;
  existing_event public.provider_events%rowtype;
  provider_event_id uuid := gen_random_uuid();
  inbound_message_id uuid;
  created_lead_id uuid;
  created_task_id uuid;
  processing_result text := 'PROCESSED';
begin
  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || ':gmail-event:' || coalesce(target_external_event_id, ''),
    0
  ));

  if target_organization_id is null
    or target_mailbox_id is null
    or target_external_event_id is null
    or length(target_external_event_id) not between 1 and 512
    or target_provider_message_id is null
    or length(target_provider_message_id) not between 1 and 512
    or target_event_kind is null
    or target_reply_classification is null
    or target_observed_at is null
    or target_correlation_id is null
    or (target_event_kind = 'REPLY' and target_reply_classification <> 'UNREVIEWED')
    or (target_event_kind <> 'REPLY' and target_reply_classification <> 'NOT_APPLICABLE')
  then
    raise exception 'PROVIDER_EVENT_INVALID';
  end if;

  select * into existing_event
  from public.provider_events
  where organization_id = target_organization_id
    and source = 'gmail'
    and source_record_type = 'message'
    and external_event_id = target_external_event_id;
  if found then
    return jsonb_build_object(
      'status', 'DUPLICATE',
      'provider_event_id', existing_event.id,
      'message_id', existing_event.message_id
    );
  end if;

  select * into outbound_record
  from public.messages
  where organization_id = target_organization_id
    and id = target_related_outbound_message_id
    and mailbox_id = target_mailbox_id
    and direction = 'OUTBOUND'
  for update;

  if not found then
    insert into public.provider_events (
      id, organization_id, source, source_record_type, external_event_id,
      payload_json, observed_at, event_kind, reply_classification,
      correlation_id, processing_status
    ) values (
      provider_event_id, target_organization_id, 'gmail', 'message', target_external_event_id,
      jsonb_build_object('provider_message_id_sha256', encode(digest(target_provider_message_id, 'sha256'), 'hex')),
      target_observed_at, target_event_kind, target_reply_classification,
      target_correlation_id, 'QUARANTINED'
    );
    insert into public.dead_letters (
      organization_id, source_table, source_id, reason, payload_json
    ) values (
      target_organization_id, 'provider_events', provider_event_id,
      'OUTBOUND_MESSAGE_NOT_RESOLVED',
      jsonb_build_object('provider_event_id', provider_event_id, 'correlation_id', target_correlation_id)
    );
    return jsonb_build_object('status', 'QUARANTINED', 'provider_event_id', provider_event_id);
  end if;

  select * into enrollment_record
  from public.campaign_enrollments
  where organization_id = target_organization_id
    and id = outbound_record.enrollment_id
  for update;
  if not found then raise exception 'PROVIDER_EVENT_ENROLLMENT_NOT_FOUND'; end if;

  select * into contact_record
  from public.contacts
  where organization_id = target_organization_id
    and id = enrollment_record.contact_id;
  if not found then raise exception 'PROVIDER_EVENT_CONTACT_NOT_FOUND'; end if;

  if target_event_kind in ('REPLY', 'AUTO_REPLY', 'UNSUBSCRIBE') then
    if target_normalized_from is null
      or lower(target_normalized_from) <> contact_record.normalized_email
      or octet_length(coalesce(target_subject, '')) > 1000
      or octet_length(coalesce(target_body_text, '')) > 100000
    then
      raise exception 'PROVIDER_EVENT_MESSAGE_INVALID';
    end if;

    insert into public.messages (
      organization_id, enrollment_id, mailbox_id, contact_id, direction, status,
      normalized_to, normalized_from, subject, body_text, idempotency_key,
      provider_message_id, correlation_id, sent_at
    ) values (
      target_organization_id, enrollment_record.id, target_mailbox_id, contact_record.id,
      'INBOUND', 'DELIVERED', outbound_record.normalized_from, lower(target_normalized_from),
      target_subject, target_body_text, 'gmail-inbound:' || target_external_event_id,
      target_provider_message_id, target_correlation_id, target_observed_at
    ) returning id into inbound_message_id;
  end if;

  if target_event_kind = 'DELIVERY' then
    update public.messages
    set status = 'DELIVERED', updated_at = now()
    where id = outbound_record.id and status in ('QUEUED', 'SENDING', 'SENT');
  elsif target_event_kind = 'HARD_BOUNCE' then
    update public.messages set status = 'BOUNCED', updated_at = now() where id = outbound_record.id;
    update public.campaign_enrollments
    set status = 'BOUNCED', stopped_reason = 'HARD_BOUNCE', next_touch_at = null, updated_at = now()
    where id = enrollment_record.id;
    insert into public.suppression_entries (
      organization_id, kind, account_id, normalized_email, normalized_domain, reason
    ) values (
      target_organization_id, 'HARD_BOUNCE', null,
      contact_record.normalized_email, null,
      'GMAIL_HARD_BOUNCE'
    ) on conflict do nothing;
  elsif target_event_kind = 'UNSUBSCRIBE' then
    update public.campaign_enrollments
    set status = 'UNSUBSCRIBED', stopped_reason = 'UNSUBSCRIBE', next_touch_at = null, updated_at = now()
    where id = enrollment_record.id;
    insert into public.suppression_entries (
      organization_id, kind, account_id, normalized_email, normalized_domain, reason
    ) values (
      target_organization_id, 'UNSUBSCRIBE', null,
      contact_record.normalized_email, null,
      'GMAIL_UNSUBSCRIBE'
    ) on conflict do nothing;
  elsif target_event_kind = 'AUTO_REPLY' then
    update public.campaign_enrollments
    set status = 'PAUSED', stopped_reason = 'AUTO_REPLY_REVIEW', next_touch_at = null, updated_at = now()
    where id = enrollment_record.id;
    insert into public.tasks (
      organization_id, account_id, contact_id, task_type, normalized_objective, due_at
    ) values (
      target_organization_id, enrollment_record.account_id, contact_record.id,
      'REPLY_REVIEW', 'review automatic reply before resuming sequence', now() + interval '1 day'
    ) on conflict do nothing returning id into created_task_id;
  elsif target_event_kind = 'REPLY' then
    update public.campaign_enrollments
    set status = 'REPLIED', stopped_reason = 'HUMAN_REPLY', next_touch_at = null, updated_at = now()
    where id = enrollment_record.id;

    insert into public.tasks (
      organization_id, account_id, contact_id, task_type, normalized_objective, due_at
    ) values (
      target_organization_id, enrollment_record.account_id, contact_record.id,
      'REPLY_FOLLOW_UP', 'review human reply and record next action', now() + interval '4 hours'
    ) on conflict do nothing returning id into created_task_id;
  elsif target_event_kind = 'UNKNOWN' then
    processing_result := 'QUARANTINED';
  end if;

  insert into public.provider_events (
    id, organization_id, source, source_record_type, external_event_id, message_id,
    payload_json, observed_at, processed_at, event_kind, reply_classification,
    correlation_id, processing_status
  ) values (
    provider_event_id, target_organization_id, 'gmail', 'message', target_external_event_id,
    coalesce(inbound_message_id, outbound_record.id),
    jsonb_build_object(
      'related_outbound_message_id', outbound_record.id,
      'provider_message_id_sha256', encode(digest(target_provider_message_id, 'sha256'), 'hex')
    ),
    target_observed_at,
    case when processing_result = 'PROCESSED' then now() else null end,
    target_event_kind, target_reply_classification, target_correlation_id, processing_result
  );

  if processing_result = 'QUARANTINED' then
    insert into public.dead_letters (
      organization_id, source_table, source_id, reason, payload_json
    ) values (
      target_organization_id, 'provider_events', provider_event_id, 'UNKNOWN_PROVIDER_EVENT_KIND',
      jsonb_build_object('provider_event_id', provider_event_id, 'correlation_id', target_correlation_id)
    );
  else
    insert into public.event_outbox (
      organization_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload_json
    ) values (
      target_organization_id,
      'provider_event',
      provider_event_id,
      'gmail.' || lower(target_event_kind::text),
      'gmail-event:' || target_external_event_id,
      jsonb_build_object(
        'provider_event_id', provider_event_id,
        'event_kind', target_event_kind,
        'message_id', coalesce(inbound_message_id, outbound_record.id),
        'lead_id', created_lead_id,
        'task_id', created_task_id,
        'correlation_id', target_correlation_id
      )
    );
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'status', processing_result,
    'provider_event_id', provider_event_id,
    'message_id', coalesce(inbound_message_id, outbound_record.id),
    'lead_id', created_lead_id,
    'task_id', created_task_id
  ));
end;
$function$
