-- 097 · Respuesta automática a respuestas positivas (30-sep-2026). Generado por tools/correos/gen-097.py
-- desde las definiciones vivas de tools/correos/vivas-097/. Ver el docstring del generador.
-- Reversa: update app.email_sdr_settings set mode='REVIEW';  (nada sale en automático en REVIEW)

begin;

set local app.operations_rpc_write = 'on';

alter table public.email_sdr_cases add column if not exists send_after timestamptz;
comment on column public.email_sdr_cases.send_after is
  'Hora programada de la respuesta automática a un positivo (10 a 25 min después, dentro de 8:00-18:00 L-V).';

create table if not exists app.email_sdr_templates (
  subtype text primary key check (subtype in ('POSITIVE_ACCEPT','POSITIVE_VISIT')),
  body text not null check (length(btrim(body)) between 20 and 2000 and body !~ '[—–]'),
  version text not null,
  approved_by text not null,
  approved_at timestamptz not null default clock_timestamp()
);
revoke all on app.email_sdr_templates from public;

create table if not exists app.email_sdr_body_overrides (
  organization_id uuid not null references public.organizations(id),
  case_id uuid primary key references public.email_sdr_cases(id),
  body text not null check (length(btrim(body)) between 20 and 2000 and body !~ '[—–]'),
  reason text not null check (length(btrim(reason)) >= 20),
  approved_by text not null,
  created_at timestamptz not null default clock_timestamp()
);
revoke all on app.email_sdr_body_overrides from public;

insert into app.email_sdr_templates(subtype, body, version, approved_by) values
  ('POSITIVE_VISIT', E'Hola {{first_name}},\n\nGracias por la respuesta. Con gusto vamos a su planta a hacer el recorrido con el dron.\n\nTe copio mi correo principal, francisco.cuellar@ennco.com.mx. Desde ahí coordinamos la visita.\n\n¿Hay algún requisito de acceso que debamos cubrir antes, como alta de proveedor, equipo de seguridad o permiso para volar el dron?\n\nSaludos,\nFrancisco Cuellar\nENNCO', 'positivos-v1-2026-09-30', 'Grant (plan 30-sep)'),
  ('POSITIVE_ACCEPT', E'Hola {{first_name}},\n\nGracias, con gusto. Es un recorrido de media hora con cámara térmica y dron, sin costo, y de ahí sale el reporte para {{company}}.\n\n¿Con quién de mantenimiento o de la planta lo coordino?\n\nTe copio mi correo principal, francisco.cuellar@ennco.com.mx, para darle seguimiento desde ahí.\n\nSaludos,\nFrancisco Cuellar\nENNCO', 'positivos-v1-2026-09-30', 'Grant (plan 30-sep)')
on conflict (subtype) do update set body=excluded.body, version=excluded.version, approved_by=excluded.approved_by, approved_at=clock_timestamp();

-- Las dos primeras (llevan 1 y 2 días de atraso): texto propio con disculpa. Solo salen si Grant las aprueba.
insert into app.email_sdr_body_overrides(organization_id, case_id, body, reason, approved_by) values
  ('e0000000-0000-4000-8000-000000000001', '06344ccb-daf9-4c02-a2c1-2f2b0e28fc77', E'Hola Juan,\n\nGracias por la respuesta y perdón por la demora. Con gusto vamos a San Juan del Río a hacer el recorrido con el dron que te comenté.\n\nTe copio mi correo principal, francisco.cuellar@ennco.com.mx. Desde ahí coordinamos la visita.\n\n¿Hay algún requisito de acceso que debamos cubrir antes, como alta de proveedor, equipo de seguridad o permiso para volar el dron?\n\nSaludos,\nFrancisco Cuellar\nENNCO',
   'Natural de Alimentos pidió visita el 29-sep; respuesta tardía con disculpa, canario 1', 'Grant (plan 30-sep)'),
  ('e0000000-0000-4000-8000-000000000001', '651bbc50-dd68-40cb-b777-58806407eef3', E'Hola Leticia,\n\nGracias, con gusto lo preparo para DEDIENNE AEROSPACE. Perdón por la demora.\n\nEl reporte sale de un recorrido de media hora con cámara térmica y dron, sin costo. Como estás en compras, ¿con quién de mantenimiento o de la planta lo coordino?\n\nTe copio mi correo principal, francisco.cuellar@ennco.com.mx, para darle seguimiento desde ahí.\n\nSaludos,\nFrancisco Cuellar\nENNCO',
   'Dedienne aceptó el reporte el 28-sep; respuesta tardía con disculpa, canario 2', 'Grant (plan 30-sep)')
on conflict (case_id) do update set body=excluded.body, reason=excluded.reason, approved_by=excluded.approved_by;

create or replace function app.email_sdr_positive_body(target_org uuid, target_case uuid, target_subtype text)
returns text language sql stable security definer set search_path=public,app,pg_temp as $$
  select coalesce(
    (select o.body from app.email_sdr_body_overrides o where o.organization_id=target_org and o.case_id=target_case),
    (select app.direct_lane_render(t.body, ct.full_name, a.legal_name, null)
       from public.email_sdr_cases sc
       join public.provider_events e on e.organization_id=sc.organization_id and e.id=sc.provider_event_id
       join public.messages m on m.organization_id=e.organization_id and m.id=e.message_id
       join public.contacts ct on ct.organization_id=m.organization_id and ct.id=m.contact_id
       join public.accounts a on a.organization_id=ct.organization_id and a.id=ct.account_id
       join app.email_sdr_templates t on t.subtype=target_subtype
      where sc.organization_id=target_org and sc.id=target_case));
$$;
revoke all on function app.email_sdr_positive_body(uuid, uuid, text) from public;

-- Primer momento >= base + (10 a 25 min, fijo por caso) con la ventana de campaña abierta.
create or replace function app.email_sdr_next_send_at(target_base timestamptz, target_seed text)
returns timestamptz language plpgsql stable set search_path=pg_catalog,app as $$
declare delay interval := make_interval(mins => 10 + mod(abs(hashtextextended(target_seed, 0)), 16)::integer);
  t timestamptz := greatest(target_base + delay, clock_timestamp()); day_value date;
begin
  if app.direct_lane_campaign_window_open(t) then return t; end if;
  day_value := (t at time zone 'America/Mexico_City')::date;
  if (t at time zone 'America/Mexico_City')::time >= time '08:00' then day_value := day_value + 1; end if;
  for i in 0..20 loop
    t := ((day_value + i) + time '08:00') at time zone 'America/Mexico_City' + delay;
    if app.direct_lane_campaign_window_open(t) then return t; end if;
  end loop;
  raise exception 'SDR_NO_SEND_WINDOW';
end $$;

-- Positivo enviado: respuesta POSITIVE, lead, oportunidad en CONVERSATION y aviso confirmado.
create or replace function app.email_sdr_mark_positive(target_org uuid, target_case uuid)
returns void language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare c public.email_sdr_cases%rowtype; e public.provider_events%rowtype; m public.messages%rowtype;
  ce public.campaign_enrollments%rowtype; lead_value uuid; delivered integer;
begin
  select * into c from public.email_sdr_cases where organization_id=target_org and id=target_case;
  select * into e from public.provider_events where organization_id=target_org and id=c.provider_event_id;
  select * into m from public.messages where organization_id=target_org and id=e.message_id and direction='INBOUND';
  select * into ce from public.campaign_enrollments where organization_id=target_org and id=m.enrollment_id;
  if c.id is null or e.event_kind<>'REPLY' or m.id is null or ce.id is null then return; end if;
  update public.provider_events set reply_classification='POSITIVE' where id=e.id and reply_classification='UNREVIEWED';
  insert into public.leads(organization_id,account_id,contact_id,origin_message_id,status,contractual_qualified,qualification_reason,evidence_class)
    values(target_org,ce.account_id,m.contact_id,m.id,'CAPTURED',false,'PENDING_STRICT_HUMAN_QUALIFICATION','live')
    on conflict (organization_id,origin_message_id) do nothing returning id into lead_value;
  if lead_value is null then select id into lead_value from public.leads where organization_id=target_org and origin_message_id=m.id; end if;
  insert into public.event_outbox(organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json)
    values(target_org,'provider_event',e.id,'reply.reviewed','reply-reviewed:'||e.id::text,
      jsonb_build_object('provider_event_id',e.id,'classification','POSITIVE','lead_id',lead_value,'reviewed_by',null,'source','email-sdr-auto'))
    on conflict (organization_id,idempotency_key) do nothing;
  if lead_value is not null and not exists(select 1 from public.opportunities o where o.organization_id=target_org and o.lead_id=lead_value) then
    insert into public.opportunities(organization_id,account_id,lead_id,stage,next_action,next_action_at,creation_idempotency_key)
      values(target_org,ce.account_id,lead_value,'CONVERSATION','Respuesta positiva contestada con copia a Paco. Paco coordina la visita',
        clock_timestamp()+interval '1 day',encode(digest('email-sdr-opportunity:'||lead_value::text,'sha256'),'hex'));
  end if;
  update public.notification_deliveries n set status='DELIVERED',delivered_at=clock_timestamp(),attempt_count=n.attempt_count+1,
      provider_id='email-sdr-auto:'||c.id::text,last_error=null
    from public.event_outbox o where n.organization_id=target_org and n.outbox_event_id=o.id and o.organization_id=n.organization_id
      and o.aggregate_id=e.id and o.event_type in ('gmail.reply','gmail.auto_reply') and n.channel='CONTROL_ROOM' and n.status<>'DELIVERED';
  get diagnostics delivered=row_count;
  update public.event_outbox o set status='DELIVERED',delivered_at=clock_timestamp(),locked_at=null,last_error=null
    where o.organization_id=target_org and o.aggregate_id=e.id and o.event_type in ('gmail.reply','gmail.auto_reply') and o.status<>'DELIVERED'
      and exists(select 1 from public.notification_deliveries n where n.outbox_event_id=o.id and n.organization_id=o.organization_id
        and n.channel='CONTROL_ROOM' and n.status='DELIVERED');
  insert into public.audit_log(organization_id,action,record_type,record_id,new_data)
    values(target_org,'EMAIL_SDR_POSITIVE_AUTO_HANDLED','email_sdr_cases',c.id,
      jsonb_build_object('lead_id',lead_value,'subtype',c.decision->>'subtype','alerts_acknowledged',delivered));
end $$;
revoke all on function app.email_sdr_mark_positive(uuid, uuid) from public;

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
  if proof_signature<>signature then raise exception 'SDR_UNAUTHORIZED'; end if;
  insert into app.email_sdr_nonces values(target_organization_id,proof_nonce,proof_expires_at);
  delete from app.email_sdr_nonces where organization_id=target_organization_id and expires_at<clock_timestamp()-interval '1 day';
  p:=target_payload::jsonb; op:=p->>'op';
  if op='ALERT_WORK' then
    return app.email_sdr_alert_work(target_organization_id);
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
          next_action=case when row_value.subtype in ('POSITIVE_ACCEPT','POSITIVE_VISIT') then 'Respondida automáticamente con copia a Paco. Paco coordina desde su correo'
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
    return jsonb_build_object('status','RECORDED');
  elsif op='SUPPRESSED' then
    if not app.is_suppressed(target_organization_id,contact.account_id,contact.normalized_email,split_part(contact.normalized_email,'@',2)) then raise exception 'SDR_SUPPRESSION_NOT_CONFIRMED'; end if;
    update public.email_sdr_cases set state='SUPPRESSED',next_due_at=null,next_action='Baja aplicada. No enviar',lease_until=null,updated_at=clock_timestamp() where id=c.id;
    return jsonb_build_object('status','SUPPRESSED');
  elsif op='QUEUE' then
    if c.state='QUEUED' then return jsonb_build_object('status','DUPLICATE','message_id',c.message_id); end if;
    if cfg.mode='PAUSED' then return jsonb_build_object('status','HOLD','reason','SDR_PAUSED'); end if;
    if inbound.body_text is null or inbound.normalized_from is distinct from contact.normalized_email or c.owner_user_id is null
      or c.thread_checked_at<clock_timestamp()-interval '60 seconds' or c.thread_hash is distinct from p->>'thread_hash'
      or c.thread_checked_at is null or c.thread_hash is null or c.decision->'gates' is distinct from '[]'::jsonb then return jsonb_build_object('status','HOLD','reason','CONVERSATION_NOT_ELIGIBLE'); end if;
    if app.is_suppressed(target_organization_id,contact.account_id,contact.normalized_email,split_part(contact.normalized_email,'@',2)) then return jsonb_build_object('status','HOLD','reason','SUPPRESSED'); end if;
    if exists(select 1 from public.messages m where m.organization_id=target_organization_id and m.enrollment_id=inbound.enrollment_id
      and m.id<>inbound.id and m.direction='INBOUND' and m.created_at>inbound.created_at) then return jsonb_build_object('status','HOLD','reason','NEWER_REPLY'); end if;
    intent:=c.decision->>'intent';
    if intent not in ('CONTEXT','EXPLICIT_INTEREST') or c.decision->>'eligible' is distinct from 'true' then return jsonb_build_object('status','HOLD','reason','CLASS_REQUIRES_HUMAN'); end if;
    select count(*) into reviewed_count from public.email_sdr_cases sc join public.messages m on m.id=sc.message_id and m.organization_id=sc.organization_id
      where sc.organization_id=target_organization_id and sc.approved and sc.reviewed_by is not null and sc.reviewed_policy_version=cfg.policy_version
        and sc.decision->>'eligible'='true' and m.status in ('SENT','DELIVERED') and m.provider_message_id is not null and m.rfc_message_id is not null
        and m.provider_thread_id=(select im.provider_thread_id from public.provider_events pe join public.messages im on im.id=pe.message_id and im.organization_id=pe.organization_id where pe.id=sc.provider_event_id and pe.organization_id=sc.organization_id);
    if not(c.approved and c.reviewed_thread_hash=c.thread_hash and c.reviewed_policy_version=cfg.policy_version) then
      if cfg.mode<>'AUTO' or reviewed_count<2 or not intent=any(cfg.auto_intents) or coalesce(c.decision->>'subtype','') not in ('POSITIVE_ACCEPT','POSITIVE_VISIT')
        or cfg.acceptance_evidence->>'tests_passed' is distinct from 'true'
        or cfg.acceptance_evidence->>'pause_resume_verified' is distinct from 'true'
        or not exists(select 1 from public.email_sdr_cases sc where sc.organization_id=target_organization_id and sc.approved and sc.reviewed_by is not null and sc.reviewed_policy_version=cfg.policy_version and sc.decision->>'intent'=intent)
        then return jsonb_build_object('status','HOLD','reason','FIVE_REVIEWED_CANARIES_REQUIRED'); end if;
    end if;
    followup:=coalesce((p->>'followup')::boolean,false);
    if not followup and not(c.approved and c.reviewed_thread_hash=c.thread_hash and c.reviewed_policy_version=cfg.policy_version) then
      if c.send_after is null or c.send_after>clock_timestamp() or not app.direct_lane_campaign_window_open(clock_timestamp()) then
        update public.email_sdr_cases set send_after=case when c.send_after is not null and c.send_after>clock_timestamp() then c.send_after
            else app.email_sdr_next_send_at(greatest(coalesce(e.observed_at,inbound.created_at),coalesce(c.send_after,'-infinity'::timestamptz)),c.id::text) end,
          state='READY',next_action='Respuesta automática programada con copia a Paco',lease_until=null,updated_at=clock_timestamp()
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
      case when campaign.manifest_json->>'cc_on_reply_email' is null then '{}'::text[] else array[lower(campaign.manifest_json->>'cc_on_reply_email')] end,e.id)
    on conflict(organization_id,idempotency_key) do nothing returning id into message_id_value;
    if message_id_value is null then return jsonb_build_object('status','DUPLICATE'); end if;
    update public.email_sdr_cases set state='QUEUED',message_id=message_id_value,followups_sent=followups_sent+case when followup then 1 else 0 end,
      next_action='Esperar recibo del transporte original',lease_until=null,updated_at=clock_timestamp() where id=c.id;
    return jsonb_build_object('status','QUEUED','message_id',message_id_value);
  end if;
  raise exception 'SDR_COMMAND_INVALID';
end $function$;

CREATE OR REPLACE FUNCTION public.claim_direct_lane_dispatch(target_organization_id uuid, target_mailbox_id uuid, dry_run boolean, proof_command_id text, proof_nonce uuid, proof_expires_at timestamp with time zone, proof_signature text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_temp'
AS $function$
declare payload_sha text; mailbox_record public.mailboxes%rowtype; controls_record public.runtime_controls%rowtype;
  cap integer; sent_count integer; last_outbound_at timestamptz; pace_seconds integer; stuck integer;
  new_count integer; ceiling integer; reply_only boolean := false; budget_spent boolean := false;
  reply_record public.messages%rowtype; inbound_record public.messages%rowtype; candidate record; previous_message public.messages%rowtype;
  message_id_value uuid; correlation_value uuid := gen_random_uuid(); attempt_value integer; idempotency_value text;
  thread_json jsonb; rendered_subject text; rendered_body text; unsubscribe_enrollment uuid; hook_text text;
begin
  if dry_run is null then raise exception 'DIRECT_LANE_CLAIM_INPUT_INVALID'; end if;
  payload_sha := encode(digest(convert_to(concat_ws(E'\n','claim_direct_lane_dispatch',target_organization_id::text,
    target_mailbox_id::text,dry_run::text),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  perform pg_advisory_xact_lock(hashtextextended('direct-lane:'||target_mailbox_id::text,0));

  select * into mailbox_record from public.mailboxes where organization_id=target_organization_id and id=target_mailbox_id;
  if not found then return app.direct_lane_noop(target_organization_id,target_mailbox_id,'MAILBOX_NOT_FOUND',null); end if;
  if mailbox_record.direct_lane_status<>'CONNECTED' or not exists (select 1 from public.direct_lane_credentials c
    where c.organization_id=target_organization_id and c.mailbox_id=target_mailbox_id and c.status='ACTIVE') then
    return app.direct_lane_noop(target_organization_id,target_mailbox_id,'MAILBOX_NOT_CONNECTED',jsonb_build_object('status',mailbox_record.direct_lane_status));
  end if;

  -- Un envío incierto nunca se convierte en reintento automático.
  update public.messages set status='QUARANTINED',updated_at=clock_timestamp()
  where organization_id=target_organization_id and mailbox_id=target_mailbox_id and lane='DIRECT'
    and direction='OUTBOUND' and status='SENDING' and updated_at<clock_timestamp()-interval '15 minutes';
  get diagnostics stuck=row_count;
  if stuck>0 then
    perform app.direct_lane_tick(target_organization_id,target_mailbox_id,null,'CLAIM','AMBIGUOUS',jsonb_build_object('count',stuck));
  end if;
  if exists (select 1 from public.messages where organization_id=target_organization_id and mailbox_id=target_mailbox_id
    and lane='DIRECT' and direction='OUTBOUND' and status='QUARANTINED') then
    update public.mailboxes set direct_lane_status='PAUSED',updated_at=clock_timestamp()
      where organization_id=target_organization_id and id=target_mailbox_id;
    return app.direct_lane_noop(target_organization_id,target_mailbox_id,'RECONCILIATION_REQUIRED',null);
  end if;

  if not dry_run then
    if not exists (select 1 from public.mailbox_sync_cursors s where s.organization_id=target_organization_id
      and s.mailbox_id=target_mailbox_id and s.last_history_id is not null and s.status::text='READY'
      and s.last_synced_at>clock_timestamp()-interval '5 minutes' and s.last_synced_at<=clock_timestamp()) then
      return app.direct_lane_noop(target_organization_id,target_mailbox_id,'SYNC_STALE',null);
    end if;
    select * into controls_record from public.runtime_controls where organization_id=target_organization_id;
    if not found or controls_record.global_kill_switch or not controls_record.external_send_allowed then
      return app.direct_lane_noop(target_organization_id,target_mailbox_id,'RUNTIME_HOLD',null);
    end if;
    -- Fuera de la ventana de campaña solo pueden salir respuestas del operador (8:00 a 20:00).
    reply_only := not app.direct_lane_campaign_window_open(clock_timestamp());
    if reply_only and not app.direct_lane_reply_window_open(clock_timestamp()) then
      return app.direct_lane_noop(target_organization_id,target_mailbox_id,'OUTSIDE_SEND_WINDOW',null);
    end if;
    if not app.annex_a_manifest_is_ready(target_organization_id) then
      return app.direct_lane_noop(target_organization_id,target_mailbox_id,'ANNEX_A_NOT_READY',null);
    end if;
  end if;

  -- Opcion C (Grant, 7-sep): la rampa limita CONTACTOS NUEVOS al dia (toque 1);
  -- los toques 2 a 8 salen el dia que les toca, encima, con prioridad; y un
  -- techo total diario (cap_max) protege al buzon de la acumulacion.
  cap := app.direct_lane_effective_cap(mailbox_record);
  sent_count := app.direct_lane_sent_today(target_organization_id,target_mailbox_id);
  new_count := app.direct_lane_new_today(target_organization_id,target_mailbox_id);
  ceiling := mailbox_record.direct_lane_cap_max;
  -- El tope es de la campaña: una respuesta del operador sale aunque el buzón ya lo haya llenado.
  budget_spent := sent_count>=ceiling;

  if not dry_run then
    -- Ritmo: cuenta lo que ya salió o está saliendo. Una respuesta QUEUED del
    -- operador todavía no ha tocado Gmail y no debe frenar su propio envío.
    select max(coalesce(sent_at,created_at)) into last_outbound_at from public.messages
    where organization_id=target_organization_id and mailbox_id=target_mailbox_id and lane='DIRECT' and direction='OUTBOUND'
      and status in ('SENDING','SENT','DELIVERED')
      and (created_at at time zone 'America/Mexico_City')::date=(clock_timestamp() at time zone 'America/Mexico_City')::date;
    if last_outbound_at is not null then
      pace_seconds := 120+mod(abs(hashtextextended(to_char(clock_timestamp() at time zone 'America/Mexico_City','YYYY-MM-DD')||':'||target_mailbox_id::text||':'||sent_count::text,0)),90)::integer;
      if last_outbound_at>clock_timestamp()-make_interval(secs=>pace_seconds) then
        return app.direct_lane_noop(target_organization_id,target_mailbox_id,'PACING_HOLD',jsonb_build_object('next_eligible_at',last_outbound_at+make_interval(secs=>pace_seconds)));
      end if;
    end if;

    -- Prioridad 1: una respuesta escrita por el operador. Se copia a quien la
    -- campaña indique (Paco) y sale en el hilo original.
    select * into reply_record from public.messages
    where organization_id=target_organization_id and mailbox_id=target_mailbox_id and lane='DIRECT' and direction='OUTBOUND'
      and status='QUEUED' and touch_number is null
    order by created_at limit 1 for update skip locked;
    if found then
      if app.is_suppressed(target_organization_id,null,reply_record.normalized_to,split_part(reply_record.normalized_to,'@',2)) then
        update public.messages set status='FAILED',updated_at=clock_timestamp() where id=reply_record.id;
        return app.direct_lane_noop(target_organization_id,target_mailbox_id,'REPLY_SUPPRESSED',null);
      end if;
      update public.messages set status='SENDING',updated_at=clock_timestamp() where id=reply_record.id;
      select m.* into inbound_record from public.provider_events e join public.messages m on m.organization_id=e.organization_id and m.id=e.message_id
      where e.organization_id=target_organization_id and e.id=reply_record.reply_to_provider_event_id;
      select * into previous_message from public.messages
      where organization_id=target_organization_id and id=(select (pe.payload_json->>'related_outbound_message_id')::uuid from public.provider_events pe where pe.id=reply_record.reply_to_provider_event_id);
      thread_json := jsonb_strip_nulls(jsonb_build_object(
        'provider_thread_id',coalesce(reply_record.provider_thread_id,inbound_record.provider_thread_id,previous_message.provider_thread_id),
        'in_reply_to',coalesce(inbound_record.rfc_message_id,previous_message.rfc_message_id),
        'references',to_jsonb(array_remove(array[previous_message.rfc_message_id,inbound_record.rfc_message_id],null))));
      perform app.direct_lane_tick(target_organization_id,target_mailbox_id,reply_record.id,'CLAIM','CLAIMED_REPLY',null);
      return jsonb_build_object('status','CLAIMED','kind','REPLY','message_id',reply_record.id,'sdr_case_id',(select sc.id from public.email_sdr_cases sc where sc.organization_id=target_organization_id and sc.message_id=reply_record.id),'mailbox_id',target_mailbox_id,
        'from_email',mailbox_record.normalized_email,'from_name',coalesce(mailbox_record.direct_lane_display_name,mailbox_record.sender_name),
        'to_email',reply_record.normalized_to,'cc_emails',to_jsonb(reply_record.cc_emails),'subject',reply_record.subject,
        'body_text',reply_record.body_text,'touch_number',null,'thread',case when thread_json ? 'provider_thread_id' and thread_json ? 'in_reply_to' then thread_json else null end,
        'enrollment_id',reply_record.enrollment_id,'sent_today',sent_count,'daily_cap',cap);
    end if;
  end if;

  if reply_only then
    return app.direct_lane_noop(target_organization_id,target_mailbox_id,'OUTSIDE_SEND_WINDOW',jsonb_build_object('replies_only',true));
  end if;
  if budget_spent then
    return app.direct_lane_noop(target_organization_id,target_mailbox_id,'BUDGET_EXHAUSTED',
      jsonb_build_object('sent_today',sent_count,'ceiling',ceiling,'new_today',new_count,'new_cap',cap));
  end if;

  -- Prioridad 2: el siguiente toque vencido de una inscripción de este buzón.
  select ce.id as enrollment_id, ce.next_touch_number as touch_value, ce.status as enrollment_status, ce.sequence_version_id,
    ct.id as contact_id, ct.full_name, ct.normalized_email as contact_email, a.legal_name, a.id as account_id, a.primary_domain,
    st.subject_template, st.body_template, c.id as campaign_id
  into candidate
  from public.campaign_enrollments ce
  join public.campaigns c on c.organization_id=ce.organization_id and c.id=ce.campaign_id
  join public.contacts ct on ct.organization_id=ce.organization_id and ct.id=ce.contact_id
  join public.accounts a on a.organization_id=ce.organization_id and a.id=ce.account_id
  join public.sequence_touches st on st.organization_id=ce.organization_id and st.sequence_version_id=ce.sequence_version_id and st.touch_number=ce.next_touch_number
  where ce.organization_id=target_organization_id and ce.mailbox_id=target_mailbox_id
    and c.lane='DIRECT' and (c.direct_lane_state='RUNNING' or (dry_run and c.direct_lane_state in ('DRAFT','RUNNING','PAUSED')))
    and (ce.next_touch_number>1 or not app.email_cohort_on_hold(ce.organization_id,ce.campaign_id))
    and ce.status in ('PENDING','ACTIVE') and coalesce(ce.next_touch_at,clock_timestamp())<=clock_timestamp()
    and ct.verified and not ct.is_deleted and not a.is_deleted
    and not app.is_suppressed(target_organization_id,a.id,ct.normalized_email,a.primary_domain)
    and not exists (select 1 from public.messages m2 where m2.organization_id=target_organization_id and m2.enrollment_id=ce.id
      and m2.direction='OUTBOUND' and m2.touch_number=ce.next_touch_number
      and (case when dry_run then m2.status<>'FAILED' else m2.status not in ('FAILED','DRY_RUN') end))
    and (ce.next_touch_number>1 or new_count<cap)
  order by (ce.next_touch_number=1), ce.next_touch_at nulls first, ce.created_at
  limit 1 for update of ce skip locked;
  if candidate.enrollment_id is null then
    if new_count>=cap and exists (select 1 from public.campaign_enrollments ce2
        join public.campaigns c2 on c2.organization_id=ce2.organization_id and c2.id=ce2.campaign_id
        where ce2.organization_id=target_organization_id and ce2.mailbox_id=target_mailbox_id and c2.lane='DIRECT'
          and c2.direct_lane_state='RUNNING' and ce2.status in ('PENDING','ACTIVE') and ce2.next_touch_number=1
          and coalesce(ce2.next_touch_at,clock_timestamp())<=clock_timestamp()) then
      return app.direct_lane_noop(target_organization_id,target_mailbox_id,'NEW_CONTACT_CAP_REACHED',
        jsonb_build_object('sent_today',sent_count,'ceiling',ceiling,'new_today',new_count,'new_cap',cap));
    end if;
    return app.direct_lane_noop(target_organization_id,target_mailbox_id,'NO_ELIGIBLE_ENVELOPE',
      jsonb_build_object('sent_today',sent_count,'ceiling',ceiling,'new_today',new_count,'new_cap',cap));
  end if;

  hook_text := app.hook_for_account(target_organization_id, candidate.account_id);
  rendered_subject := left(app.direct_lane_render(candidate.subject_template,candidate.full_name,candidate.legal_name,hook_text),180);
  rendered_body := app.direct_lane_render(candidate.body_template,candidate.full_name,candidate.legal_name,hook_text);
  thread_json := null;
  if candidate.touch_value>1 then
    select * into previous_message from public.messages
    where organization_id=target_organization_id and enrollment_id=candidate.enrollment_id and direction='OUTBOUND'
      and touch_number=candidate.touch_value-1 and status in ('SENT','DELIVERED')
    order by sent_at desc nulls last limit 1;
    if previous_message.id is not null and previous_message.provider_thread_id is not null and previous_message.rfc_message_id is not null then
      thread_json := jsonb_build_object('provider_thread_id',previous_message.provider_thread_id,'in_reply_to',previous_message.rfc_message_id,
        'references',to_jsonb(array[previous_message.rfc_message_id]));
    end if;
  end if;

  select count(*)+1 into attempt_value from public.messages
  where organization_id=target_organization_id and enrollment_id=candidate.enrollment_id and direction='OUTBOUND'
    and touch_number=candidate.touch_value and status='FAILED';
  idempotency_value := 'direct-dispatch:'||candidate.enrollment_id::text||':t'||candidate.touch_value::text||':a'||attempt_value::text
    ||case when dry_run then ':shadow' else '' end;

  if not dry_run and candidate.enrollment_status='PENDING' then
    update public.campaign_enrollments set status='ACTIVE',updated_at=clock_timestamp()
    where organization_id=target_organization_id and id=candidate.enrollment_id and status='PENDING';
  end if;

  insert into public.messages(organization_id,enrollment_id,mailbox_id,contact_id,direction,status,lane,touch_number,
    normalized_to,normalized_from,subject,body_text,idempotency_key,correlation_id,provider_thread_id)
  values (target_organization_id,candidate.enrollment_id,target_mailbox_id,candidate.contact_id,'OUTBOUND',
    case when dry_run then 'DRY_RUN'::public.message_status else 'SENDING'::public.message_status end,'DIRECT',candidate.touch_value,
    candidate.contact_email,mailbox_record.normalized_email,rendered_subject,rendered_body,idempotency_value,correlation_value,
    thread_json->>'provider_thread_id')
  on conflict (organization_id,idempotency_key) do nothing
  returning id into message_id_value;
  if message_id_value is null then
    select id into message_id_value from public.messages where organization_id=target_organization_id and idempotency_key=idempotency_value;
  end if;
  perform app.direct_lane_tick(target_organization_id,target_mailbox_id,message_id_value,'CLAIM',case when dry_run then 'SHADOW_CLAIMED' else 'CLAIMED_TOUCH' end,
    jsonb_build_object('touch',candidate.touch_value,'attempt',attempt_value,'hook',coalesce(hook_text,'')<>''));
  return jsonb_build_object('status',case when dry_run then 'SHADOW_CLAIMED' else 'CLAIMED' end,'kind','TOUCH','message_id',message_id_value,
    'mailbox_id',target_mailbox_id,'from_email',mailbox_record.normalized_email,
    'from_name',coalesce(mailbox_record.direct_lane_display_name,mailbox_record.sender_name),
    'to_email',candidate.contact_email,'cc_emails','[]'::jsonb,'subject',rendered_subject,'body_text',rendered_body,
    'touch_number',candidate.touch_value,'thread',thread_json,'enrollment_id',candidate.enrollment_id,
    'sent_today',sent_count,'daily_cap',cap,'attempt',attempt_value);
end $function$;

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
  if coalesce(oldest_seconds,0)>=7200 then
    update public.campaigns ca set new_contacts_paused=true,updated_at=clock_timestamp()
      where ca.organization_id=target_org and not ca.new_contacts_paused
      and exists(select 1 from app.email_sdr_settings settings where settings.organization_id=target_org and ca.id=any(settings.campaign_ids));
    get diagnostics claimed=row_count;
    if claimed>0 then
      insert into public.audit_log(organization_id,action,record_type,new_data)
        values(target_org,'EMAIL_SDR_UNACKNOWLEDGED_PAUSE','campaigns',
          jsonb_build_object('paused_campaigns',claimed,'oldest_pending_seconds',oldest_seconds));
    end if;
  end if;
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

CREATE OR REPLACE FUNCTION public.set_email_sdr_mode(target_organization_id uuid, target_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare cfg app.email_sdr_settings%rowtype; reviewed integer;
begin
  if not app.has_role(target_organization_id,array['teckel_admin'::public.user_role]) then raise exception 'SDR_ADMIN_REQUIRED'; end if;
  if target_mode not in ('PAUSED','REVIEW','AUTO') then raise exception 'SDR_MODE_INVALID'; end if;
  select * into cfg from app.email_sdr_settings where organization_id=target_organization_id for update;
  if cfg.organization_id is null then raise exception 'SDR_NOT_CONFIGURED'; end if;
  if target_mode='AUTO' then
    select count(*) into reviewed from public.email_sdr_cases c join public.messages m on m.id=c.message_id and m.organization_id=c.organization_id
      join public.provider_events e on e.id=c.provider_event_id and e.organization_id=c.organization_id
      join public.messages inbound on inbound.id=e.message_id and inbound.organization_id=e.organization_id
      where c.organization_id=target_organization_id and c.approved and c.reviewed_by is not null and c.reviewed_policy_version=cfg.policy_version
        and c.decision->>'eligible'='true' and m.status in ('SENT','DELIVERED') and m.provider_message_id is not null and m.rfc_message_id is not null
        and m.provider_thread_id=inbound.provider_thread_id;
    if reviewed<2 or cfg.acceptance_evidence->>'tests_passed' is distinct from 'true' or cfg.acceptance_evidence->>'pause_resume_verified' is distinct from 'true'
      then raise exception 'SDR_REVIEWED_CANARIES_REQUIRED'; end if;
  end if;
  update app.email_sdr_settings set mode=target_mode,updated_at=clock_timestamp() where organization_id=target_organization_id;
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,new_data)
    values(target_organization_id,auth.uid(),'EMAIL_SDR_MODE','email_sdr_settings',jsonb_build_object('mode',target_mode,'previous_mode',cfg.mode));
  return jsonb_build_object('status','UPDATED','mode',target_mode);
end $function$;

-- Solo los positivos pueden salir en automático (CONTEXT queda a revisión humana). El modo no cambia.
update app.email_sdr_settings set auto_intents=array['EXPLICIT_INTEREST'], updated_at=clock_timestamp()
where organization_id='e0000000-0000-4000-8000-000000000001';

-- Los dos positivos pendientes vuelven a evaluarse con el detector nuevo (quedan en REVIEW para Grant).
update public.email_sdr_cases set state='READY', lease_until=null, updated_at=clock_timestamp()
where organization_id='e0000000-0000-4000-8000-000000000001' and id in ('06344ccb-daf9-4c02-a2c1-2f2b0e28fc77','651bbc50-dd68-40cb-b777-58806407eef3')
  and state='REVIEW';

insert into public.audit_log(organization_id, actor_user_id, action, record_type, record_id, new_data)
values ('e0000000-0000-4000-8000-000000000001', '614db7d9-f70b-4f8b-b0e2-d5c0190a06b3', 'EMAIL_SDR_POSITIVE_AUTO_CONFIGURED', 'organizations', 'e0000000-0000-4000-8000-000000000001',
  jsonb_build_object('source','migración 097','templates','positivos-v1-2026-09-30','canaries_required',2,'delay_minutes','10-25','window','08:00-18:00 L-V'));

commit;
