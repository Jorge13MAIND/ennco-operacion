-- 114 · Rotación visible y ganchos de reserva (21-oct, Grant).
-- 1. app.ennco_fresh_hook: el toque 1 de las rondas 2 a 5 usa un gancho que esa persona no haya recibido; si ya
--    recibió el vigente, sube la reserva revisada más antigua de su empresa. Así cada ronda puede llevar gancho
--    aunque la empresa solo tenga uno APPROVED a la vez (índice único).
-- 2. claim_direct_lane_dispatch: igual que en la 108, pero toma el gancho de app.ennco_fresh_hook.
-- 3. read_direct_lane_overview: agrega mailbox_rounds (personas abiertas y toques de hoy por buzón y ronda)
--    para las tarjetas de buzón de Correos.
-- Reversa: volver a la definición de la 108 para el claim y la 113 para el overview; la función nueva se puede dejar.

-- Gancho de reserva: un gancho DRAFT ya revisado (reviewed_at) espera a que alguien de la empresa lo necesite.
-- Cuando el toque 1 de una ronda 2+ va a una persona que ya recibió el gancho vigente, el envío sube la reserva
-- más antigua que esa persona no haya recibido (la vigente pasa a REJECTED, como en las subidas a mano).
create or replace function app.ennco_fresh_hook(target_org uuid, target_account uuid, target_contact uuid)
returns text language plpgsql security definer set search_path to 'public','app','pg_temp' as $f$
declare cur public.ennco_account_hooks%rowtype; res public.ennco_account_hooks%rowtype;
begin
  select * into cur from public.ennco_account_hooks h
  where h.organization_id=target_org and h.account_id=target_account and h.status='APPROVED'
  order by h.created_at desc limit 1;
  if cur.id is not null and not exists (select 1 from public.messages m where m.organization_id=target_org and m.contact_id=target_contact
      and m.direction='OUTBOUND' and position(left(btrim(cur.hook_text),40) in coalesce(m.body_text,''))>0) then
    return cur.hook_text;
  end if;
  select * into res from public.ennco_account_hooks h
  where h.organization_id=target_org and h.account_id=target_account and h.status='DRAFT' and h.reviewed_at is not null
    and not exists (select 1 from public.messages m where m.organization_id=target_org and m.contact_id=target_contact
      and m.direction='OUTBOUND' and position(left(btrim(h.hook_text),40) in coalesce(m.body_text,''))>0)
  order by h.created_at limit 1 for update skip locked;
  if res.id is null then return cur.hook_text; end if;
  if cur.id is not null then
    update public.ennco_account_hooks set status='REJECTED',updated_at=clock_timestamp() where id=cur.id;
  end if;
  update public.ennco_account_hooks set status='APPROVED',updated_at=clock_timestamp() where id=res.id;
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,record_id,new_data)
  values (target_org,null,'ENNCO_HOOK_RESERVE_PROMOTED','ennco_account_hooks',res.id,
    jsonb_build_object('account_id',target_account,'contact_id',target_contact,'replaced_hook_id',cur.id));
  return res.hook_text;
end $f$;
revoke all on function app.ennco_fresh_hook(uuid,uuid,uuid) from public, anon, authenticated;

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
  prefer_new boolean := false; own_hook text; greeting text; hooked_body text;
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
  -- 12-oct (Grant): el toque 1 de las rondas 2 a 5 no tiene {{gancho}}. Si la empresa tiene gancho propio
  -- y esta persona nunca lo recibió, va después del saludo, siempre que quepa en 120 palabras y sin enlaces.
  if candidate.touch_value=1 and position('{{gancho}}' in candidate.body_template)=0 then
    -- 21-oct (Grant): si la persona ya recibió el gancho vigente, sube el de reserva más antiguo que no haya recibido.
    own_hook:=app.ennco_fresh_hook(target_organization_id,candidate.account_id,candidate.contact_id);
    greeting:=substring(rendered_body from '^(Hola[^\n]*\n\n)');
    if nullif(btrim(own_hook),'') is not null and greeting is not null
      and not exists (select 1 from public.messages pm where pm.organization_id=target_organization_id
        and pm.contact_id=candidate.contact_id and pm.direction='OUTBOUND'
        and position(left(btrim(own_hook),40) in coalesce(pm.body_text,''))>0) then
      hooked_body:=greeting||btrim(own_hook)||E'\n\n'||substr(rendered_body,length(greeting)+1);
      if cardinality(regexp_split_to_array(btrim(hooked_body),'\s+'))<=120 and hooked_body!~*'(https?://|www\.|mailto:)' then
        rendered_body:=hooked_body;
      end if;
    end if;
  end if;
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

CREATE OR REPLACE FUNCTION public.read_direct_lane_overview(target_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare result jsonb;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  select app.direct_lane_health_as_system(target_organization_id) || jsonb_build_object(
    'campaigns',coalesce((select jsonb_agg(jsonb_build_object(
        'campaign_id',c.id,'name',c.name,'state',c.direct_lane_state,'approved_at',c.approved_at,'created_at',c.created_at,
        'manifest_sha256',c.manifest_sha256,'cc_on_reply_email',c.manifest_json->>'cc_on_reply_email',
        'enrollments',(select coalesce(jsonb_object_agg(s.status,s.n),'{}'::jsonb) from (
          select ce.status::text as status,count(*) as n from public.campaign_enrollments ce
          where ce.organization_id=c.organization_id and ce.campaign_id=c.id group by ce.status) s),
        'by_variant',(select coalesce(jsonb_object_agg(v.key,v.n),'{}'::jsonb) from (
          select mv->>'key' as key,count(ce.id) as n
          from jsonb_array_elements(c.manifest_json->'variants') mv
          left join public.sequence_versions sv on sv.organization_id=c.organization_id and sv.campaign_id=c.id and sv.version=(mv->>'version')::integer
          left join public.campaign_enrollments ce on ce.organization_id=c.organization_id and ce.sequence_version_id=sv.id
          group by mv->>'key') v)
      ) order by c.created_at desc)
      from public.campaigns c where c.organization_id=target_organization_id and c.lane='DIRECT'),'[]'::jsonb),
    'enrollable_contacts',(select count(*) from public.contacts ct join public.accounts a on a.organization_id=ct.organization_id and a.id=ct.account_id
      where ct.organization_id=target_organization_id and ct.verified and not ct.is_deleted and not a.is_deleted
        and not exists (select 1 from public.campaign_enrollments ce where ce.organization_id=ct.organization_id and ce.contact_id=ct.id and ce.status in ('PENDING','ACTIVE','PAUSED'))
        and not app.is_suppressed(ct.organization_id,a.id,ct.normalized_email,a.primary_domain)),
    -- 21-oct (Grant): la rotación por buzón: personas abiertas por ronda y toques de hoy por ronda.
    'mailbox_rounds',coalesce((select jsonb_agg(jsonb_build_object('mailbox_id',x.mailbox_id,'round',x.r,'open',x.open_n,'today',x.today_n) order by x.mailbox_id,x.r) from (
      select coalesce(o.mailbox_id,t.mailbox_id) as mailbox_id,coalesce(o.r,t.r) as r,coalesce(o.n,0) as open_n,coalesce(t.n,0) as today_n
      from (select ce.mailbox_id,ce.rotation_round as r,count(*) as n from public.campaign_enrollments ce
              join public.campaigns c on c.organization_id=ce.organization_id and c.id=ce.campaign_id and c.lane='DIRECT' and c.direct_lane_state in ('RUNNING','PAUSED')
            where ce.organization_id=target_organization_id and ce.status in ('PENDING','ACTIVE','PAUSED') group by 1,2) o
      full join (select m.mailbox_id,ce.rotation_round as r,count(*) as n from public.messages m
              join public.campaign_enrollments ce on ce.organization_id=m.organization_id and ce.id=m.enrollment_id
            where m.organization_id=target_organization_id and m.lane='DIRECT' and m.direction='OUTBOUND' and m.touch_number is not null
              and m.status in ('SENT','DELIVERED','BOUNCED')
              and m.created_at>=(date_trunc('day',clock_timestamp() at time zone 'America/Mexico_City') at time zone 'America/Mexico_City')-interval '1 day'
              and (coalesce(m.sent_at,m.created_at) at time zone 'America/Mexico_City')::date=(clock_timestamp() at time zone 'America/Mexico_City')::date
            group by 1,2) t on t.mailbox_id=o.mailbox_id and t.r=o.r) x),'[]'::jsonb),
    'unverified_contacts',(select count(*) from public.contacts ct where ct.organization_id=target_organization_id and not ct.verified and not ct.is_deleted),
    'recent_messages',coalesce((select jsonb_agg(jsonb_build_object(
        'message_id',m.id,'direction',m.direction,'status',m.status,'touch_number',m.touch_number,'kind',case when m.direction='INBOUND' then 'INBOUND' when m.touch_number is null then 'REPLY' else 'TOUCH' end,
        'mailbox_email',mb.normalized_email,'counterparty',case when m.direction='INBOUND' then m.normalized_from else m.normalized_to end,
        'account',a.legal_name,'contact',ct.full_name,'subject',m.subject,'created_at',m.created_at,'sent_at',m.sent_at,'cc',m.cc_emails,
        'last_error',(select t.outcome from public.direct_lane_ticks t where t.organization_id=m.organization_id and t.message_id=m.id and t.tick_kind='SETTLE' order by t.created_at desc limit 1)
      ) order by m.created_at desc)
      from (select * from public.messages mm where mm.organization_id=target_organization_id and (mm.lane='DIRECT' or mm.direction='INBOUND')
        order by mm.created_at desc limit 60) m
      left join public.mailboxes mb on mb.organization_id=m.organization_id and mb.id=m.mailbox_id
      left join public.contacts ct on ct.organization_id=m.organization_id and ct.id=m.contact_id
      left join public.accounts a on a.organization_id=ct.organization_id and a.id=ct.account_id),'[]'::jsonb),
    'pending_replies',coalesce((select jsonb_agg(jsonb_build_object(
        'provider_event_id',e.id,'classification',e.reply_classification,'observed_at',e.observed_at,'message_id',e.message_id,
        'subject',m.subject,'body_text',left(coalesce(m.body_text,''),1200),'from_email',m.normalized_from,
        'mailbox_email',mb.normalized_email,'account',a.legal_name,'contact',ct.full_name,'role_title',ct.role_title,
        'already_answered',exists(select 1 from public.messages r where r.organization_id=e.organization_id and r.reply_to_provider_event_id=e.id and r.status not in ('FAILED','QUARANTINED'))
      ) order by e.observed_at desc)
      from (select * from public.provider_events ee where ee.organization_id=target_organization_id and ee.event_kind='REPLY' order by ee.observed_at desc limit 40) e
      join public.messages m on m.organization_id=e.organization_id and m.id=e.message_id
      left join public.mailboxes mb on mb.organization_id=m.organization_id and mb.id=m.mailbox_id
      left join public.contacts ct on ct.organization_id=m.organization_id and ct.id=m.contact_id
      left join public.accounts a on a.organization_id=ct.organization_id and a.id=ct.account_id),'[]'::jsonb),
    'upcoming',coalesce((select jsonb_agg(jsonb_build_object('day',d.day,'touches',d.n) order by d.day)
      from (select (ce.next_touch_at at time zone 'America/Mexico_City')::date as day,count(*) as n
        from public.campaign_enrollments ce join public.campaigns c on c.organization_id=ce.organization_id and c.id=ce.campaign_id
        where ce.organization_id=target_organization_id and c.lane='DIRECT' and ce.status in ('PENDING','ACTIVE') and ce.next_touch_at is not null
          and ce.next_touch_at<clock_timestamp()+interval '14 days'
        group by 1 order by 1 limit 14) d),'[]'::jsonb),
    'recent_ticks',coalesce((select jsonb_agg(jsonb_build_object('tick_kind',t.tick_kind,'outcome',t.outcome,'created_at',t.created_at,'mailbox_id',t.mailbox_id,'detail',t.detail_json) order by t.created_at desc)
      from (select * from public.direct_lane_ticks tt where tt.organization_id=target_organization_id order by tt.created_at desc limit 20) t),'[]'::jsonb)
  ) into result;
  return result;
end $function$;
