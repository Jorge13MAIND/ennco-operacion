begin;
-- Approved ENNCO email recovery. Preserve existing copy, windows and contact history.
alter table public.campaigns add column new_contacts_paused boolean not null default false;
create or replace function app.email_cohort_on_hold(target_org uuid, target_campaign uuid)
returns boolean language sql stable security definer set search_path=public,app,pg_temp as $$
  select coalesce((select c.new_contacts_paused or (count(m.id)>=25 and count(m.id) filter(where m.status in ('BOUNCED','FAILED'))>=2
    and (count(m.id) filter(where m.status in ('BOUNCED','FAILED')))::numeric/nullif(count(m.id),0)>0.02)
    from public.campaigns c left join public.campaign_enrollments e on e.organization_id=c.organization_id and e.campaign_id=c.id
    left join public.messages m on m.organization_id=e.organization_id and m.enrollment_id=e.id and m.direction='OUTBOUND'
      and m.status in ('SENT','DELIVERED','BOUNCED','FAILED') and coalesce(m.sent_at,m.created_at)>=clock_timestamp()-interval '7 days'
    where c.organization_id=target_org and c.id=target_campaign group by c.id),true)
$$;
revoke all on function app.email_cohort_on_hold(uuid,uuid) from public,anon,authenticated,service_role;
-- Contener un envío incierto debe funcionar incluso si el Anexo A dejó de
-- estar listo. Esto NO autoriza insertar, enviar ni reactivar mensajes.
create or replace function app.enforce_annex_a_message_release()
returns trigger language plpgsql security definer set search_path=app,public,pg_temp as $$
begin
  if tg_op='UPDATE' then
    if new.status='QUARANTINED' and old.status in ('QUEUED','SENDING')
      and new.organization_id=old.organization_id and new.direction=old.direction
      and new.mailbox_id is not distinct from old.mailbox_id then return new; end if;
  end if;
  if new.direction='OUTBOUND' and new.status<>'DRY_RUN'
    and not app.annex_a_manifest_is_ready(new.organization_id)
    then raise exception 'ANNEX_A_NOT_READY'; end if;
  return new;
end $$;

create or replace function app.direct_lane_sent_today(target_organization_id uuid, target_mailbox_id uuid)
returns integer language sql stable security definer set search_path=public,pg_temp as $$
  select count(*)::integer from public.messages m
  where m.organization_id=target_organization_id and m.mailbox_id=target_mailbox_id
    and m.lane='DIRECT' and m.direction='OUTBOUND'
    and m.status in ('QUEUED','SENDING','SENT','DELIVERED','BOUNCED','QUARANTINED')
    and (coalesce(m.sent_at,m.created_at) at time zone 'America/Mexico_City')::date=(clock_timestamp() at time zone 'America/Mexico_City')::date
$$;

create or replace function app.direct_lane_new_today(target_organization_id uuid, target_mailbox_id uuid)
returns integer language sql stable security definer set search_path=public,pg_temp as $$
  select count(*)::integer from public.messages m
  where m.organization_id=target_organization_id and m.mailbox_id=target_mailbox_id
    and m.lane='DIRECT' and m.direction='OUTBOUND' and m.touch_number=1
    and m.status in ('QUEUED','SENDING','SENT','DELIVERED','BOUNCED','QUARANTINED')
    and (coalesce(m.sent_at,m.created_at) at time zone 'America/Mexico_City')::date=(clock_timestamp() at time zone 'America/Mexico_City')::date
$$;

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
    reply_only := not app.hybrid_dispatch_window_is_open(clock_timestamp());
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
      pace_seconds := 240+mod(abs(hashtextextended(to_char(clock_timestamp() at time zone 'America/Mexico_City','YYYY-MM-DD')||':'||target_mailbox_id::text||':'||sent_count::text,0)),180)::integer;
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
      return jsonb_build_object('status','CLAIMED','kind','REPLY','message_id',reply_record.id,'mailbox_id',target_mailbox_id,
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
create or replace function public.settle_direct_lane_dispatch(
  target_organization_id uuid, target_message_id uuid, target_outcome text, target_provider_message_id text,
  target_provider_thread_id text, target_rfc_message_id text, target_error_code text,
  proof_command_id text, proof_nonce uuid, proof_expires_at timestamptz, proof_signature text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare payload_sha text; message_record public.messages%rowtype; enrollment_record public.campaign_enrollments%rowtype;
  current_offset integer; next_offset integer; failed_attempts integer; sent_at_value timestamptz := clock_timestamp();
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n','settle_direct_lane_dispatch',target_organization_id::text,target_message_id::text,
    coalesce(target_outcome,''),coalesce(target_provider_message_id,''),coalesce(target_provider_thread_id,''),
    coalesce(target_rfc_message_id,''),coalesce(target_error_code,'')),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);
  if target_outcome not in ('SENT','FAILED','AMBIGUOUS') then raise exception 'DIRECT_LANE_SETTLE_OUTCOME_INVALID'; end if;
  select * into message_record from public.messages
  where organization_id=target_organization_id and id=target_message_id and lane='DIRECT' and direction='OUTBOUND' for update;
  if not found then raise exception 'DIRECT_LANE_MESSAGE_NOT_FOUND'; end if;
  if message_record.status in ('SENT','DELIVERED','FAILED','BOUNCED','QUARANTINED') then
    return jsonb_build_object('status',case when message_record.status::text=target_outcome or (message_record.status='DELIVERED' and target_outcome='SENT') then 'DUPLICATE' else 'BLOCKED' end,
      'message_id',target_message_id,'current_status',message_record.status);
  end if;
  if target_outcome='AMBIGUOUS' then
    update public.messages set status='QUARANTINED',updated_at=clock_timestamp() where id=message_record.id;
    update public.mailboxes set direct_lane_status='PAUSED',updated_at=clock_timestamp()
      where organization_id=target_organization_id and id=message_record.mailbox_id;
    update public.campaign_enrollments set status='PAUSED',stopped_reason='AMBIGUOUS',next_touch_at=null,updated_at=clock_timestamp()
      where organization_id=target_organization_id and id=message_record.enrollment_id and status in ('PENDING','ACTIVE');
    perform app.direct_lane_tick(target_organization_id,message_record.mailbox_id,message_record.id,'SETTLE','AMBIGUOUS',
      jsonb_build_object('error_code',target_error_code));
    return jsonb_build_object('status','SETTLED','outcome','AMBIGUOUS','message_id',message_record.id);
  end if;
  if target_outcome='SENT' then
    if message_record.status<>'SENDING' or nullif(btrim(coalesce(target_provider_message_id,'')),'') is null then
      raise exception 'DIRECT_LANE_SETTLE_SENT_INVALID';
    end if;
    update public.messages set status='SENT',sent_at=sent_at_value,provider_message_id=target_provider_message_id,
      provider_thread_id=coalesce(target_provider_thread_id,provider_thread_id),rfc_message_id=coalesce(target_rfc_message_id,rfc_message_id),
      updated_at=clock_timestamp()
    where id=message_record.id;
    update public.mailboxes set direct_lane_first_send_at=coalesce(direct_lane_first_send_at,sent_at_value),updated_at=clock_timestamp()
    where organization_id=target_organization_id and id=message_record.mailbox_id;
    if message_record.touch_number is not null then
      select * into enrollment_record from public.campaign_enrollments where organization_id=target_organization_id and id=message_record.enrollment_id for update;
      select st.day_offset into current_offset from public.sequence_touches st
      where st.organization_id=target_organization_id and st.sequence_version_id=enrollment_record.sequence_version_id and st.touch_number=message_record.touch_number;
      select st.day_offset into next_offset from public.sequence_touches st
      where st.organization_id=target_organization_id and st.sequence_version_id=enrollment_record.sequence_version_id and st.touch_number=message_record.touch_number+1;
      if next_offset is null then
        update public.campaign_enrollments set status='COMPLETED',stopped_reason='SEQUENCE_COMPLETED',next_touch_at=null,updated_at=clock_timestamp()
        where id=enrollment_record.id and status in ('PENDING','ACTIVE');
      else
        update public.campaign_enrollments set status='ACTIVE',next_touch_number=message_record.touch_number+1,
          next_touch_at=sent_at_value+make_interval(days=>greatest(0,next_offset-coalesce(current_offset,0))),updated_at=clock_timestamp()
        where id=enrollment_record.id and status in ('PENDING','ACTIVE');
      end if;
    end if;
    perform app.direct_lane_tick(target_organization_id,message_record.mailbox_id,message_record.id,'SETTLE','SENT',
      jsonb_build_object('touch',message_record.touch_number,'kind',case when message_record.touch_number is null then 'REPLY' else 'TOUCH' end));
    return jsonb_build_object('status','SETTLED','outcome','SENT','message_id',message_record.id);
  end if;
  update public.messages set status='FAILED',updated_at=clock_timestamp() where id=message_record.id;
  if message_record.touch_number is not null then
    select count(*) into failed_attempts from public.messages
    where organization_id=target_organization_id and enrollment_id=message_record.enrollment_id and direction='OUTBOUND'
      and touch_number=message_record.touch_number and status='FAILED';
    if failed_attempts>=3 then
      update public.campaign_enrollments set status='PAUSED',stopped_reason='DISPATCH_FAILED_'||coalesce(target_error_code,'UNKNOWN'),next_touch_at=null,updated_at=clock_timestamp()
      where organization_id=target_organization_id and id=message_record.enrollment_id and status in ('PENDING','ACTIVE');
    end if;
  end if;
  perform app.direct_lane_tick(target_organization_id,message_record.mailbox_id,message_record.id,'SETTLE','SEND_FAILED_'||coalesce(regexp_replace(upper(target_error_code),'[^A-Z0-9_]','_','g'),'UNKNOWN'),
    jsonb_build_object('touch',message_record.touch_number,'attempts',failed_attempts));
  return jsonb_build_object('status','SETTLED','outcome','FAILED','message_id',message_record.id,'error_code',target_error_code,'attempts',failed_attempts);
end $$;
CREATE OR REPLACE FUNCTION app.direct_lane_enroll_core(target_organization_id uuid, target_campaign_id uuid, target_mailbox_id uuid, target_contact_ids uuid[], target_max_count integer, actor uuid, audit_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_temp'
AS $function$
declare campaign_record public.campaigns%rowtype;
  mailbox_ids uuid[]; mailbox_cursor integer := 0; candidate record; chosen_mailbox uuid;
  variant_key text; version_id uuid; enrolled integer := 0; skipped_suppressed integer := 0;
  skipped_unverified integer := 0; skipped_enrolled integer := 0; by_variant jsonb := '{}'::jsonb;
  by_mailbox jsonb := '{}'::jsonb; new_status public.enrollment_status; response jsonb; limit_value integer;
begin
  limit_value := least(greatest(coalesce(target_max_count,50),1),500);
  select * into campaign_record from public.campaigns where organization_id=target_organization_id and id=target_campaign_id and lane='DIRECT';
  if not found then raise exception 'DIRECT_LANE_CAMPAIGN_NOT_FOUND'; end if;
  if app.email_cohort_on_hold(target_organization_id,target_campaign_id) then return jsonb_build_object('status','HOLD','enrolled',0,'reason','COHORT_QUALITY_REVIEW'); end if;
  if campaign_record.direct_lane_state not in ('DRAFT','RUNNING','PAUSED') then raise exception 'DIRECT_LANE_CAMPAIGN_COMPLETED'; end if;
  if target_mailbox_id is not null then
    if not exists (select 1 from public.mailboxes m where m.organization_id=target_organization_id and m.id=target_mailbox_id
      and m.direct_lane_status in ('CONNECTED','PAUSED')) then raise exception 'DIRECT_LANE_MAILBOX_NOT_CONNECTED'; end if;
    mailbox_ids := array[target_mailbox_id];
  else
    -- DEC-112: el reparto por defecto incluye al buzon principal del cliente.
    select array_agg(m.id order by m.normalized_email) into mailbox_ids from public.mailboxes m
    where m.organization_id=target_organization_id and m.direct_lane_status='CONNECTED';
    if mailbox_ids is null or cardinality(mailbox_ids)=0 then
      select array_agg(m.id order by m.normalized_email) into mailbox_ids from public.mailboxes m
      where m.organization_id=target_organization_id and m.direct_lane_status='CONNECTED';
    end if;
    if mailbox_ids is null or cardinality(mailbox_ids)=0 then raise exception 'DIRECT_LANE_NO_CONNECTED_MAILBOX'; end if;
  end if;
  for candidate in
    select c.id as contact_id, c.account_id, c.role_title, c.verified, c.normalized_email, a.primary_domain,
      exists (select 1 from public.campaign_enrollments ce join public.campaigns cc on cc.id=ce.campaign_id
        where ce.organization_id=target_organization_id and ce.contact_id=c.id and cc.lane='DIRECT') as already_enrolled
    from public.contacts c join public.accounts a on a.organization_id=c.organization_id and a.id=c.account_id
    where c.organization_id=target_organization_id and not c.is_deleted and not a.is_deleted
      and (target_contact_ids is null or c.id=any(target_contact_ids))
    order by a.tier nulls last, c.verified desc, c.created_at
  loop
    if enrolled>=limit_value then exit; end if;
    if candidate.already_enrolled then skipped_enrolled := skipped_enrolled+1; continue; end if;
    if not candidate.verified then skipped_unverified := skipped_unverified+1; continue; end if;
    if app.is_suppressed(target_organization_id,candidate.account_id,candidate.normalized_email,candidate.primary_domain) then
      skipped_suppressed := skipped_suppressed+1; continue;
    end if;
    variant_key := app.direct_lane_variant_for_role(candidate.role_title);
    select sv.id into version_id from public.sequence_versions sv
    join jsonb_array_elements(campaign_record.manifest_json->'variants') v on (v->>'version')::integer=sv.version and v->>'key'=variant_key
    where sv.organization_id=target_organization_id and sv.campaign_id=target_campaign_id limit 1;
    if version_id is null then raise exception 'DIRECT_LANE_VARIANT_VERSION_MISSING: %', variant_key; end if;
    mailbox_cursor := mailbox_cursor+1;
    chosen_mailbox := mailbox_ids[1+mod(mailbox_cursor-1,cardinality(mailbox_ids))];
    insert into public.campaign_enrollments(organization_id,campaign_id,sequence_version_id,account_id,contact_id,mailbox_id,status,next_touch_number,next_touch_at)
    values (target_organization_id,target_campaign_id,version_id,candidate.account_id,candidate.contact_id,chosen_mailbox,'PENDING',1,clock_timestamp())
    returning status into new_status;
    if new_status='SUPPRESSED' then skipped_suppressed := skipped_suppressed+1; continue; end if;
    enrolled := enrolled+1;
    by_variant := jsonb_set(by_variant,array[variant_key],to_jsonb(coalesce((by_variant->>variant_key)::integer,0)+1));
    by_mailbox := jsonb_set(by_mailbox,array[chosen_mailbox::text],to_jsonb(coalesce((by_mailbox->>chosen_mailbox::text)::integer,0)+1));
  end loop;
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,record_id,new_data)
  values (target_organization_id,actor,audit_action,'campaigns',target_campaign_id,
    jsonb_build_object('enrolled',enrolled,'skipped_suppressed',skipped_suppressed,'skipped_unverified',skipped_unverified,
      'skipped_enrolled',skipped_enrolled,'by_variant',by_variant,'by_mailbox',by_mailbox));
  return jsonb_build_object('status','ENROLLED','campaign_id',target_campaign_id,'enrolled',enrolled,
    'skipped_suppressed',skipped_suppressed,'skipped_unverified',skipped_unverified,'skipped_enrolled',skipped_enrolled,
    'by_variant',by_variant,'by_mailbox',by_mailbox);
end $function$;
commit;
