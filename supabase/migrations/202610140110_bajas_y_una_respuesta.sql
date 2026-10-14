-- 110 · Bajas y rechazos firmes fuera del CRM, una sola respuesta automática por persona (14-oct-2026).
-- Generado por tools/correos/gen-110.py desde tools/correos/vivas-110/. Ver el docstring del generador.

begin;

set local app.operations_rpc_write = 'on';

alter table public.crm_records add column if not exists excluded_at timestamptz;
alter table public.crm_records add column if not exists excluded_reason text check (excluded_reason is null or length(excluded_reason) <= 300);

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
  -- 14-oct (Grant): quien pide baja o rechaza en firme no aparece en el CRM.
  if sc.state = 'SUPPRESSED' or intent in ('UNSUBSCRIBE', 'REJECTION', 'COMPLAINT')
    or app.is_suppressed(target_org, ct.account_id, ct.normalized_email, split_part(ct.normalized_email, '@', 2)) then
    if rec.id is not null and rec.excluded_at is null then
      update public.crm_records set excluded_at = clock_timestamp(), excluded_reason = coalesce(reason, 'Pidió baja'),
        updated_at = clock_timestamp() where id = rec.id;
    end if;
    return null;
  end if;
  if rec.excluded_at is not null then return rec.id; end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.read_crm(target_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'CRM_ACCESS_DENIED'; end if;
  return jsonb_build_object(
    'records', coalesce((select jsonb_agg(app.crm_record_json(r) order by coalesce(r.last_reply_at, r.created_at) desc)
      from public.crm_records r where r.organization_id = target_organization_id and r.excluded_at is null), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(jsonb_build_object('id', ou.user_id, 'email', u.email, 'role', ou.role) order by u.email)
      from public.organization_users ou join auth.users u on u.id = ou.user_id
      where ou.organization_id = target_organization_id and ou.active), '[]'::jsonb),
    'default_owner_user_id', (select s.default_owner_user_id from app.crm_settings s where s.organization_id = target_organization_id),
    'generated_at', clock_timestamp());
end $function$;

CREATE OR REPLACE FUNCTION app.crm_reminders_work(target_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare items jsonb := '[]'::jsonb; local_now timestamp := clock_timestamp() at time zone 'America/Mexico_City'; row_value record;
begin
  perform pg_advisory_xact_lock(hashtextextended('crm-reminders:' || target_org::text, 0));
  if not coalesce((select reminders_enabled from app.crm_settings where organization_id = target_org), false)
    or extract(isodow from local_now) > 5 or local_now::time < time '08:00' or local_now::time >= time '19:00' then
    return jsonb_build_object('status', 'CRM_REMINDERS', 'items', items, 'chat_ids', '[]'::jsonb);
  end if;
  for row_value in
    select 'TAREA' kind, t.id, t.title what, t.due_at due, r.id record_id from public.crm_tasks t
      join public.crm_records r on r.id = t.record_id
      where t.organization_id = target_org and t.status = 'PENDIENTE' and t.due_at <= clock_timestamp() and t.reminded_at is null
    union all
    select 'SIGUIENTE', r.id, r.next_action, r.next_action_at, r.id from public.crm_records r
      where r.organization_id = target_org and r.excluded_at is null and r.stage not in ('GANADO', 'PERDIDO', 'DESCARTADO')
        and r.next_action_at <= clock_timestamp() and r.reminded_at is null and nullif(btrim(r.next_action), '') is not null
    order by 4 limit 20
  loop
    if row_value.kind = 'TAREA' then update public.crm_tasks set reminded_at = clock_timestamp() where id = row_value.id;
    else update public.crm_records set reminded_at = clock_timestamp() where id = row_value.id; end if;
    items := items || jsonb_build_array(jsonb_build_object('kind', row_value.kind, 'id', row_value.id, 'what', row_value.what,
      'due_at', row_value.due, 'record', (select app.crm_record_json(r) - 'last_reply_body' from public.crm_records r where r.id = row_value.record_id)));
  end loop;
  return jsonb_build_object('status', 'CRM_REMINDERS', 'items', items,
    'chat_ids', (select to_jsonb(s.telegram_chat_ids) from app.email_sdr_settings s where s.organization_id = target_org));
end $function$;

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
  -- 14-oct: quien pidió baja o rechazó nunca se vuelve lead positivo.
  if exists (select 1 from public.contacts ct where ct.organization_id = target_org and ct.id = m.contact_id
      and app.is_suppressed(target_org, ct.account_id, ct.normalized_email, split_part(ct.normalized_email, '@', 2))) then return; end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.email_sdr_command(target_organization_id uuid, target_payload text, proof_command_id text, proof_nonce uuid, proof_expires_at timestamp with time zone, proof_signature text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_temp'
AS $function$
declare cfg app.email_sdr_settings%rowtype; sha text; signature text; p jsonb; op text; c public.email_sdr_cases%rowtype;
  e public.provider_events%rowtype; inbound public.messages%rowtype; enrollment public.campaign_enrollments%rowtype;
  mailbox public.mailboxes%rowtype; contact public.contacts%rowtype; campaign public.campaigns%rowtype; account public.accounts%rowtype;
  result jsonb; work jsonb:='[]'; message_id_value uuid; body_value text; intent text; next_due timestamptz;
  reviewed_count integer; model_calls integer; work_count integer:=0; followup boolean; row_value record;
begin
  select * into cfg from app.email_sdr_settings where organization_id=target_organization_id;
  if cfg.service_secret is null or proof_nonce is null or proof_signature is null or proof_expires_at is null
    or proof_command_id is distinct from 'email_sdr_command:'||proof_nonce::text
    or proof_expires_at<=clock_timestamp() or proof_expires_at>clock_timestamp()+interval '5 minutes'
    or target_payload is null or octet_length(target_payload)>50000 then raise exception 'SDR_UNAUTHORIZED'; end if;
  sha:=encode(digest(convert_to(concat_ws(E'\n','email_sdr_command',target_organization_id::text,
    encode(digest(convert_to(target_payload,'utf8'),'sha256'),'hex')),'utf8'),'sha256'),'hex');
  signature:=encode(app.hmac(convert_to(concat_ws(E'\n',target_organization_id::text,proof_command_id,proof_nonce::text,
    to_char(proof_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),sha),'utf8'),convert_to(cfg.service_secret,'utf8'),'sha256'),'hex');
  if digest(proof_signature,'sha256')<>digest(signature,'sha256') then raise exception 'SDR_UNAUTHORIZED'; end if;
  insert into app.email_sdr_nonces values(target_organization_id,proof_nonce,proof_expires_at);
  delete from app.email_sdr_nonces where organization_id=target_organization_id and expires_at<clock_timestamp()-interval '1 day';
  p:=target_payload::jsonb; op:=p->>'op';
  if op='ALERT_WORK' then
    return app.email_sdr_alert_work(target_organization_id);
  elsif op='CRM_REMINDERS_WORK' then
    return app.crm_reminders_work(target_organization_id);
  elsif op='CRM_REMINDERS_SETTLE' then
    return app.crm_reminders_settle(target_organization_id,p->>'kind',(p->>'id')::uuid,(p->>'delivered')::boolean);
  elsif op='TELEGRAM_WORK' then
    return app.email_sdr_telegram_work(target_organization_id);
  elsif op='TELEGRAM_SETTLE' then
    return app.email_sdr_telegram_settle(target_organization_id,(p->>'case_id')::uuid,p->>'chat_id',
      (p->>'delivered')::boolean,p->>'error');
  elsif op='ALERT_SETTLE' then
    return app.email_sdr_alert_settle(target_organization_id,(p->>'case_id')::uuid,
      p->>'stage',(p->>'accepted')::boolean);
  end if;
  if op='WORK' then
    -- Only configured commercial campaigns. Internal tests never enter the queue.
    insert into public.email_sdr_cases(organization_id,provider_event_id,owner_user_id,policy_version)
    select pe.organization_id,pe.id,a.primary_user_id,cfg.policy_version from public.provider_events pe
      join public.messages m on m.organization_id=pe.organization_id and m.id=pe.message_id
      join public.campaign_enrollments ce on ce.organization_id=m.organization_id and ce.id=m.enrollment_id
      join public.campaigns ca on ca.organization_id=ce.organization_id and ca.id=ce.campaign_id
      left join public.operational_assignments a on a.organization_id=pe.organization_id and a.status='ACTIVE'
      where pe.organization_id=target_organization_id and pe.event_kind in ('REPLY','AUTO_REPLY') and m.direction='INBOUND'
        and not (pe.payload_json ? 'auto_handled')
        and ca.id=any(cfg.campaign_ids) and ca.name !~* '^PRUEBA'
      on conflict(organization_id,provider_event_id) do nothing;
    -- Reconcile the existing sender's receipts; never treat QUEUED as SENT.
    for row_value in select sc.id,m.status,m.sent_at,m.provider_message_id,sc.decision->>'subtype' as subtype from public.email_sdr_cases sc
      join public.messages m on m.organization_id=sc.organization_id and m.id=sc.message_id
      where sc.organization_id=target_organization_id and sc.state='QUEUED' and m.status in ('SENT','DELIVERED','FAILED','QUARANTINED')
    loop
      if row_value.status in ('SENT','DELIVERED') and row_value.provider_message_id is not null then
        update public.email_sdr_cases set state='SENT',initial_sent_at=coalesce(initial_sent_at,row_value.sent_at),
          next_due_at=case when row_value.subtype in ('POSITIVE_ACCEPT','POSITIVE_VISIT') then null when followups_sent<2 then app.email_sdr_followup_due(target_organization_id,coalesce(initial_sent_at,row_value.sent_at),case when followups_sent=0 then 3 else 7 end) else null end,
          next_action=case when row_value.subtype in ('POSITIVE_ACCEPT','POSITIVE_VISIT') then 'Respondida automáticamente con copia a Paco y Oscar. Oscar coordina los detalles'
            when followups_sent<2 then 'Seguimiento por email sujeto a revisión de conversación y calendario' else 'Seguimiento concluido' end,updated_at=clock_timestamp()
          where id=row_value.id;
        if row_value.subtype in ('POSITIVE_ACCEPT','POSITIVE_VISIT') then perform app.email_sdr_mark_positive(target_organization_id,row_value.id); end if;
      else
        update public.email_sdr_cases set state='BLOCKED',next_action='Reconciliar resultado de envío. No reintentar',updated_at=clock_timestamp() where id=row_value.id;
      end if;
    end loop;
    for c in select * from public.email_sdr_cases sc where sc.organization_id=target_organization_id
      and ((sc.state='READY' and coalesce(sc.send_after,'-infinity'::timestamptz)<=clock_timestamp()) or (sc.state='SENT' and sc.next_due_at<=clock_timestamp() and sc.followups_sent<2))
      and coalesce(sc.lease_until,'epoch')<clock_timestamp() order by sc.created_at limit 10 for update skip locked
    loop
      update public.email_sdr_cases set lease_until=clock_timestamp()+interval '4 minutes' where id=c.id;
      select * into e from public.provider_events where id=c.provider_event_id and organization_id=target_organization_id;
      select * into inbound from public.messages where id=e.message_id and organization_id=target_organization_id;
      select * into enrollment from public.campaign_enrollments where id=inbound.enrollment_id and organization_id=target_organization_id;
      select * into contact from public.contacts where id=inbound.contact_id and organization_id=target_organization_id;
      select * into account from public.accounts where id=contact.account_id and organization_id=target_organization_id;
      select * into campaign from public.campaigns where id=enrollment.campaign_id and organization_id=target_organization_id;
      select * into mailbox from public.mailboxes where id=inbound.mailbox_id and organization_id=target_organization_id;
      work:=work||jsonb_build_array(jsonb_build_object('case_id',c.id,'event_id',e.id,'event_kind',e.event_kind,'body',inbound.body_text,
        'mailbox_id',inbound.mailbox_id,'mailbox_email',mailbox.normalized_email,'contact_email',contact.normalized_email,'owner_id',c.owner_user_id,
        'campaign_id',campaign.id,'campaign_name',campaign.name,'offer_id',campaign.manifest_json->>'offer_id',
        'account_name',account.legal_name,'contact_role',contact.role_title,
        'plant_state',(select cl.plant_state from public.email_contact_clearances cl where cl.organization_id=target_organization_id and cl.contact_id=contact.id and cl.decision='READY' and cl.expires_at>clock_timestamp()),
        'provider_message_id',inbound.provider_message_id,'provider_thread_id',inbound.provider_thread_id,'related_outbound_id',e.payload_json->>'related_outbound_message_id',
        'suppressed',app.is_suppressed(target_organization_id,contact.account_id,contact.normalized_email,split_part(contact.normalized_email,'@',2)),
        'followup',c.state='SENT','followups_sent',c.followups_sent,'approved',c.approved,'decision',c.decision,
        'own_sdr_message_ids',coalesce((select jsonb_agg(m.provider_message_id) from public.messages m where m.organization_id=target_organization_id and m.reply_to_provider_event_id=e.id and m.idempotency_key like 'email-sdr:%' and m.provider_message_id is not null),'[]'::jsonb)));
      work_count:=work_count+1;
    end loop;
    return jsonb_build_object('status','WORK','mode',cfg.mode,'policy_version',cfg.policy_version,'cases',work,'count',work_count);
  elsif op='MODEL_SLOT' then
    if cfg.mode='PAUSED' or cfg.max_model_calls_daily=0 then return jsonb_build_object('allowed',false); end if;
    insert into app.email_sdr_model_usage values(target_organization_id,(clock_timestamp() at time zone 'America/Mexico_City')::date,0) on conflict do nothing;
    update app.email_sdr_model_usage set calls=calls+1 where organization_id=target_organization_id and day=(clock_timestamp() at time zone 'America/Mexico_City')::date and calls<cfg.max_model_calls_daily returning calls into model_calls;
    return jsonb_build_object('allowed',model_calls is not null);
  end if;
  select * into c from public.email_sdr_cases where organization_id=target_organization_id and id=(p->>'case_id')::uuid for update;
  if c.id is null then raise exception 'SDR_CASE_NOT_FOUND'; end if;
  select * into e from public.provider_events where organization_id=target_organization_id and id=c.provider_event_id;
  select * into inbound from public.messages where organization_id=target_organization_id and id=e.message_id and direction='INBOUND';
  select * into enrollment from public.campaign_enrollments where organization_id=target_organization_id and id=inbound.enrollment_id;
  select * into campaign from public.campaigns where organization_id=target_organization_id and id=enrollment.campaign_id;
  select * into contact from public.contacts where organization_id=target_organization_id and id=inbound.contact_id;
  if campaign.id is null or not campaign.id=any(cfg.campaign_ids) then raise exception 'SDR_CAMPAIGN_NOT_ALLOWED'; end if;
  if op='SEND_CONTEXT' then
    if c.state<>'QUEUED' or c.message_id is distinct from (p->>'message_id')::uuid or cfg.mode='PAUSED'
      or c.policy_version<>cfg.policy_version or app.is_suppressed(target_organization_id,contact.account_id,contact.normalized_email,split_part(contact.normalized_email,'@',2))
      or not exists(select 1 from public.runtime_controls rc where rc.organization_id=target_organization_id and not rc.global_kill_switch and rc.external_send_allowed)
      then return jsonb_build_object('status','HOLD'); end if;
    select * into mailbox from public.mailboxes where organization_id=target_organization_id and id=inbound.mailbox_id;
    return jsonb_build_object('status','SEND_CONTEXT','case_id',c.id,'event_id',e.id,'event_kind',e.event_kind,'body',inbound.body_text,
      'mailbox_id',inbound.mailbox_id,'mailbox_email',mailbox.normalized_email,'contact_email',contact.normalized_email,'owner_id',c.owner_user_id,
      'provider_message_id',inbound.provider_message_id,'provider_thread_id',inbound.provider_thread_id,'related_outbound_id',e.payload_json->>'related_outbound_message_id',
      'suppressed',false,'followup',c.followups_sent>0,'followups_sent',c.followups_sent,'approved',c.approved,'decision',c.decision,
      'own_sdr_message_ids',coalesce((select jsonb_agg(m.provider_message_id) from public.messages m where m.organization_id=target_organization_id and m.reply_to_provider_event_id=e.id and m.idempotency_key like 'email-sdr:%' and m.provider_message_id is not null),'[]'::jsonb));
  elsif op='DECIDE' then
    if p->>'policy_version' is distinct from cfg.policy_version or p->'decision'->>'intent' not in
      ('CONTEXT','EXPLICIT_INTEREST','PRICE','UNSUBSCRIBE','OUT_OF_OFFICE','REFERRAL','WRONG_PERSON','NOT_NOW','REJECTION','COMPLAINT','TECHNICAL_COMMITMENT','AMBIGUOUS') then raise exception 'SDR_DECISION_INVALID'; end if;
    if c.state in ('QUEUED','SUPPRESSED','NO_ACTION','MANUAL_HANDLED') then return jsonb_build_object('status','DUPLICATE'); end if;
    update public.email_sdr_cases set decision=case when p->'decision'->>'subtype' in ('POSITIVE_ACCEPT','POSITIVE_VISIT') then p->'decision'||jsonb_build_object('draft',coalesce(app.email_sdr_positive_body(target_organization_id,c.id,p->'decision'->>'subtype'),'')) else p->'decision' end,thread_hash=p->>'thread_hash',thread_checked_at=clock_timestamp(),
      state=case when p->>'state' in ('REVIEW','BLOCKED','NO_ACTION','MANUAL_HANDLED') then p->>'state' else 'REVIEW' end,
      approved=case when reviewed_thread_hash=p->>'thread_hash' and reviewed_policy_version=cfg.policy_version then approved else false end,
      next_action=left(coalesce(p->>'next_action','Revisión humana requerida'),1000),lease_until=null,updated_at=clock_timestamp() where id=c.id;
    -- 6-oct (Grant): un positivo queda calificado en cuanto se decide, aunque el envío espere o se frene.
    if p->'decision'->>'subtype' in ('POSITIVE_ACCEPT','POSITIVE_VISIT') and e.event_kind='REPLY' then
      perform app.email_sdr_classify_positive(target_organization_id,c.id);
    end if;
    -- 13-oct: toda respuesta humana entra al CRM en cuanto el SDR la clasifica.
    if e.event_kind='REPLY' then perform app.crm_upsert_from_reply(target_organization_id,e.id); end if;
    return jsonb_build_object('status','RECORDED');
  elsif op='SUPPRESSED' then
    if not app.is_suppressed(target_organization_id,contact.account_id,contact.normalized_email,split_part(contact.normalized_email,'@',2)) then raise exception 'SDR_SUPPRESSION_NOT_CONFIRMED'; end if;
    update public.email_sdr_cases set state='SUPPRESSED',next_due_at=null,next_action='Baja aplicada. No enviar',lease_until=null,updated_at=clock_timestamp() where id=c.id;
    if e.event_kind='REPLY' then perform app.crm_upsert_from_reply(target_organization_id,e.id); end if;
    return jsonb_build_object('status','SUPPRESSED');
  elsif op='QUEUE' then
    if c.state='QUEUED' then return jsonb_build_object('status','DUPLICATE','message_id',c.message_id); end if;
    if cfg.mode='PAUSED' then return jsonb_build_object('status','HOLD','reason','SDR_PAUSED'); end if;
    if inbound.body_text is null or inbound.normalized_from is distinct from contact.normalized_email or c.owner_user_id is null
      or c.thread_checked_at<clock_timestamp()-interval '60 seconds' or c.thread_hash is distinct from p->>'thread_hash'
      or c.thread_checked_at is null or c.thread_hash is null or c.decision->'gates' is distinct from '[]'::jsonb then return jsonb_build_object('status','HOLD','reason','CONVERSATION_NOT_ELIGIBLE'); end if;
    if app.is_suppressed(target_organization_id,contact.account_id,contact.normalized_email,split_part(contact.normalized_email,'@',2)) then return jsonb_build_object('status','HOLD','reason','SUPPRESSED'); end if;
    -- 14-oct (Grant): una sola respuesta automática por persona; la siguiente se contesta a mano.
    if not coalesce((p->>'followup')::boolean,false) and exists (select 1 from public.messages om
        where om.organization_id=target_organization_id and om.contact_id=contact.id and om.direction='OUTBOUND'
          and om.idempotency_key like 'email-sdr:%' and om.idempotency_key not like 'email-sdr:'||c.id::text||':%'
          and om.status in ('QUEUED','SENDING','SENT','DELIVERED')) then
      update public.email_sdr_cases set next_action='Ya se le contestó en automático una vez. Si hace falta, contestar a mano',
        updated_at=clock_timestamp() where id=c.id;
      return jsonb_build_object('status','HOLD','reason','AUTO_REPLY_ALREADY_SENT');
    end if;
    if exists(select 1 from public.messages m where m.organization_id=target_organization_id and m.enrollment_id=inbound.enrollment_id
      and m.id<>inbound.id and m.direction='INBOUND' and m.created_at>inbound.created_at) then return jsonb_build_object('status','HOLD','reason','NEWER_REPLY'); end if;
    intent:=c.decision->>'intent';
    if intent not in ('CONTEXT','EXPLICIT_INTEREST') or c.decision->>'eligible' is distinct from 'true' then return jsonb_build_object('status','HOLD','reason','CLASS_REQUIRES_HUMAN'); end if;
    select count(*) into reviewed_count from public.email_sdr_cases sc join public.messages m on m.id=sc.message_id and m.organization_id=sc.organization_id
      where sc.organization_id=target_organization_id and sc.approved and sc.reviewed_by is not null and sc.reviewed_policy_version=cfg.policy_version
        and sc.decision->>'eligible'='true' and m.status in ('SENT','DELIVERED') and m.provider_message_id is not null and m.rfc_message_id is not null
        and m.provider_thread_id=(select im.provider_thread_id from public.provider_events pe join public.messages im on im.id=pe.message_id and im.organization_id=pe.organization_id where pe.id=sc.provider_event_id and pe.organization_id=sc.organization_id);
    if not(c.approved and c.reviewed_thread_hash=c.thread_hash and c.reviewed_policy_version=cfg.policy_version) then
      if cfg.mode<>'AUTO' or not intent=any(cfg.auto_intents) or coalesce(c.decision->>'subtype','') not in ('POSITIVE_ACCEPT','POSITIVE_VISIT')
        or cfg.acceptance_evidence->>'tests_passed' is distinct from 'true'
        or cfg.acceptance_evidence->>'pause_resume_verified' is distinct from 'true'
        then return jsonb_build_object('status','HOLD','reason','AUTO_NOT_ENABLED'); end if;
    end if;
    followup:=coalesce((p->>'followup')::boolean,false);
    if not followup and not(c.approved and c.reviewed_thread_hash=c.thread_hash and c.reviewed_policy_version=cfg.policy_version) then
      if c.send_after is null or c.send_after>clock_timestamp() or not app.direct_lane_campaign_window_open(clock_timestamp()) then
        update public.email_sdr_cases set send_after=case when c.send_after is not null and c.send_after>clock_timestamp() then c.send_after
            else app.email_sdr_next_send_at(greatest(coalesce(e.observed_at,inbound.created_at),coalesce(c.send_after,'-infinity'::timestamptz)),c.id::text) end,
          state='READY',next_action='Respuesta automática programada con copia a Paco y Oscar',lease_until=null,updated_at=clock_timestamp()
          where id=c.id returning send_after into next_due;
        if next_due>clock_timestamp()+interval '30 seconds' then return jsonb_build_object('status','HOLD','reason','SCHEDULED','send_after',next_due); end if;
      end if;
    end if;
    if followup and (c.initial_sent_at is null or c.followups_sent>=2 or c.next_due_at is null or c.next_due_at>clock_timestamp()) then return jsonb_build_object('status','HOLD','reason','FOLLOWUP_NOT_DUE'); end if;
    if not followup and c.initial_sent_at is not null then return jsonb_build_object('status','HOLD','reason','INITIAL_ALREADY_SENT'); end if;
    body_value:=case when followup then case when c.followups_sent=0 then
      E'Retomo tu respuesta por aquí. ¿Sigue vigente la necesidad que comentaste?\n\nFrancisco'
      else E'Cierro el seguimiento por ahora para no insistir. Si retoman la revisión, puedes responder en este mismo correo.\n\nFrancisco' end
      when c.decision->>'subtype' in ('POSITIVE_ACCEPT','POSITIVE_VISIT') then app.email_sdr_positive_body(target_organization_id,c.id,c.decision->>'subtype')
      when intent='CONTEXT' then E'Claro. En ENNCO hacemos instalaciones fotovoltaicas y mantenimiento eléctrico industrial: tableros, transformadores e instalaciones solares. Entregamos un reporte de lo que encontramos y de lo que conviene atender primero.\n\n¿Qué necesitas revisar hoy en tu planta?\n\nFrancisco'
      else E'Gracias por contármelo. Para entender la necesidad antes de proponerte un alcance, ¿qué equipo o instalación necesitas revisar?\n\nFrancisco' end;
    if nullif(btrim(body_value),'') is null then return jsonb_build_object('status','HOLD','reason','TEMPLATE_NOT_APPROVED'); end if;
    select * into mailbox from public.mailboxes where organization_id=target_organization_id and id=inbound.mailbox_id;
    insert into public.messages(organization_id,enrollment_id,mailbox_id,contact_id,direction,status,lane,touch_number,
      normalized_to,normalized_from,subject,body_text,idempotency_key,correlation_id,provider_thread_id,cc_emails,reply_to_provider_event_id)
    values(target_organization_id,enrollment.id,inbound.mailbox_id,contact.id,'OUTBOUND','QUEUED','DIRECT',null,contact.normalized_email,mailbox.normalized_email,
      left(case when inbound.subject ~* '^re:' then inbound.subject else 'Re: '||coalesce(inbound.subject,'Seguimiento') end,180),body_value,
      'email-sdr:'||c.id::text||':'||case when followup then (c.followups_sent+1)::text else '0' end,gen_random_uuid(),inbound.provider_thread_id,
      app.email_sdr_reply_cc(campaign.manifest_json->>'cc_on_reply_email',cfg.reply_cc_emails),e.id)
    on conflict(organization_id,idempotency_key) do nothing returning id into message_id_value;
    if message_id_value is null then return jsonb_build_object('status','DUPLICATE'); end if;
    update public.email_sdr_cases set state='QUEUED',message_id=message_id_value,followups_sent=followups_sent+case when followup then 1 else 0 end,
      next_action='Esperar recibo del transporte original',lease_until=null,updated_at=clock_timestamp() where id=c.id;
    return jsonb_build_object('status','QUEUED','message_id',message_id_value);
  end if;
  raise exception 'SDR_COMMAND_INVALID';
end $function$;

commit;
