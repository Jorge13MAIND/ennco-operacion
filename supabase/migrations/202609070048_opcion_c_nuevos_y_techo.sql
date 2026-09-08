begin;

-- M048: opcion C de volumen (Grant, 7-sep) y techo del buzon del cliente.
--
-- La rampa semanal (SCHEDULE) pasa a limitar CONTACTOS NUEVOS al dia (toque
-- 1). Los toques 2 a 8 salen el dia que les toca, con prioridad sobre los
-- nuevos, y un techo total diario (cap_max) protege al buzon: contacto@ 60,
-- los cuatro buzones nuevos 30 cada uno (60 por dominio). Antes el tope
-- contaba todo junto y a partir del cuarto dia los seguimientos desplazaban
-- a los nuevos. La tabla de goteo del 7-sep cuantifico las cinco opciones;
-- Grant eligio C.
--
-- El buzon principal del cliente podia llegar a 20; Grant autoriza 25
-- contactos nuevos al dia, asi que el techo total sube a 60.
--
-- Go de Jorge para el primer envio externo (clausula 07): registrado por
-- Grant el 7-sep (ver docs/09-decision-register.md, DEC-112).

create or replace function app.direct_lane_new_today(target_organization_id uuid, target_mailbox_id uuid)
returns integer language sql stable security definer set search_path=public,pg_temp as $$
  select count(*)::integer from public.messages m
  where m.organization_id=target_organization_id and m.mailbox_id=target_mailbox_id
    and m.lane='DIRECT' and m.direction='OUTBOUND' and m.touch_number=1
    and m.status in ('QUEUED','SENDING','SENT','DELIVERED')
    and (m.created_at at time zone 'America/Mexico_City')::date=(clock_timestamp() at time zone 'America/Mexico_City')::date
$$;
revoke all on function app.direct_lane_new_today(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function app.direct_lane_mailbox_json(target_mailbox public.mailboxes)
returns jsonb language sql stable security definer set search_path=public,app,pg_temp as $$
  select jsonb_build_object(
    'mailbox_id',target_mailbox.id,
    'normalized_email',target_mailbox.normalized_email,
    'domain',target_mailbox.domain,
    'sender_name',coalesce(target_mailbox.direct_lane_display_name,target_mailbox.sender_name),
    'status',target_mailbox.direct_lane_status,
    'credential_active',exists(select 1 from public.direct_lane_credentials c
      where c.organization_id=target_mailbox.organization_id and c.mailbox_id=target_mailbox.id and c.status='ACTIVE'),
    'credential_connected_at',(select max(c.created_at) from public.direct_lane_credentials c
      where c.organization_id=target_mailbox.organization_id and c.mailbox_id=target_mailbox.id and c.status='ACTIVE'),
    'ramp_mode',target_mailbox.direct_lane_ramp_mode,
    'fixed_cap',target_mailbox.direct_lane_fixed_cap,
    'cap_max',target_mailbox.direct_lane_cap_max,
    'effective_cap',app.direct_lane_effective_cap(target_mailbox),
    'ramp_schedule',to_jsonb(target_mailbox.direct_lane_ramp_schedule),
    'ramp_anchor_at',target_mailbox.direct_lane_ramp_anchor_at,
    'ramp_week',app.direct_lane_ramp_week(target_mailbox),
    'new_today',app.direct_lane_new_today(target_mailbox.organization_id,target_mailbox.id),
    'new_cap',app.direct_lane_effective_cap(target_mailbox),
    'ceiling',target_mailbox.direct_lane_cap_max,
    'sent_today',app.direct_lane_sent_today(target_mailbox.organization_id,target_mailbox.id),
    'queued',(select count(*) from public.messages m where m.organization_id=target_mailbox.organization_id
      and m.mailbox_id=target_mailbox.id and m.lane='DIRECT' and m.direction='OUTBOUND' and m.status in ('QUEUED','SENDING')),
    'sent_total',(select count(*) from public.messages m where m.organization_id=target_mailbox.organization_id
      and m.mailbox_id=target_mailbox.id and m.lane='DIRECT' and m.direction='OUTBOUND' and m.status in ('SENT','DELIVERED')),
    'first_send_at',target_mailbox.direct_lane_first_send_at,
    'is_client_primary',target_mailbox.eligibility_route='EXISTING_PRIMARY_GMAIL_RAMP',
    'sync',(select jsonb_build_object('status',s.status,'last_history_id',s.last_history_id,'last_synced_at',s.last_synced_at,'last_error_code',s.last_error_code)
      from public.mailbox_sync_cursors s where s.organization_id=target_mailbox.organization_id and s.mailbox_id=target_mailbox.id),
    'pending_invitation',(select jsonb_build_object('expires_at',a.expires_at,'status',a.status,'created_at',a.created_at)
      from public.direct_lane_authorizations a where a.organization_id=target_mailbox.organization_id and a.mailbox_id=target_mailbox.id
        and a.status in ('PENDING','ARMED') and a.expires_at>clock_timestamp() order by a.created_at desc limit 1),
    'last_error',(select t.outcome from public.direct_lane_ticks t where t.organization_id=target_mailbox.organization_id
      and t.mailbox_id=target_mailbox.id and t.tick_kind in ('SETTLE','SYNC') and t.outcome like '%FAIL%' order by t.created_at desc limit 1)
  )
$$;

create or replace function public.configure_direct_lane_mailbox(
  target_organization_id uuid, target_mailbox_id uuid, target_patch jsonb, target_reason text, target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
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
    and coalesce((target_patch->>'cap_max')::integer,mailbox_record.direct_lane_cap_max)>60 then
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
end $$;

create or replace function public.claim_direct_lane_dispatch(
  target_organization_id uuid, target_mailbox_id uuid, dry_run boolean,
  proof_command_id text, proof_nonce uuid, proof_expires_at timestamptz, proof_signature text)
returns jsonb language plpgsql security definer set search_path=public,app,extensions,pg_temp as $$
declare payload_sha text; mailbox_record public.mailboxes%rowtype; controls_record public.runtime_controls%rowtype;
  cap integer; sent_count integer; last_outbound_at timestamptz; pace_seconds integer; stuck integer;
  new_count integer; ceiling integer;
  reply_record public.messages%rowtype; inbound_record public.messages%rowtype; candidate record; previous_message public.messages%rowtype;
  message_id_value uuid; correlation_value uuid := gen_random_uuid(); attempt_value integer; idempotency_value text;
  thread_json jsonb; rendered_subject text; rendered_body text; unsubscribe_enrollment uuid;
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

  -- Un SENDING de más de 15 minutos es un envío que murió a medias: sale del
  -- limbo como FAILED para que el siguiente intento pueda ocurrir (lección de
  -- los 2,522 incidentes: nada se queda pendiente para siempre).
  update public.messages set status='FAILED',updated_at=clock_timestamp()
  where organization_id=target_organization_id and mailbox_id=target_mailbox_id and lane='DIRECT'
    and direction='OUTBOUND' and status='SENDING' and updated_at<clock_timestamp()-interval '15 minutes';
  get diagnostics stuck=row_count;
  if stuck>0 then perform app.direct_lane_tick(target_organization_id,target_mailbox_id,null,'CLAIM','STUCK_SENDING_FAILED',jsonb_build_object('count',stuck)); end if;

  if not dry_run then
    select * into controls_record from public.runtime_controls where organization_id=target_organization_id;
    if not found or controls_record.global_kill_switch or not controls_record.external_send_allowed then
      return app.direct_lane_noop(target_organization_id,target_mailbox_id,'RUNTIME_HOLD',null);
    end if;
    if not app.hybrid_dispatch_window_is_open(clock_timestamp()) then
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
  if sent_count>=ceiling then
    return app.direct_lane_noop(target_organization_id,target_mailbox_id,'BUDGET_EXHAUSTED',
      jsonb_build_object('sent_today',sent_count,'ceiling',ceiling,'new_today',new_count,'new_cap',cap));
  end if;

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

  rendered_subject := left(app.direct_lane_render(candidate.subject_template,candidate.full_name,candidate.legal_name),180);
  rendered_body := app.direct_lane_render(candidate.body_template,candidate.full_name,candidate.legal_name);
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
    jsonb_build_object('touch',candidate.touch_value,'attempt',attempt_value));
  return jsonb_build_object('status',case when dry_run then 'SHADOW_CLAIMED' else 'CLAIMED' end,'kind','TOUCH','message_id',message_id_value,
    'mailbox_id',target_mailbox_id,'from_email',mailbox_record.normalized_email,
    'from_name',coalesce(mailbox_record.direct_lane_display_name,mailbox_record.sender_name),
    'to_email',candidate.contact_email,'cc_emails','[]'::jsonb,'subject',rendered_subject,'body_text',rendered_body,
    'touch_number',candidate.touch_value,'thread',thread_json,'enrollment_id',candidate.enrollment_id,
    'sent_today',sent_count,'daily_cap',cap,'attempt',attempt_value);
end $$;

commit;
