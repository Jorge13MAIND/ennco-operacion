-- 102 · Reactivar la v4 (6-oct-2026). Generado por tools/correos/gen-102.py desde tools/correos/vivas-102/.
-- Ver el docstring del generador. Reversa de la pausa: update public.campaigns set new_contacts_paused=true
-- where lane='DIRECT' and direct_lane_state='RUNNING';

begin;

set local app.operations_rpc_write = 'on';

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

    -- Una baja que llega por el SDR trae el mismo mensaje que ya se guardó como respuesta: se reutiliza.
    select id into inbound_message_id from public.messages
      where organization_id = target_organization_id and provider_message_id = target_provider_message_id
        and direction = 'INBOUND' limit 1;
    if inbound_message_id is null then
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
$function$;

CREATE OR REPLACE FUNCTION app.email_sdr_alert_work(target_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare row_value record; stage_value text; claimed integer; pending jsonb:='[]'::jsonb; oldest_seconds integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('email-sdr-alerts:'||target_org::text,0));
  select max(extract(epoch from clock_timestamp()-n.created_at))::integer into oldest_seconds
    from public.email_sdr_cases c join public.event_outbox o
      on o.organization_id=c.organization_id and o.aggregate_id=c.provider_event_id
      and o.event_type in ('gmail.reply','gmail.auto_reply')
    join public.notification_deliveries n on n.organization_id=o.organization_id and n.outbox_event_id=o.id
    where c.organization_id=target_org and n.channel='CONTROL_ROOM' and n.status<>'DELIVERED'
      and not (c.state='READY' and c.send_after>clock_timestamp());
  -- 6-oct (Grant): un aviso sin confirmar ya no pausa los contactos nuevos; solo se escala.
  for row_value in
    select c.id,min(n.created_at) as pending_since,
      max(case when a.status='ACTIVE' and a.coverage_mode='PRIMARY_BACKUP' and ou.active
        then a.backup_user_id::text else null end) as backup_user_id,
      max(owner_user.email) as owner_email,
      max(case when a.status='ACTIVE' and a.coverage_mode='PRIMARY_BACKUP' and ou.active
        then backup_user.email else null end) as backup_email
    from public.email_sdr_cases c join public.event_outbox o
      on o.organization_id=c.organization_id and o.aggregate_id=c.provider_event_id
      and o.event_type in ('gmail.reply','gmail.auto_reply')
    join public.notification_deliveries n on n.organization_id=o.organization_id and n.outbox_event_id=o.id
    left join public.operational_assignments a on a.organization_id=c.organization_id
    left join public.organization_users ou on ou.organization_id=a.organization_id and ou.user_id=a.backup_user_id
    left join auth.users owner_user on owner_user.id=c.owner_user_id
    left join auth.users backup_user on backup_user.id=a.backup_user_id
    where c.organization_id=target_org and n.channel='CONTROL_ROOM' and n.status<>'DELIVERED'
      and n.created_at<=clock_timestamp()-interval '15 minutes'
      and not (c.state='READY' and c.send_after>clock_timestamp())
    group by c.id order by min(n.created_at) limit 10
  loop
    stage_value:=case
      when row_value.pending_since<=clock_timestamp()-interval '2 hours' then 'OVERDUE'
      when row_value.pending_since<=clock_timestamp()-interval '30 minutes' and row_value.backup_user_id is not null then 'BACKUP'
      when row_value.pending_since<=clock_timestamp()-interval '30 minutes' then 'NO_BACKUP'
      else 'PRIMARY' end;
    claimed:=null;
    insert into app.email_sdr_alert_dispatch(organization_id,case_id,stage,attempts,last_attempt_at)
      values(target_org,row_value.id,stage_value,1,clock_timestamp())
      on conflict(organization_id,case_id,stage) do update set
        attempts=app.email_sdr_alert_dispatch.attempts+1,last_attempt_at=clock_timestamp()
      where app.email_sdr_alert_dispatch.provider_accepted_at is null
        and app.email_sdr_alert_dispatch.uncertain_at is null
        and app.email_sdr_alert_dispatch.attempts<100
        and app.email_sdr_alert_dispatch.last_attempt_at<clock_timestamp()-interval '5 minutes'
      returning attempts into claimed;
    if claimed is not null then
      pending:=pending||jsonb_build_array(jsonb_build_object('case_id',row_value.id,'stage',stage_value,
        'pending_minutes',floor(extract(epoch from clock_timestamp()-row_value.pending_since)/60)::integer,
        'backup_configured',row_value.backup_user_id is not null,
        'owner_email',row_value.owner_email,'backup_email',row_value.backup_email));
    end if;
    claimed:=null;
  end loop;
  return jsonb_build_object('status','ALERT_WORK','alerts',pending,
    'oldest_pending_minutes',coalesce(oldest_seconds/60,0));
end $function$;

update public.campaigns set new_contacts_paused = false, updated_at = clock_timestamp()
where organization_id = 'e0000000-0000-4000-8000-000000000001' and lane = 'DIRECT' and direct_lane_state = 'RUNNING';

insert into public.audit_log(organization_id, actor_user_id, action, record_type, record_id, new_data)
values ('e0000000-0000-4000-8000-000000000001', '614db7d9-f70b-4f8b-b0e2-d5c0190a06b3', 'DIRECT_LANE_NEW_CONTACTS_RESUMED', 'organizations', 'e0000000-0000-4000-8000-000000000001',
  jsonb_build_object('source','migración 102','unacknowledged_alert_pause','removed','email_unsubscribe','fixed',
    'order','Grant 6-oct: reactivar como estaba, misma v4, 180 por buzón de dominio y 50 en contacto@'));

commit;
