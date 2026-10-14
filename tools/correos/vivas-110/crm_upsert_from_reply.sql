CREATE OR REPLACE FUNCTION app.crm_upsert_from_reply(target_org uuid, target_event uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare e public.provider_events%rowtype; m public.messages%rowtype; ct public.contacts%rowtype;
  a public.accounts%rowtype; campaign_name text; campaign_lane text; sc public.email_sdr_cases%rowtype;
  intent text; subtype text; positive boolean; reason text; rec public.crm_records%rowtype;
  received timestamptz; owner uuid; touch integer;
begin
  select * into e from public.provider_events where organization_id = target_org and id = target_event and event_kind = 'REPLY';
  if not found then return null; end if;
  select * into m from public.messages where organization_id = target_org and id = e.message_id and direction = 'INBOUND';
  if not found or m.contact_id is null then return null; end if;
  select ca.name, ca.lane into campaign_name, campaign_lane from public.campaign_enrollments ce
    join public.campaigns ca on ca.organization_id = ce.organization_id and ca.id = ce.campaign_id
    where ce.organization_id = target_org and ce.id = m.enrollment_id;
  if campaign_lane is distinct from 'DIRECT' or campaign_name ~* '^PRUEBA' then return null; end if;
  select * into ct from public.contacts where organization_id = target_org and id = m.contact_id;
  select * into a from public.accounts where organization_id = target_org and id = ct.account_id;
  select * into sc from public.email_sdr_cases where organization_id = target_org and provider_event_id = e.id;
  select o.touch_number into touch from public.messages o
    where o.organization_id = target_org and o.id = (e.payload_json->>'related_outbound_message_id')::uuid;
  intent := sc.decision->>'intent';
  subtype := sc.decision->>'subtype';
  positive := subtype in ('POSITIVE_ACCEPT','POSITIVE_VISIT') or e.reply_classification = 'POSITIVE';
  reason := case
    when positive then null
    when sc.state = 'SUPPRESSED' or intent = 'UNSUBSCRIBE' then 'Pidió baja'
    when intent = 'REJECTION' then 'No le interesa'
    when intent = 'NOT_NOW' then 'Ahora no'
    when intent = 'WRONG_PERSON' then 'Persona equivocada o ya no está'
    when intent = 'COMPLAINT' then 'Queja'
    when intent = 'OUT_OF_OFFICE' then 'Fuera de la oficina'
    when e.reply_classification = 'NEGATIVE' then 'Respuesta negativa'
  end;
  received := coalesce(e.observed_at, m.created_at);
  select * into rec from public.crm_records where organization_id = target_org and contact_id = ct.id for update;
  if rec.id is null then
    select default_owner_user_id into owner from app.crm_settings where organization_id = target_org;
    insert into public.crm_records (organization_id, contact_id, account_id, source, full_name, email, phone, role_title,
      company_name, city, state, stage, owner_user_id, close_reason, reply_intent, last_reply_event_id, first_reply_at, last_reply_at)
    values (target_org, ct.id, a.id, 'CORREO', coalesce(nullif(btrim(ct.full_name), ''), ct.normalized_email), ct.normalized_email,
      ct.phone_e164, ct.role_title, a.legal_name, a.city, a.state, case when reason is null then 'RESPONDIO' else 'DESCARTADO' end,
      owner, reason, coalesce(subtype, intent), e.id, received, received)
    on conflict do nothing
    returning * into rec;
    if rec.id is null then return null; end if;
    perform app.crm_log(target_org, rec.id, 'SISTEMA',
      'Entró al CRM: respondió al correo' || coalesce(' (toque ' || touch || ')', '') ||
      case when reason is null then '.' else '. Descartado: ' || reason || '.' end,
      jsonb_build_object('provider_event_id', e.id, 'intent', coalesce(subtype, intent)), null);
    return rec.id;
  end if;
  update public.crm_records set
    last_reply_at = greatest(coalesce(last_reply_at, received), received),
    first_reply_at = least(coalesce(first_reply_at, received), received),
    last_reply_event_id = case when received >= coalesce(last_reply_at, '-infinity'::timestamptz) then e.id else last_reply_event_id end,
    reply_intent = case when received >= coalesce(last_reply_at, '-infinity'::timestamptz) then coalesce(subtype, intent, reply_intent) else reply_intent end,
    updated_at = clock_timestamp()
  where id = rec.id;
  if rec.stage = 'DESCARTADO' and positive then
    update public.crm_records set stage = 'RESPONDIO', close_reason = null, revision = revision + 1, updated_at = clock_timestamp() where id = rec.id;
    perform app.crm_log(target_org, rec.id, 'CAMBIO_ETAPA', 'Volvió a responder con interés.',
      jsonb_build_object('de', 'DESCARTADO', 'a', 'RESPONDIO'), null);
  elsif rec.stage = 'RESPONDIO' and reason is not null and rec.last_reply_event_id = e.id
    and not exists (select 1 from public.crm_activities x where x.record_id = rec.id and x.actor_user_id is not null) then
    -- El SDR terminó de clasificar como negativa la misma respuesta y nadie la ha tocado.
    update public.crm_records set stage = 'DESCARTADO', close_reason = reason, revision = revision + 1, updated_at = clock_timestamp() where id = rec.id;
    perform app.crm_log(target_org, rec.id, 'CAMBIO_ETAPA', 'Descartado: ' || reason || '.',
      jsonb_build_object('de', 'RESPONDIO', 'a', 'DESCARTADO'), null);
  end if;
  return rec.id;
end $function$

