-- 107 · Sync resistente y primeros toques (12-oct-2026). Generado por tools/correos/gen-107.py desde
-- tools/correos/vivas-107/. Ver el docstring del generador.

begin;

set local app.operations_rpc_write = 'on';

create or replace function public.record_direct_lane_sync_error(target_organization_id uuid, target_mailbox_id uuid,
  target_error_code text, target_detail text, proof_command_id text, proof_nonce uuid, proof_expires_at timestamptz, proof_signature text)
returns jsonb language plpgsql security definer set search_path to 'public', 'app', 'extensions', 'pg_temp' as $$
declare payload_sha text; code text; previous text;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n', 'record_direct_lane_sync_error', target_organization_id::text,
    target_mailbox_id::text, coalesce(target_error_code, ''), coalesce(target_detail, '')), 'utf8'), 'sha256'), 'hex');
  perform app.verify_dispatch_proof(target_organization_id, proof_command_id, proof_nonce, proof_expires_at, payload_sha, proof_signature);
  code := left(regexp_replace(upper(coalesce(target_error_code, 'SYNC_FAILED')), '[^A-Z0-9_]', '_', 'g'), 64);
  if length(code) < 3 then code := 'SYNC_FAILED'; end if;
  select last_error_code into previous from public.mailbox_sync_cursors
  where organization_id = target_organization_id and mailbox_id = target_mailbox_id;
  update public.mailbox_sync_cursors set last_error_code = code, updated_at = clock_timestamp()
  where organization_id = target_organization_id and mailbox_id = target_mailbox_id;
  if not found then raise exception 'DIRECT_LANE_SYNC_CURSOR_NOT_FOUND'; end if;
  if previous is distinct from code then
    insert into public.audit_log (organization_id, action, record_type, record_id, new_data)
    values (target_organization_id, 'DIRECT_LANE_SYNC_FAILED', 'mailboxes', target_mailbox_id,
      jsonb_build_object('error_code', code, 'detail', left(target_detail, 300)));
  end if;
  return jsonb_build_object('status', 'RECORDED', 'error_code', code);
end $$;
revoke all on function public.record_direct_lane_sync_error(uuid, uuid, text, text, text, uuid, timestamptz, text) from public;
grant execute on function public.record_direct_lane_sync_error(uuid, uuid, text, text, text, uuid, timestamptz, text) to anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_email_recovery(target_organization_id uuid, target_mailbox_id uuid, target_payload text, proof_command_id text, proof_nonce uuid, proof_expires_at timestamp with time zone, proof_signature text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_temp'
AS $function$
declare payload_sha text; p jsonb; e public.provider_events%rowtype; m public.messages%rowtype; thread_id text;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n','record_email_recovery',target_organization_id::text,target_mailbox_id::text,
    encode(digest(convert_to(target_payload,'utf8'),'sha256'),'hex')),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  if octet_length(target_payload)>1000000 then raise exception 'RECOVERY_PAYLOAD_LIMIT'; end if;
  if not exists(select 1 from public.mailboxes where organization_id=target_organization_id and id=target_mailbox_id) then raise exception 'RECOVERY_MAILBOX_MISMATCH'; end if;
  p := target_payload::jsonb;
  if p->>'kind'='DELIVERY' then
    if not exists(select 1 from public.messages o where o.organization_id=target_organization_id and o.id=(p->>'outbound_id')::uuid
      and o.mailbox_id=target_mailbox_id and o.direction='OUTBOUND' and o.provider_thread_id=p->>'provider_thread_id') then raise exception 'RECOVERY_OUTBOUND_MISMATCH'; end if;
    insert into public.email_delivery_diagnostics(organization_id,mailbox_id,provider_message_id,outbound_id,category,smtp_status,body_text)
    values(target_organization_id,target_mailbox_id,p->>'provider_message_id',(p->>'outbound_id')::uuid,p->>'category',p->>'smtp_status',p->>'body_text')
    on conflict(organization_id,mailbox_id,provider_message_id) do nothing;
    return jsonb_build_object('status','DIAGNOSTIC_RECORDED');
  elsif p->>'kind'='UNMATCHED' then
    if exists(select 1 from public.contacts ct join public.campaign_enrollments ce on ce.organization_id=ct.organization_id and ce.contact_id=ct.id
      join public.campaigns ca on ca.organization_id=ce.organization_id and ca.id=ce.campaign_id
      where ct.organization_id=target_organization_id and ct.normalized_email=lower(p->>'from_email') and ca.lane='DIRECT' and ca.name !~* '^PRUEBA') then
      insert into public.email_recovery_review(organization_id,mailbox_id,provider_message_id,provider_thread_id,normalized_from,subject,body_text)
      values(target_organization_id,target_mailbox_id,p->>'provider_message_id',p->>'provider_thread_id',lower(p->>'from_email'),p->>'subject',p->>'body_text')
      on conflict(organization_id,mailbox_id,provider_message_id) do nothing;
      return jsonb_build_object('status','UNMATCHED_REVIEW_REQUIRED');
    end if;
    return jsonb_build_object('status','UNRELATED');
  elsif p->>'kind'='FAILED' then
    -- 12-oct: un correo que la base no aceptó se guarda siempre para revisión y el sync sigue.
    insert into public.email_recovery_review(organization_id,mailbox_id,provider_message_id,provider_thread_id,normalized_from,subject,body_text,next_action)
    values(target_organization_id,target_mailbox_id,p->>'provider_message_id',p->>'provider_thread_id',lower(p->>'from_email'),
      left(p->>'subject',1000),left(p->>'body_text',100000),
      left('No se pudo procesar solo ('||coalesce(p->>'error','sin código')||'). Revisar y decidir.',300))
    on conflict(organization_id,mailbox_id,provider_message_id) do nothing;
    insert into public.audit_log(organization_id,action,record_type,record_id,new_data)
      values(target_organization_id,'EMAIL_RECOVERY_FAILED_MESSAGE','mailboxes',target_mailbox_id,
        jsonb_build_object('error',left(p->>'error',200),'service','direct-lane-sync'));
    return jsonb_build_object('status','FAILED_REVIEW_REQUIRED');
  elsif p->>'kind'='MESSAGE' then
    select * into e from public.provider_events where organization_id=target_organization_id and id=(p->>'event_id')::uuid;
    select * into m from public.messages where organization_id=target_organization_id and id=e.message_id and mailbox_id=target_mailbox_id and direction='INBOUND';
    if m.id is null or m.provider_message_id is distinct from p->>'provider_message_id' then raise exception 'RECOVERY_EVENT_MISMATCH'; end if;
    thread_id := p->>'provider_thread_id';
    if thread_id is null or not exists(select 1 from public.messages o where o.organization_id=target_organization_id
      and o.id=(e.payload_json->>'related_outbound_message_id')::uuid and o.mailbox_id=target_mailbox_id
      and o.direction='OUTBOUND' and o.provider_thread_id=thread_id) then raise exception 'RECOVERY_THREAD_MISMATCH'; end if;
    if jsonb_typeof(p->'thread'->'messages')<>'array' or p->'thread'->>'id' is distinct from thread_id
      or not exists(select 1 from jsonb_array_elements(p->'thread'->'messages') j where j->>'id'=m.provider_message_id)
      then raise exception 'RECOVERY_THREAD_INCOMPLETE'; end if;
    if nullif(btrim(p->>'body_text'),'') is null then raise exception 'RECOVERY_BODY_MISSING'; end if;
    if m.body_text is not null and m.body_text<>p->>'body_text' then raise exception 'RECOVERY_BODY_CONFLICT'; end if;
    update public.messages set body_text=p->>'body_text',provider_thread_id=thread_id,
      rfc_message_id=coalesce(p->>'rfc_message_id',rfc_message_id),updated_at=clock_timestamp() where id=m.id;
    insert into public.email_conversations(organization_id,mailbox_id,provider_thread_id,thread_json,thread_sha256)
    values(target_organization_id,target_mailbox_id,thread_id,p->'thread',encode(digest(convert_to((p->'thread')::text,'utf8'),'sha256'),'hex'))
    on conflict(organization_id,mailbox_id,provider_thread_id) do update set
      thread_json=excluded.thread_json,thread_sha256=excluded.thread_sha256,captured_at=clock_timestamp();
    insert into public.audit_log(organization_id,action,record_type,record_id,new_data)
      values(target_organization_id,'EMAIL_RECOVERY_MESSAGE','messages',m.id,jsonb_build_object('body_recovered',m.body_text is null,'service','email-recovery-v1'));
    return jsonb_build_object('status','RECORDED','message_id',m.id);
  elsif p->>'kind'='COMPLETE' then
    if p->>'history_fence' !~ '^[0-9]+$' or p->>'replayed_history_id' !~ '^[0-9]+$'
      or (p->>'replayed_history_id')::numeric<(p->>'history_fence')::numeric then raise exception 'RECOVERY_REPLAY_INVALID'; end if;
    insert into public.email_reconciliations(organization_id,mailbox_id,from_at,until_at,history_fence,replayed_history_id,counts)
    values(target_organization_id,target_mailbox_id,(p->>'from_at')::timestamptz,(p->>'until_at')::timestamptz,p->>'history_fence',p->>'replayed_history_id',p->'counts')
    on conflict(organization_id,mailbox_id,history_fence) do nothing;
    return jsonb_build_object('status','RECONCILED');
  end if;
  raise exception 'RECOVERY_COMMAND_INVALID';
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
  prefer_new boolean := false;
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
    and lane='DIRECT' and direction='OUTBOUND' and status='QUARANTINED'
    -- 12-oct: un envío incierto con retención registrada ya no frena al buzón completo.
    and not exists (select 1 from app.direct_lane_quarantine_holds h
      where h.organization_id=messages.organization_id and h.message_id=messages.id)) then
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

  -- 12-oct: alterna toques 1 y seguimientos; antes los seguimientos atrasados dejaban sin toque 1 al buzón.
  select m.touch_number>1 into prefer_new from public.messages m
  where m.organization_id=target_organization_id and m.mailbox_id=target_mailbox_id and m.lane='DIRECT'
    and m.direction='OUTBOUND' and m.touch_number is not null and m.status<>'DRY_RUN'
    and m.created_at>=(date_trunc('day',clock_timestamp() at time zone 'America/Mexico_City') at time zone 'America/Mexico_City')
  order by m.created_at desc limit 1;
  prefer_new:=coalesce(prefer_new,false);
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
  order by case when prefer_new then ce.next_touch_number<>1 else ce.next_touch_number=1 end, ce.next_touch_at nulls first, ce.created_at
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

commit;
