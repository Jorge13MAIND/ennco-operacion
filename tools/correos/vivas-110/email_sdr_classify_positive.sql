CREATE OR REPLACE FUNCTION app.email_sdr_classify_positive(target_org uuid, target_case uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_temp'
AS $function$
declare c public.email_sdr_cases%rowtype; e public.provider_events%rowtype; m public.messages%rowtype;
  ce public.campaign_enrollments%rowtype; lead_value uuid; classified integer;
begin
  select * into c from public.email_sdr_cases where organization_id = target_org and id = target_case;
  select * into e from public.provider_events where organization_id = target_org and id = c.provider_event_id;
  select * into m from public.messages where organization_id = target_org and id = e.message_id and direction = 'INBOUND';
  select * into ce from public.campaign_enrollments where organization_id = target_org and id = m.enrollment_id;
  if c.id is null or e.event_kind <> 'REPLY' or m.id is null or ce.id is null then return; end if;
  update public.provider_events set reply_classification = 'POSITIVE' where id = e.id and reply_classification = 'UNREVIEWED';
  get diagnostics classified = row_count;
  insert into public.leads (organization_id, account_id, contact_id, origin_message_id, status, contractual_qualified, qualification_reason, evidence_class)
  values (target_org, ce.account_id, m.contact_id, m.id, 'CAPTURED', false, 'PENDING_STRICT_HUMAN_QUALIFICATION', 'live')
  on conflict (organization_id, origin_message_id) do nothing returning id into lead_value;
  if lead_value is null then select id into lead_value from public.leads where organization_id = target_org and origin_message_id = m.id; end if;
  insert into public.event_outbox (organization_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload_json)
  values (target_org, 'provider_event', e.id, 'reply.reviewed', 'reply-reviewed:' || e.id::text,
    jsonb_build_object('provider_event_id', e.id, 'classification', 'POSITIVE', 'lead_id', lead_value, 'reviewed_by', null, 'source', 'email-sdr-rules'))
  on conflict (organization_id, idempotency_key) do nothing;
  if lead_value is not null and not exists (select 1 from public.opportunities o where o.organization_id = target_org and o.lead_id = lead_value) then
    insert into public.opportunities (organization_id, account_id, lead_id, stage, next_action, next_action_at, creation_idempotency_key)
    values (target_org, ce.account_id, lead_value, 'CONVERSATION',
      'Respuesta positiva. Sale correo automático con copia a Paco; Paco coordina desde su correo',
      clock_timestamp() + interval '1 day', encode(digest('email-sdr-opportunity:' || lead_value::text, 'sha256'), 'hex'));
  end if;
  if classified > 0 then
    insert into public.audit_log (organization_id, action, record_type, record_id, new_data)
    values (target_org, 'EMAIL_SDR_POSITIVE_CLASSIFIED', 'email_sdr_cases', c.id,
      jsonb_build_object('lead_id', lead_value, 'subtype', c.decision->>'subtype', 'source', 'email-sdr-rules'));
  end if;
end $function$

