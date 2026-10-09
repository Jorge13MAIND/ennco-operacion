-- 105 · Oscar en copia, avisos con contexto y alertas por Telegram (9-oct-2026).
-- Generado por tools/correos/gen-105.py desde tools/correos/vivas-105/. Ver el docstring del generador.

begin;

set local app.operations_rpc_write = 'on';

alter table app.email_sdr_settings
  add column if not exists reply_cc_emails text[] not null default '{}',
  add column if not exists alert_cc_emails text[] not null default '{}',
  add column if not exists telegram_chat_ids text[] not null default '{}';

update app.email_sdr_settings
set reply_cc_emails = array['oscar.ojeda@ennco.com.mx'], alert_cc_emails = array['oscar.ojeda@ennco.com.mx'], updated_at = clock_timestamp()
where organization_id = 'e0000000-0000-4000-8000-000000000001';

-- CC del correo automático: el de la campaña (Paco) y después los de la configuración (Oscar), sin repetir.
create or replace function app.email_sdr_reply_cc(campaign_cc text, extra text[])
returns text[] language sql immutable set search_path to 'pg_catalog' as $$
  select coalesce(array_agg(x order by min_pos), '{}'::text[]) from (
    select lower(btrim(v)) x, min(pos) min_pos
    from unnest(array[campaign_cc] || coalesce(extra, '{}'::text[])) with ordinality as u(v, pos)
    where nullif(btrim(v), '') is not null
    group by lower(btrim(v))) s;
$$;

update app.email_sdr_templates
set body = E'Perfecto {{first_name}},\n\nPongo en CC a mi asistente Oscar, él se encargará de coordinar los detalles.\n\n¿Nos harías favor de compartirnos tu número de teléfono con WhatsApp?\n\nSaludos,\nIng. Francisco Cuellar', version = 'positivos-v3-2026-10-09', approved_by = 'Grant (9-oct)', approved_at = clock_timestamp();

-- Todo lo que una persona necesita para entender un caso sin abrir el Control Room.
create or replace function app.email_sdr_case_context(target_org uuid, target_case uuid)
returns jsonb language sql stable security definer set search_path to 'public', 'app', 'pg_temp' as $$
  select jsonb_build_object(
    'contact_name', ct.full_name, 'contact_role', ct.role_title, 'contact_email', ct.normalized_email,
    'account_name', a.legal_name, 'account_city', a.city, 'account_state', a.state,
    'mailbox_email', mb.normalized_email, 'received_at', coalesce(e.observed_at, im.created_at),
    'subject', im.subject, 'body', left(im.body_text, 6000),
    'touch_number', (select o.touch_number from public.messages o
      where o.organization_id = e.organization_id and o.id = (e.payload_json->>'related_outbound_message_id')::uuid),
    'event_kind', e.event_kind, 'intent', sc.decision->>'intent', 'subtype', sc.decision->>'subtype',
    'state', sc.state, 'next_action', sc.next_action, 'send_after', sc.send_after,
    'reply_status', r.status, 'reply_sent_at', r.sent_at, 'reply_cc', to_jsonb(r.cc_emails),
    'reply_cc_planned', to_jsonb(app.email_sdr_reply_cc(ca.manifest_json->>'cc_on_reply_email', s.reply_cc_emails)))
  from public.email_sdr_cases sc
  join public.provider_events e on e.organization_id = sc.organization_id and e.id = sc.provider_event_id
  join public.messages im on im.organization_id = e.organization_id and im.id = e.message_id
  join public.contacts ct on ct.organization_id = im.organization_id and ct.id = im.contact_id
  join public.accounts a on a.organization_id = ct.organization_id and a.id = ct.account_id
  left join public.mailboxes mb on mb.organization_id = im.organization_id and mb.id = im.mailbox_id
  left join public.campaign_enrollments ce on ce.organization_id = im.organization_id and ce.id = im.enrollment_id
  left join public.campaigns ca on ca.organization_id = ce.organization_id and ca.id = ce.campaign_id
  left join public.messages r on r.organization_id = sc.organization_id and r.id = sc.message_id
  left join app.email_sdr_settings s on s.organization_id = sc.organization_id
  where sc.organization_id = target_org and sc.id = target_case;
$$;
revoke all on function app.email_sdr_case_context(uuid, uuid) from public, anon, authenticated;

-- Cola de Telegram: un renglón por caso positivo y chat. Solo positivos de las últimas 24 horas.
create table if not exists app.email_sdr_telegram_dispatch (
  organization_id uuid not null,
  case_id uuid not null references public.email_sdr_cases(id),
  chat_id text not null check (chat_id ~ '^-?[0-9]{1,20}$'),
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  primary key (organization_id, case_id, chat_id)
);
alter table app.email_sdr_telegram_dispatch enable row level security;
revoke all on app.email_sdr_telegram_dispatch from public, anon, authenticated;

create or replace function app.email_sdr_telegram_work(target_org uuid)
returns jsonb language plpgsql security definer set search_path to 'public', 'app', 'pg_temp' as $$
declare row_value record; items jsonb := '[]'::jsonb; claimed integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('email-sdr-telegram:' || target_org::text, 0));
  for row_value in
    select sc.id case_id, chat.chat_id
    from public.email_sdr_cases sc
    join public.provider_events e on e.organization_id = sc.organization_id and e.id = sc.provider_event_id
    join app.email_sdr_settings s on s.organization_id = sc.organization_id
    cross join lateral unnest(s.telegram_chat_ids) as chat(chat_id)
    where sc.organization_id = target_org and e.event_kind = 'REPLY'
      and sc.decision->>'subtype' in ('POSITIVE_ACCEPT', 'POSITIVE_VISIT')
      and sc.created_at > clock_timestamp() - interval '24 hours'
      and not exists (select 1 from app.email_sdr_telegram_dispatch d where d.organization_id = sc.organization_id
        and d.case_id = sc.id and d.chat_id = chat.chat_id
        and (d.delivered_at is not null or d.attempts >= 20 or d.last_attempt_at > clock_timestamp() - interval '4 minutes'))
    order by sc.created_at limit 20
  loop
    insert into app.email_sdr_telegram_dispatch (organization_id, case_id, chat_id, attempts, last_attempt_at)
    values (target_org, row_value.case_id, row_value.chat_id, 1, clock_timestamp())
    on conflict (organization_id, case_id, chat_id) do update
      set attempts = app.email_sdr_telegram_dispatch.attempts + 1, last_attempt_at = clock_timestamp()
    returning attempts into claimed;
    items := items || jsonb_build_array(jsonb_build_object('case_id', row_value.case_id, 'chat_id', row_value.chat_id,
      'attempt', claimed, 'context', app.email_sdr_case_context(target_org, row_value.case_id)));
  end loop;
  return jsonb_build_object('status', 'TELEGRAM_WORK', 'items', items);
end $$;
revoke all on function app.email_sdr_telegram_work(uuid) from public, anon, authenticated;

create or replace function app.email_sdr_telegram_settle(target_org uuid, target_case uuid, target_chat text, delivered boolean, error_text text)
returns jsonb language plpgsql security definer set search_path to 'public', 'app', 'pg_temp' as $$
begin
  update app.email_sdr_telegram_dispatch
  set delivered_at = case when delivered then clock_timestamp() else delivered_at end,
      last_error = case when delivered then null else left(error_text, 300) end
  where organization_id = target_org and case_id = target_case and chat_id = target_chat;
  if not found then raise exception 'SDR_TELEGRAM_NOT_CLAIMED'; end if;
  return jsonb_build_object('status', 'SETTLED');
end $$;
revoke all on function app.email_sdr_telegram_settle(uuid, uuid, text, boolean, text) from public, anon, authenticated;

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
        'owner_email',row_value.owner_email,'backup_email',row_value.backup_email,
        'cc_emails',(select to_jsonb(coalesce(s.alert_cc_emails,'{}'::text[])) from app.email_sdr_settings s where s.organization_id=target_org),
        'context',app.email_sdr_case_context(target_org,row_value.id)));
    end if;
    claimed:=null;
  end loop;
  return jsonb_build_object('status','ALERT_WORK','alerts',pending,
    'oldest_pending_minutes',coalesce(oldest_seconds/60,0));
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

insert into public.audit_log (organization_id, action, record_type, new_data)
values ('e0000000-0000-4000-8000-000000000001', 'EMAIL_SDR_OSCAR_CONTEXT_TELEGRAM', 'email_sdr_settings',
  jsonb_build_object('source', 'migración 105', 'reply_cc', 'Paco + Oscar', 'template', 'positivos-v3-2026-10-09',
    'alerts', 'con contexto del caso y Oscar en copia', 'telegram', 'cola por caso y chat',
    'order', 'Grant 9-oct'));

commit;
