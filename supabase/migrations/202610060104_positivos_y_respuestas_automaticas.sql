-- 104 · Positivos inmediatos y respuestas automáticas (6-oct-2026).
-- Generado por tools/correos/gen-104.py desde tools/correos/vivas-104/. Ver el docstring del generador.

begin;

set local app.operations_rpc_write = 'on';

-- Referidos que deja un contacto que ya no está. Paco decide; nadie les escribe solo.
create table if not exists public.email_contact_referrals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  contact_id uuid not null references public.contacts(id),
  account_id uuid references public.accounts(id),
  referred_email text not null check (referred_email ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$'),
  source_provider_event_id uuid references public.provider_events(id),
  status text not null default 'PENDING' check (status in ('PENDING','CONTACTED','DISCARDED')),
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, contact_id, referred_email)
);
alter table public.email_contact_referrals enable row level security;
drop policy if exists email_contact_referrals_read on public.email_contact_referrals;
create policy email_contact_referrals_read on public.email_contact_referrals for select using (app.is_member(organization_id));
revoke all on public.email_contact_referrals from anon, authenticated;
grant select on public.email_contact_referrals to authenticated;

-- Día y hora en que se retoma: el día hábil siguiente al regreso (o 7 días después si no hay fecha),
-- nunca antes de hoy, a las 9:00 de la Ciudad de México.
create or replace function app.direct_lane_ooo_resume_at(observed_at timestamptz, return_date date)
returns timestamptz language plpgsql stable set search_path to 'pg_catalog', 'app' as $$
declare d date;
begin
  d := coalesce(return_date + 1, (observed_at at time zone 'America/Mexico_City')::date + 7);
  d := greatest(d, (clock_timestamp() at time zone 'America/Mexico_City')::date);
  while extract(isodow from d) > 5 or exists (select 1 from app.dispatch_holidays h where h.holiday_date = d) loop
    d := d + 1;
  end loop;
  return (d + time '09:00') at time zone 'America/Mexico_City';
end $$;

create or replace function app.direct_lane_handle_auto_reply(target_organization_id uuid, target_mailbox_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'app', 'extensions', 'pg_temp' as $$
declare
  kind text := p->>'kind';
  from_email text := lower(btrim(p->>'from_email'));
  observed timestamptz := to_timestamp((p->>'observed_at_epoch')::double precision);
  return_on date := nullif(p->>'return_date', '')::date;
  outbound public.messages%rowtype;
  e public.campaign_enrollments%rowtype;
  ct public.contacts%rowtype;
  applied jsonb;
  resume_at timestamptz;
  referral text;
  saved integer := 0;
  touched integer := 0;
  outcome text;
begin
  if kind not in ('OOO', 'GONE') or from_email is null or nullif(p->>'provider_message_id', '') is null or observed is null then
    raise exception 'AUTO_REPLY_INVALID';
  end if;
  if exists (select 1 from public.provider_events where organization_id = target_organization_id and source = 'gmail'
      and source_record_type = 'message' and external_event_id = p->>'provider_message_id') then
    return jsonb_build_object('status', 'DUPLICATE');
  end if;

  if nullif(p->>'related_outbound_id', '') is not null then
    select * into outbound from public.messages
    where organization_id = target_organization_id and id = (p->>'related_outbound_id')::uuid
      and mailbox_id = target_mailbox_id and direction = 'OUTBOUND';
  else
    -- Outlook la manda fuera del hilo: se enlaza con lo último que este buzón le envió a ese remitente.
    select * into outbound from public.messages
    where organization_id = target_organization_id and mailbox_id = target_mailbox_id and direction = 'OUTBOUND'
      and lane = 'DIRECT' and enrollment_id is not null and normalized_to = from_email and status in ('SENT', 'DELIVERED')
      and sent_at > observed - interval '45 days' and sent_at <= observed + interval '5 minutes'
    order by sent_at desc limit 1;
  end if;
  if outbound.id is null then return jsonb_build_object('status', 'NO_MATCH'); end if;
  select * into e from public.campaign_enrollments where organization_id = target_organization_id and id = outbound.enrollment_id for update;
  select * into ct from public.contacts where organization_id = target_organization_id and id = e.contact_id;
  if e.id is null or ct.normalized_email is distinct from from_email then return jsonb_build_object('status', 'NO_MATCH'); end if;

  -- El evento canónico (mensaje, bitácora, aviso) lo registra la máquina de siempre; después se corrige
  -- la pausa indefinida que esa máquina pone a toda respuesta automática.
  applied := app.apply_mailbox_provider_event(target_organization_id, target_mailbox_id, p->>'provider_message_id',
    p->>'provider_message_id', outbound.id, 'AUTO_REPLY', 'NOT_APPLICABLE', from_email, left(p->>'subject', 1000),
    left(p->>'body_text', 100000), observed, gen_random_uuid());
  if applied->>'status' is distinct from 'PROCESSED' then return applied; end if;

  if kind = 'GONE' then
    update public.campaign_enrollments x
    set status = case when x.id = e.id and e.status in ('REPLIED', 'BOUNCED', 'UNSUBSCRIBED', 'SUPPRESSED') then e.status else 'COMPLETED' end,
      stopped_reason = case when x.id = e.id and e.status in ('REPLIED', 'BOUNCED', 'UNSUBSCRIBED', 'SUPPRESSED') then e.stopped_reason else 'CONTACT_GONE' end,
      next_touch_at = null, updated_at = clock_timestamp()
    where x.organization_id = target_organization_id and x.contact_id = e.contact_id
      and (x.id = e.id or x.status in ('PENDING', 'ACTIVE', 'PAUSED'));
    get diagnostics touched = row_count;
    insert into public.suppression_entries (organization_id, kind, account_id, normalized_email, normalized_domain, reason)
    values (target_organization_id, 'MANUAL', null, from_email, null, 'CONTACT_GONE_AUTO_REPLY') on conflict do nothing;
    for referral in select distinct lower(btrim(x)) from jsonb_array_elements_text(coalesce(p->'referrals', '[]'::jsonb)) x limit 5 loop
      if referral ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$' and referral <> from_email then
        insert into public.email_contact_referrals (organization_id, contact_id, account_id, referred_email, source_provider_event_id)
        values (target_organization_id, e.contact_id, e.account_id, referral, (applied->>'provider_event_id')::uuid)
        on conflict do nothing;
        if found then saved := saved + 1; end if;
      end if;
    end loop;
    outcome := 'GONE_STOPPED';
  else
    resume_at := app.direct_lane_ooo_resume_at(observed, return_on);
    if e.status in ('PENDING', 'ACTIVE')
      or (e.status = 'PAUSED' and (e.stopped_reason = 'AUTO_REPLY_REVIEW' or e.stopped_reason like 'EMAIL_RECOVERY%')) then
      -- El siguiente toque sale el día que regresa. Si ya regresó, la secuencia sigue como iba.
      update public.campaign_enrollments
      set status = case when e.status = 'PENDING' then 'PENDING'::public.enrollment_status else 'ACTIVE'::public.enrollment_status end,
        stopped_reason = null,
        next_touch_at = case when resume_at > clock_timestamp() then resume_at
          when e.status = 'PAUSED' then clock_timestamp() else e.next_touch_at end,
        updated_at = clock_timestamp()
      where id = e.id;
      outcome := case when resume_at > clock_timestamp() then 'OOO_RESCHEDULED' else 'OOO_RESUMED' end;
    else
      update public.campaign_enrollments
      set status = e.status, stopped_reason = e.stopped_reason, next_touch_at = e.next_touch_at, updated_at = clock_timestamp()
      where id = e.id;
      outcome := 'OOO_RECORDED';
      -- Llegó en el toque 4: la siguiente ronda (otro buzón) arranca el día que regresa.
      if e.status = 'COMPLETED' and resume_at > clock_timestamp() then
        update public.campaign_enrollments x set next_touch_at = resume_at, updated_at = clock_timestamp()
        where x.organization_id = target_organization_id and x.contact_id = e.contact_id and x.status = 'PENDING'
          and x.rotation_round > e.rotation_round
          and not exists (select 1 from public.messages m where m.organization_id = x.organization_id
            and m.enrollment_id = x.id and m.direction = 'OUTBOUND');
        get diagnostics touched = row_count;
        if touched > 0 then outcome := 'OOO_NEXT_ROUND_RESCHEDULED'; end if;
      end if;
    end if;
  end if;

  -- La tarea de "revisar respuesta automática" ya no hace falta: quedó resuelta aquí.
  if applied->>'task_id' is not null then
    update public.tasks set status = 'CANCELLED' where id = (applied->>'task_id')::uuid and status = 'OPEN';
  end if;
  update public.provider_events
  set payload_json = payload_json || jsonb_strip_nulls(jsonb_build_object('auto_handled', kind, 'outcome', outcome,
    'return_date', return_on, 'resume_at', resume_at))
  where id = (applied->>'provider_event_id')::uuid;
  insert into public.audit_log (organization_id, action, record_type, record_id, new_data)
  values (target_organization_id, 'DIRECT_LANE_AUTO_REPLY_HANDLED', 'campaign_enrollments', e.id,
    jsonb_strip_nulls(jsonb_build_object('kind', kind, 'outcome', outcome, 'return_date', return_on, 'resume_at', resume_at,
      'referrals_saved', saved, 'provider_event_id', applied->>'provider_event_id')));
  return jsonb_strip_nulls(jsonb_build_object('status', outcome, 'provider_event_id', applied->>'provider_event_id',
    'enrollment_id', e.id, 'resume_at', resume_at, 'referrals_saved', saved));
end $$;
revoke all on function app.direct_lane_handle_auto_reply(uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function public.apply_direct_lane_auto_reply(target_organization_id uuid, target_mailbox_id uuid, target_payload text,
  proof_command_id text, proof_nonce uuid, proof_expires_at timestamptz, proof_signature text)
returns jsonb language plpgsql security definer set search_path to 'public', 'app', 'extensions', 'pg_temp' as $$
declare payload_sha text;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n', 'apply_direct_lane_auto_reply', target_organization_id::text, target_mailbox_id::text,
    encode(digest(convert_to(target_payload, 'utf8'), 'sha256'), 'hex')), 'utf8'), 'sha256'), 'hex');
  perform app.verify_dispatch_proof(target_organization_id, proof_command_id, proof_nonce, proof_expires_at, payload_sha, proof_signature);
  if octet_length(target_payload) > 200000 then raise exception 'AUTO_REPLY_PAYLOAD_LIMIT'; end if;
  if not exists (select 1 from public.mailboxes where organization_id = target_organization_id and id = target_mailbox_id) then
    raise exception 'AUTO_REPLY_MAILBOX_MISMATCH';
  end if;
  return app.direct_lane_handle_auto_reply(target_organization_id, target_mailbox_id, target_payload::jsonb);
end $$;
revoke all on function public.apply_direct_lane_auto_reply(uuid, uuid, text, text, uuid, timestamptz, text) from public;
grant execute on function public.apply_direct_lane_auto_reply(uuid, uuid, text, text, uuid, timestamptz, text) to anon, authenticated;

-- Lead positivo en cuanto el SDR decide: respuesta POSITIVE, lead y oportunidad en CONVERSATION.
-- No confirma avisos: eso lo hace app.email_sdr_mark_positive cuando el correo ya salió.
create or replace function app.email_sdr_classify_positive(target_org uuid, target_case uuid)
returns void language plpgsql security definer set search_path to 'public', 'app', 'extensions', 'pg_temp' as $$
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
end $$;
revoke all on function app.email_sdr_classify_positive(uuid, uuid) from public, anon, authenticated;

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

insert into public.audit_log (organization_id, action, record_type, new_data)
select s.organization_id, 'EMAIL_SDR_POLICY_EXPANDED', 'email_sdr_settings',
  jsonb_build_object('source', 'migración 104', 'positives', 'todo lo no negativo', 'auto_replies', 'OOO reprograma, GONE detiene y guarda referidos',
    'order', 'Grant 6-oct: prefiero falsos positivos; fuera de oficina retoma el día hábil siguiente al regreso')
from app.email_sdr_settings s;

commit;
