-- 094 · 180 correos por buzón, ventana 8:00-18:00 y rotación segura (29-sep-2026).
-- Generado por tools/correos/gen-094.py; ver el docstring del generador para el porqué de cada cambio.

begin;

set local app.operations_rpc_write = 'on';

-- Topes: el CHECK de la tabla permitía hasta 100.
alter table public.mailboxes drop constraint mailboxes_direct_lane_ramp_check;
alter table public.mailboxes add constraint mailboxes_direct_lane_ramp_check check (
  direct_lane_ramp_mode = any (array['AUTO','FIXED','SCHEDULE'])
  and direct_lane_fixed_cap between 0 and 200 and direct_lane_cap_max between 0 and 200
  and (direct_lane_ramp_schedule is null or (array_length(direct_lane_ramp_schedule,1) between 1 and 12
    and 0 <= all (direct_lane_ramp_schedule) and 200 >= all (direct_lane_ramp_schedule)))
  and (direct_lane_ramp_mode <> 'SCHEDULE' or direct_lane_ramp_schedule is not null));

-- Ventana de campaña propia del carril directo (la híbrida sigue igual para su motor).
create or replace function app.direct_lane_campaign_window_open(target_at timestamptz)
returns boolean language sql stable set search_path to 'pg_catalog' as $$
  select extract(isodow from (target_at at time zone 'America/Mexico_City')) between 1 and 5
    and (target_at at time zone 'America/Mexico_City')::time >= time '08:00'
    and (target_at at time zone 'America/Mexico_City')::time < time '18:00'
    and not exists (select 1 from app.dispatch_holidays h
                    where h.holiday_date = (target_at at time zone 'America/Mexico_City')::date)
$$;

CREATE OR REPLACE FUNCTION public.configure_direct_lane_mailbox(target_organization_id uuid, target_mailbox_id uuid, target_patch jsonb, target_reason text, target_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_temp'
AS $function$
declare actor uuid; request_sha text; replay jsonb; mailbox_record public.mailboxes%rowtype; new_status text; response jsonb;
begin
  actor := app.direct_lane_assert_operator(target_organization_id);
  request_sha := encode(digest(convert_to(concat_ws(E'\n','configure_direct_lane_mailbox',target_organization_id::text,
    target_mailbox_id::text,coalesce(target_patch::text,''),coalesce(target_reason,'')),'utf8'),'sha256'),'hex');
  replay := app.direct_lane_command_replay(target_organization_id,target_idempotency_key,request_sha);
  if replay is not null then return replay; end if;
  if length(btrim(coalesce(target_reason,'')))<3 then raise exception 'DIRECT_LANE_REASON_REQUIRED'; end if;
  if target_patch is null or jsonb_typeof(target_patch)<>'object' then raise exception 'DIRECT_LANE_PATCH_INVALID'; end if;
  if exists (select 1 from jsonb_object_keys(target_patch) k where k not in ('status','ramp_mode','fixed_cap','cap_max','display_name','ramp_schedule','ramp_anchor_at')) then
    raise exception 'DIRECT_LANE_PATCH_KEY_UNKNOWN';
  end if;
  select * into mailbox_record from public.mailboxes where organization_id=target_organization_id and id=target_mailbox_id for update;
  if not found then raise exception 'DIRECT_LANE_MAILBOX_NOT_FOUND'; end if;
  new_status := coalesce(target_patch->>'status',mailbox_record.direct_lane_status);
  if new_status='CONNECTED' and not exists (select 1 from public.direct_lane_credentials c
    where c.organization_id=target_organization_id and c.mailbox_id=target_mailbox_id and c.status='ACTIVE') then
    raise exception 'DIRECT_LANE_CREDENTIAL_MISSING';
  end if;
  if mailbox_record.direct_lane_status='KILLED' and new_status<>'KILLED'
    and not app.has_role(target_organization_id,array['teckel_admin']::public.user_role[]) then
    raise exception 'DIRECT_LANE_UNKILL_REQUIRES_ADMIN';
  end if;
  -- Grant, 7-sep: el buzon principal del cliente puede llegar a 25 contactos
  -- nuevos al dia; con seguimientos, techo total 60 (era 20).
  if coalesce(target_patch->>'ramp_mode',mailbox_record.direct_lane_ramp_mode)='SCHEDULE'
    and not (target_patch ? 'ramp_schedule') and mailbox_record.direct_lane_ramp_schedule is null then
    raise exception 'DIRECT_LANE_RAMP_SCHEDULE_REQUIRED';
  end if;
  if mailbox_record.eligibility_route='EXISTING_PRIMARY_GMAIL_RAMP'
    and coalesce((target_patch->>'cap_max')::integer,mailbox_record.direct_lane_cap_max)>200 then
    raise exception 'DIRECT_LANE_CLIENT_MAILBOX_CAP_LIMIT';
  end if;
  update public.mailboxes set
    direct_lane_status=new_status,
    direct_lane_ramp_mode=coalesce(target_patch->>'ramp_mode',direct_lane_ramp_mode),
    direct_lane_fixed_cap=coalesce((target_patch->>'fixed_cap')::integer,direct_lane_fixed_cap),
    direct_lane_cap_max=coalesce((target_patch->>'cap_max')::integer,direct_lane_cap_max),
    direct_lane_display_name=coalesce(nullif(btrim(target_patch->>'display_name'),''),direct_lane_display_name),
    direct_lane_ramp_schedule=case when target_patch ? 'ramp_schedule'
      then (select array_agg((t.x)::integer order by t.ord) from jsonb_array_elements_text(target_patch->'ramp_schedule') with ordinality as t(x,ord))
      else direct_lane_ramp_schedule end,
    direct_lane_ramp_anchor_at=case when target_patch ? 'ramp_anchor_at' then (target_patch->>'ramp_anchor_at')::timestamptz else direct_lane_ramp_anchor_at end,
    updated_at=clock_timestamp()
  where organization_id=target_organization_id and id=target_mailbox_id
  returning * into mailbox_record;
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,record_id,new_data)
  values (target_organization_id,actor,'DIRECT_LANE_MAILBOX_CONFIGURED','mailboxes',target_mailbox_id,
    jsonb_build_object('patch',target_patch,'reason',btrim(target_reason)));
  response := jsonb_build_object('status','CONFIGURED','mailbox',app.direct_lane_mailbox_json(mailbox_record));
  return app.direct_lane_command_record(target_organization_id,'CONFIGURE_MAILBOX',target_idempotency_key,request_sha,response,actor);
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
      if budget_spent then return app.direct_lane_noop(target_organization_id,target_mailbox_id,'BUDGET_EXHAUSTED',null); end if;
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

CREATE OR REPLACE FUNCTION public.autoenroll_direct_lane(target_organization_id uuid, target_mailbox_id uuid, proof_command_id text, proof_nonce uuid, proof_expires_at timestamp with time zone, proof_signature text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_temp'
AS $function$
declare payload_sha text; mailbox_record public.mailboxes%rowtype; campaign_id uuid; room integer; pending_new integer; response jsonb;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n','autoenroll_direct_lane',target_organization_id::text,target_mailbox_id::text),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  select * into mailbox_record from public.mailboxes where organization_id=target_organization_id and id=target_mailbox_id;
  if not found or mailbox_record.direct_lane_status<>'CONNECTED' then return jsonb_build_object('status','SKIPPED','reason','MAILBOX_NOT_CONNECTED'); end if;
  select c.id into campaign_id from public.campaigns c where c.organization_id=target_organization_id and c.lane='DIRECT' and c.direct_lane_state='RUNNING'
    order by c.approved_at desc nulls last limit 1;
  if campaign_id is null then return jsonb_build_object('status','SKIPPED','reason','NO_RUNNING_CAMPAIGN'); end if;
  -- cupo = tope de nuevos del dia - nuevos ya enviados hoy - toques 1 ya en cola para este buzon
  select count(*) into pending_new from public.campaign_enrollments e
    where e.organization_id=target_organization_id and e.mailbox_id=target_mailbox_id and e.status='PENDING' and e.next_touch_number=1
      and coalesce(e.next_touch_at,clock_timestamp()) < (((clock_timestamp() at time zone 'America/Mexico_City')::date + 1)::timestamp at time zone 'America/Mexico_City');
  room := app.direct_lane_effective_cap(mailbox_record) - app.direct_lane_new_today(target_organization_id,target_mailbox_id) - pending_new;
  if room<=0 then return jsonb_build_object('status','SKIPPED','reason','NO_ROOM','pending_new',pending_new); end if;
  response := app.direct_lane_enroll_core(target_organization_id,campaign_id,target_mailbox_id,null,room,null,'DIRECT_LANE_CONTACTS_AUTOENROLLED');
  return response || jsonb_build_object('room',room,'pending_new',pending_new);
end $function$;

CREATE OR REPLACE FUNCTION app.direct_lane_rotate(target_enrollment_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_temp'
AS $function$
declare
  e public.campaign_enrollments%rowtype;
  rot public.campaigns%rowtype;
  ct public.contacts%rowtype;
  acc public.accounts%rowtype;
  next_round smallint;
  version_value integer;
  version_id uuid;
  wait_days integer;
  used uuid[];
  ordered uuid[];
  current_idx integer;
  total integer;
  chosen uuid;
  last_sent timestamptz;
  start_at timestamptz;
  new_id uuid;
begin
  select * into e from public.campaign_enrollments where id = target_enrollment_id;
  if not found then return null; end if;
  next_round := e.rotation_round + 1;

  -- La campaña que lleva las rondas es la última aprobada en marcha que declara rotación.
  select * into rot from public.campaigns c
  where c.organization_id = e.organization_id and c.lane = 'DIRECT' and c.direct_lane_state = 'RUNNING'
    and c.manifest_json ? 'rotation'
  order by c.approved_at desc nulls last limit 1;
  if not found then return null; end if;

  select (r->>'version')::integer into version_value
  from jsonb_array_elements(rot.manifest_json->'rotation'->'rounds') r
  where (r->>'round')::integer = next_round;
  if version_value is null then return null; end if; -- ya se usaron todas las rondas

  select sv.id into version_id from public.sequence_versions sv
  where sv.organization_id = e.organization_id and sv.campaign_id = rot.id and sv.version = version_value;
  if version_id is null then return null; end if;

  select * into ct from public.contacts where id = e.contact_id;
  select * into acc from public.accounts where id = e.account_id;
  if ct.id is null or acc.id is null or not ct.verified or ct.is_deleted or acc.is_deleted
    or app.is_suppressed(e.organization_id, acc.id, ct.normalized_email, acc.primary_domain) then
    return null;
  end if;
  -- Nada de rotar a quien ya respondió, rebotó o pidió baja, ni a quien ya tiene otra ronda abierta.
  if exists (select 1 from public.campaign_enrollments x
    where x.organization_id = e.organization_id and x.contact_id = e.contact_id
      and x.status in ('PENDING', 'ACTIVE', 'PAUSED', 'REPLIED', 'BOUNCED', 'UNSUBSCRIBED', 'SUPPRESSED')) then
    return null;
  end if;

  -- Siguiente buzón conectado, en orden, que todavía no le haya escrito a este contacto.
  select array_agg(distinct x.mailbox_id) into used from public.campaign_enrollments x
  where x.organization_id = e.organization_id and x.contact_id = e.contact_id;
  select array_agg(m.id order by m.normalized_email) into ordered from public.mailboxes m
  where m.organization_id = e.organization_id and m.direct_lane_status = 'CONNECTED';
  total := coalesce(cardinality(ordered), 0);
  current_idx := coalesce(array_position(ordered, e.mailbox_id), 0);
  for i in 1..total loop
    chosen := ordered[1 + mod(current_idx - 1 + i, total)];
    exit when not (chosen = any (coalesce(used, '{}'::uuid[])));
    chosen := null;
  end loop;
  if chosen is null then return null; end if;

  wait_days := coalesce((rot.manifest_json->'rotation'->>'wait_days')::integer, 7);
  select max(m.sent_at) into last_sent from public.messages m
  where m.organization_id = e.organization_id and m.enrollment_id = e.id and m.direction = 'OUTBOUND';
  start_at := greatest(coalesce(last_sent, clock_timestamp()) + make_interval(days => wait_days), clock_timestamp());

  -- Si una compuerta (p. ej. la autorización por contacto) rechaza la ronda, se salta y queda en
  -- bitácora. Esta función corre dentro del settle del toque 4: una excepción aquí tumbaría el
  -- registro de un correo que Gmail ya aceptó.
  begin
    insert into public.campaign_enrollments(organization_id, campaign_id, sequence_version_id, account_id, contact_id,
      mailbox_id, status, next_touch_number, next_touch_at, rotation_round, rotation_origin_id)
    values (e.organization_id, rot.id, version_id, e.account_id, e.contact_id,
      chosen, 'PENDING', 1, start_at, next_round, coalesce(e.rotation_origin_id, e.id))
    returning id into new_id;
  exception when others then
    insert into public.audit_log(organization_id, action, record_type, record_id, new_data)
    values (e.organization_id, 'DIRECT_LANE_ROTATION_SKIPPED', 'campaign_enrollments', e.id,
      jsonb_build_object('round', next_round, 'reason', left(sqlerrm, 200)));
    return null;
  end;

  insert into public.audit_log(organization_id, action, record_type, record_id, new_data)
  values (e.organization_id, 'DIRECT_LANE_ROTATION_SCHEDULED', 'campaign_enrollments', new_id,
    jsonb_build_object('from_enrollment', e.id, 'round', next_round, 'mailbox_id', chosen, 'starts_at', start_at));
  return new_id;
end $function$;

update public.mailboxes set direct_lane_ramp_mode='FIXED', direct_lane_fixed_cap=180, direct_lane_cap_max=180, updated_at=clock_timestamp()
where organization_id='e0000000-0000-4000-8000-000000000001' and direct_lane_status is not null;

insert into public.audit_log(organization_id, actor_user_id, action, record_type, record_id, new_data)
values ('e0000000-0000-4000-8000-000000000001', '614db7d9-f70b-4f8b-b0e2-d5c0190a06b3', 'DIRECT_LANE_VOLUME_180', 'organizations',
  'e0000000-0000-4000-8000-000000000001',
  jsonb_build_object('cap', 180, 'window', '08:00-18:00', 'pace_seconds', '120-210', 'source', 'migración 094'));

commit;
