-- 066 · Campaña v4 con gancho, 100 correos al día y rotación de buzones (junta #6, 22-sep-2026).
--
-- Lo que se acordó con Jorge y queda aplicado aquí:
--   · Cuatro toques por ronda, a los días 0, 2, 4 y 6. El gancho va solo en el primero y se
--     redacta como hallazgo con su fuente ("leí que…, no sé si siga vigente; si es así…").
--   · Texto 25 % más corto que la v3.
--   · 20 correos por buzón al día, contando seguimientos: 100 entre los cinco.
--   · Si pasan los cuatro toques sin respuesta, se esperan siete días y arranca otra ronda de
--     cuatro desde el siguiente buzón que no le ha escrito, con otro texto. Cinco buzones,
--     cinco rondas; después el contacto se deja.
--   · Una respuesta, un rebote o una baja detiene al contacto en todos los buzones.
--
-- Generado por tools/correos/gen-066.py. Las funciones vivas se parchan, no se reescriben.

begin;

set local app.operations_rpc_write = 'on';

/* ---------- Rondas ---------- */

alter table public.campaign_enrollments
  add column if not exists rotation_round smallint not null default 1,
  add column if not exists rotation_origin_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'campaign_enrollments_rotation_round_check') then
    alter table public.campaign_enrollments add constraint campaign_enrollments_rotation_round_check check (rotation_round between 1 and 5);
  end if;
end $$;
comment on column public.campaign_enrollments.rotation_round is
  'Ronda de rotación: 1 es la primera secuencia; cada ronda siguiente sale de otro buzón (junta #6).';
comment on column public.campaign_enrollments.rotation_origin_id is
  'Inscripción de la ronda 1 de la que viene esta ronda. Nulo en la ronda 1.';

-- Tope de toques por ronda. La campaña vieja tiene ocho toques; con la regla nueva cierra en el
-- cuarto y el contacto pasa a rotación.
alter table public.campaigns add column if not exists direct_lane_max_touches smallint;
comment on column public.campaigns.direct_lane_max_touches is
  'Toques por ronda. Al pasar de este número la inscripción se da por terminada y entra a rotación.';

/* ---------- Tope de toques y guarda de pausa (antes de escribir) ---------- */

create or replace function app.direct_lane_enrollment_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'app', 'pg_temp'
as $$
declare max_touches smallint;
begin
  -- settle avanza al toque siguiente; si ya no le toca por la regla de cuatro, se cierra la ronda.
  if new.status = 'ACTIVE' and new.next_touch_number is distinct from old.next_touch_number then
    select c.direct_lane_max_touches into max_touches from public.campaigns c where c.id = new.campaign_id;
    if max_touches is not null and new.next_touch_number > max_touches then
      new.status := 'COMPLETED';
      new.stopped_reason := 'SEQUENCE_COMPLETED';
      new.next_touch_at := null;
    end if;
  end if;
  -- Un "fuera de oficina" que llega a una ronda ya cerrada no la reabre en pausa si el contacto
  -- ya va en otra ronda: solo puede haber una inscripción abierta por contacto.
  if old.status = 'COMPLETED' and new.status = 'PAUSED' and exists (
    select 1 from public.campaign_enrollments x
    where x.organization_id = new.organization_id and x.contact_id = new.contact_id and x.id <> new.id
      and x.status in ('PENDING', 'ACTIVE', 'PAUSED')) then
    new.status := old.status;
    new.stopped_reason := old.stopped_reason;
    new.next_touch_at := old.next_touch_at;
  end if;
  return new;
end $$;

drop trigger if exists enrollments_rotation_guard on public.campaign_enrollments;
create trigger enrollments_rotation_guard
  before update on public.campaign_enrollments
  for each row execute function app.direct_lane_enrollment_guard();

/* ---------- Rotación ---------- */

create or replace function app.direct_lane_rotate(target_enrollment_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'app', 'extensions', 'pg_temp'
as $$
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

  insert into public.campaign_enrollments(organization_id, campaign_id, sequence_version_id, account_id, contact_id,
    mailbox_id, status, next_touch_number, next_touch_at, rotation_round, rotation_origin_id)
  values (e.organization_id, rot.id, version_id, e.account_id, e.contact_id,
    chosen, 'PENDING', 1, start_at, next_round, coalesce(e.rotation_origin_id, e.id))
  returning id into new_id;

  insert into public.audit_log(organization_id, action, record_type, record_id, new_data)
  values (e.organization_id, 'DIRECT_LANE_ROTATION_SCHEDULED', 'campaign_enrollments', new_id,
    jsonb_build_object('from_enrollment', e.id, 'round', next_round, 'mailbox_id', chosen, 'starts_at', start_at));
  return new_id;
end $$;

create or replace function app.direct_lane_enrollment_after()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'app', 'pg_temp'
as $$
begin
  if new.status is not distinct from old.status then return null; end if;
  if new.status in ('REPLIED', 'BOUNCED', 'UNSUBSCRIBED', 'SUPPRESSED') then
    -- Si contesta un correo de una ronda anterior, se cancela la ronda que ya estaba agendada.
    update public.campaign_enrollments
    set status = 'COMPLETED', stopped_reason = 'CONTACT_' || new.status::text, next_touch_at = null, updated_at = clock_timestamp()
    where organization_id = new.organization_id and contact_id = new.contact_id and id <> new.id
      and status in ('PENDING', 'ACTIVE', 'PAUSED');
  elsif new.status = 'COMPLETED' and new.stopped_reason = 'SEQUENCE_COMPLETED' then
    perform app.direct_lane_rotate(new.id);
  end if;
  return null;
end $$;

drop trigger if exists enrollments_rotation_after on public.campaign_enrollments;
create trigger enrollments_rotation_after
  after update on public.campaign_enrollments
  for each row execute function app.direct_lane_enrollment_after();

revoke all on function app.direct_lane_rotate(uuid) from public, anon, authenticated;

/* ---------- Funciones vivas parchadas (ver tools/correos/gen-066.py) ---------- */

CREATE OR REPLACE FUNCTION public.claim_direct_lane_dispatch(target_organization_id uuid, target_mailbox_id uuid, dry_run boolean, proof_command_id text, proof_nonce uuid, proof_expires_at timestamp with time zone, proof_signature text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_temp'
AS $function$
declare payload_sha text; mailbox_record public.mailboxes%rowtype; controls_record public.runtime_controls%rowtype;
  cap integer; sent_count integer; last_outbound_at timestamptz; pace_seconds integer; stuck integer;
  new_count integer; ceiling integer;
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
      and coalesce(e.next_touch_at,clock_timestamp()) < ((clock_timestamp() at time zone 'America/Mexico_City')::date + 1) at time zone 'America/Mexico_City';
  room := app.direct_lane_effective_cap(mailbox_record) - app.direct_lane_new_today(target_organization_id,target_mailbox_id) - pending_new;
  if room<=0 then return jsonb_build_object('status','SKIPPED','reason','NO_ROOM','pending_new',pending_new); end if;
  response := app.direct_lane_enroll_core(target_organization_id,campaign_id,target_mailbox_id,null,room,null,'DIRECT_LANE_CONTACTS_AUTOENROLLED');
  return response || jsonb_build_object('room',room,'pending_new',pending_new);
end $function$;

CREATE OR REPLACE FUNCTION app.direct_lane_stats_json(target_organization_id uuid, since_at timestamp with time zone, until_at timestamp with time zone, target_campaign_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
  with env as (
    select m.id, m.mailbox_id, m.contact_id, m.enrollment_id, m.touch_number, m.status, m.created_at, m.opened_at, m.open_tracked,
      mb.normalized_email as mailbox, coalesce(nullif(a.state,''),'?') as state,
      coalesce(e.rotation_round,1) as rotation_round,
      app.direct_lane_variant_for_role(c.role_title) as variant,
      date_trunc('week', m.created_at at time zone 'America/Mexico_City')::date as week_start
    from public.messages m
    join public.mailboxes mb on mb.id=m.mailbox_id
    left join public.campaign_enrollments e on e.id=m.enrollment_id
    left join public.contacts c on c.id=m.contact_id
    left join public.accounts a on a.id=c.account_id
    where m.organization_id=target_organization_id and m.lane='DIRECT' and m.direction='OUTBOUND'
      and m.created_at>=since_at and m.created_at<until_at
      and m.status in ('SENT','DELIVERED','FAILED','BOUNCED')
      and (target_campaign_id is null or e.campaign_id=target_campaign_id)
  ),
  enr as (
    select e.id, e.status, e.updated_at, e.created_at, e.mailbox_id, e.contact_id
    from public.campaign_enrollments e join public.campaigns ca on ca.id=e.campaign_id
    where e.organization_id=target_organization_id and ca.lane='DIRECT'
      and (target_campaign_id is null or e.campaign_id=target_campaign_id)
  ),
  replies as (
    -- Una respuesta cuenta por inscripcion: la maquina canonica marca REPLIED
    -- al ingresarla. No se filtra por lane del mensaje entrante: la ingesta
    -- comparte tablas con el carril hibrido y ese campo no es fiable ahi.
    select e.id as enrollment_id, e.mailbox_id, e.contact_id, e.updated_at as created_at
    from public.campaign_enrollments e join public.campaigns ca on ca.id=e.campaign_id
    where e.organization_id=target_organization_id and ca.lane='DIRECT' and e.status='REPLIED'
      and e.updated_at>=since_at and e.updated_at<until_at
      and (target_campaign_id is null or e.campaign_id=target_campaign_id)
  ),
  positives as (
    select count(*) as n from public.provider_events pe
    join public.messages m on m.id=pe.message_id
    join public.campaign_enrollments e on e.id=m.enrollment_id
    join public.campaigns ca on ca.id=e.campaign_id
    where pe.organization_id=target_organization_id and pe.reply_classification='POSITIVE'
      and ca.lane='DIRECT' and pe.observed_at>=since_at and pe.observed_at<until_at
      and (target_campaign_id is null or e.campaign_id=target_campaign_id)
  ),
  grp as (
    select dim, key,
      count(*) filter (where status in ('SENT','DELIVERED')) as sends,
      count(distinct enrollment_id) filter (where touch_number=1 and status in ('SENT','DELIVERED')) as reached,
      count(*) filter (where status in ('FAILED','BOUNCED')) as failed,
      count(*) filter (where open_tracked and status in ('SENT','DELIVERED')) as tracked,
      count(*) filter (where open_tracked and opened_at is not null) as opened,
      count(distinct enrollment_id) filter (where enrollment_id in (select enrollment_id from replies)) as replied
    from (
      select 'mailbox' as dim, mailbox as key, * from env
      union all select 'variant', variant, * from env
      union all select 'state', state, * from env
      union all select 'week', week_start::text, * from env
      union all select 'touch', 'T'||coalesce(touch_number::text,'?'), * from env
      union all select 'round', 'R'||rotation_round::text, * from env
    ) x group by dim, key
  )
  select jsonb_build_object(
    'since', since_at, 'until', until_at, 'campaign_id', target_campaign_id,
    'funnel', jsonb_build_object(
      'enrolled', (select count(*) from enr where created_at>=since_at and created_at<until_at),
      'reached', (select count(distinct enrollment_id) from env where touch_number=1 and status in ('SENT','DELIVERED')),
      'sends', (select count(*) from env where status in ('SENT','DELIVERED')),
      'failed', (select count(*) from env where status in ('FAILED','BOUNCED')),
      'bounced_enrollments', (select count(*) from enr where status='BOUNCED' and updated_at>=since_at and updated_at<until_at),
      'replied', (select count(*) from replies),
      'positive', (select n from positives),
      'unsubscribed', (select count(*) from enr where status='UNSUBSCRIBED' and updated_at>=since_at and updated_at<until_at),
      'tracked', (select count(*) from env where open_tracked and status in ('SENT','DELIVERED')),
      'opened', (select count(*) from env where open_tracked and opened_at is not null),
      'leads', (select count(*) from public.leads l
        where l.organization_id=target_organization_id and l.created_at>=since_at and l.created_at<until_at
          and (target_campaign_id is null or l.contact_id in (select contact_id from enr)))
    ),
    'by', (select coalesce(jsonb_object_agg(dim, rows),'{}'::jsonb) from (
      select dim, jsonb_agg(jsonb_build_object('key',key,'sends',sends,'reached',reached,'failed',failed,'tracked',tracked,'opened',opened,'replied',replied) order by key) as rows
      from grp group by dim) d)
  )
$function$;

/* ---------- Campaña v4: reemplaza al borrador v3 (sin inscritos) ---------- */
-- Ronda 1 conserva los cuatro carriles por puesto (1 DIRECCION, 2 MANTENIMIENTO, 3 SEGURIDAD,
-- 4 COMPRAS) y abre con {{gancho}}. Las rondas 2 a 5 (versiones 5 a 8) salen de otro buzón con
-- otro ángulo cada una: norma, recibo de CFE, solar y cierre. Sin gancho: Jorge lo quiere solo
-- en el primer toque.

do $$
declare
  org uuid := 'e0000000-0000-4000-8000-000000000001';
  grant_uid uuid := '614db7d9-f70b-4f8b-b0e2-d5c0190a06b3';
  v4_id uuid;
  version_id uuid;
  offsets int[] := array[0,2,4,6];
  v record;
  touches jsonb;
  t jsonb;
  idx int;
  manifest jsonb;
  variant_rows jsonb := '[]'::jsonb;
  cuerpo jsonb;
begin
  select id into v4_id from public.campaigns
  where organization_id = org and name = 'ENNCO · Bajío industrial v3 (gancho)' and direct_lane_state = 'DRAFT';
  if v4_id is null then raise exception 'V3_DRAFT_NOT_FOUND'; end if;
  if exists (select 1 from public.campaign_enrollments where campaign_id = v4_id) then raise exception 'V3_HAS_ENROLLMENTS'; end if;
  delete from public.sequence_touches st using public.sequence_versions sv
    where st.sequence_version_id = sv.id and sv.campaign_id = v4_id;
  delete from public.sequence_versions where campaign_id = v4_id;

  cuerpo := jsonb_build_object(
  -- Ronda 1 · mantenimiento y seguridad
  'MANTENIMIENTO', jsonb_build_array(
    jsonb_build_object('subject','{{first_name}}, pregunta rápida', 'body',
      E'Hola {{first_name}},\n\n{{gancho}}\n\nSoy Francisco Cuellar, de ENNCO. Hacemos mantenimiento eléctrico industrial con **termografía por dron**.\n\nTe propongo algo **sin costo**: vuelo el dron sobre su instalación media hora y te enseño qué está calentando de más.\n\n¿Te acomoda algún día de la próxima semana?\n\nFrancisco Cuellar\nDirector General, ENNCO'),
    jsonb_build_object('subject','{{first_name}}, mil paneles y un recibo que no bajó', 'body',
      E'Hola {{first_name}},\n\nUn caso reciente: una planta con **mil paneles** bajó su recibo de 150 mil a 80 mil al mes, cuando con esa capacidad debería pagar mucho menos. La termografía encontró módulos sobrecalentados y equipos que se bloquean con el calor.\n\nSi en {{company}} tienen paneles, tableros o transformadores, es lo primero que revisaría.\n\n¿Lo vemos?\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, lo que te dejo por escrito', 'body',
      E'Hola {{first_name}},\n\nLo que recibes es **un reporte con fecha**: termografías, lo que está por fallar y en qué orden atenderlo.\n\nCon ese documento, lo que pide mantenimiento deja de sonar a exageración y la partida se defiende sola.\n\n¿Quién más de {{company}} tendría que verlo?\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, ¿es contigo?', 'body',
      E'Hola {{first_name}},\n\nSi el mantenimiento eléctrico de {{company}} no lo llevas tú, ¿me dices con quién? Le escribo de tu parte y dejo de llenarte el correo.\n\nSi sí es contigo, ¿esta semana o la próxima?\n\nSi prefieres que no te escriba, responde "baja".\n\nFrancisco')),
  -- Ronda 1 · dirección y compras
  'DIRECCION', jsonb_build_array(
    jsonb_build_object('subject','{{first_name}}, una pregunta sobre {{company}}', 'body',
      E'Hola {{first_name}},\n\n{{gancho}}\n\nSoy Francisco Cuellar, Director General de ENNCO. Las fallas que paran una planta **casi nunca avisan**, pero casi siempre se ven antes con una cámara térmica.\n\nTe propongo un levantamiento con dron de media hora, **sin costo**. Si hay algo que corregir, el proyecto es **deducible**.\n\n¿Con quién de tu equipo lo coordino?\n\nFrancisco Cuellar\nENNCO'),
    jsonb_build_object('subject','{{first_name}}, mil paneles y un recibo que no bajó', 'body',
      E'Hola {{first_name}},\n\nUn caso reciente: una planta con **mil paneles** pasó de pagar 150 mil a 80 mil al mes. Suena a logro, pero con esa capacidad debería pagar mucho menos. La termografía mostró módulos sobrecalentados: **estaban pagando por energía que no recibían**.\n\nEn {{company}}, ¿cuándo fue la última revisión con evidencia?\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, qué recibes por escrito', 'body',
      E'Hola {{first_name}},\n\nNo es una cotización suelta: es **un reporte con fecha**, con termografías, lo que está por fallar y cuánto cuesta atenderlo.\n\nSirve para decidir con números y para defender la partida ante quien autoriza.\n\n¿Te lo preparo para {{company}}?\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, ¿con quién lo veo?', 'body',
      E'Hola {{first_name}},\n\nSi esto lo lleva alguien más en {{company}}, ¿me dices con quién? Le escribo de tu parte y dejo de llenarte el correo.\n\nSi lo ves tú, ¿esta semana o la próxima?\n\nSi prefieres que no te escriba, responde "baja".\n\nFrancisco')),
  -- Ronda 2 · la norma
  'R2', jsonb_build_array(
    jsonb_build_object('subject','{{first_name}}, una pregunta sobre la NOM-029', 'body',
      E'Hola {{first_name}},\n\nUna pregunta directa: ¿en {{company}} tienen al día el programa de mantenimiento eléctrico que pide la **NOM-029-STPS**?\n\nEn las plantas que visitamos casi siempre falta el registro, no el trabajo. Nosotros lo dejamos documentado: termografía, hallazgos y plan de atención, con fecha.\n\n¿Te interesa que lo revisemos?\n\nFrancisco Cuellar\nENNCO'),
    jsonb_build_object('subject','{{first_name}}, lo que pide una inspección', 'body',
      E'Hola {{first_name}},\n\nCuando llega una inspección, lo que piden no es una instalación perfecta: es **evidencia** de que se revisa y se atiende.\n\nUn levantamiento termográfico de media hora ya te deja esa evidencia, y es **sin costo**.\n\n¿Lo agendamos?\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, ¿quién lo lleva en {{company}}?', 'body',
      E'Hola {{first_name}},\n\nSi el programa de mantenimiento eléctrico lo lleva alguien más, ¿me dices con quién? Le escribo de tu parte.\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, lo dejo aquí', 'body',
      E'Hola {{first_name}},\n\nLo dejo aquí por ahora. Cuando necesites agendar tu mantenimiento eléctrico, búscame y lo vemos sin trámite.\n\nSi prefieres que no te escriba, responde "baja".\n\nFrancisco')),
  -- Ronda 3 · el recibo de CFE
  'R3', jsonb_build_array(
    jsonb_build_object('subject','{{first_name}}, ¿CFE les cobra por factor de potencia?', 'body',
      E'Hola {{first_name}},\n\nUna revisión que casi nadie hace: el **cargo por factor de potencia** en el recibo de CFE. Cuando baja de 90 %, CFE cobra un recargo cada mes y muchas plantas lo pagan sin notarlo.\n\nSi me compartes un recibo reciente de {{company}}, en dos días te digo si hay recargo y cuánto se recupera. Sin costo.\n\nFrancisco Cuellar\nENNCO'),
    jsonb_build_object('subject','{{first_name}}, el recargo que no se ve', 'body',
      E'Hola {{first_name}},\n\nEl recargo por factor de potencia viene en el recibo, en una línea que casi nadie lee. Se corrige con un banco de capacitores bien calculado y la inversión suele pagarse sola.\n\n¿Me mandas un recibo para revisarlo?\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, ¿quién ve el recibo de luz?', 'body',
      E'Hola {{first_name}},\n\nSi el recibo de CFE lo revisa otra persona en {{company}}, ¿me dices quién? Le escribo de tu parte.\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, queda pendiente', 'body',
      E'Hola {{first_name}},\n\nLo dejo por ahora. Si algún mes el recibo sube sin razón, búscame y lo revisamos.\n\nSi prefieres que no te escriba, responde "baja".\n\nFrancisco')),
  -- Ronda 4 · solar
  'R4', jsonb_build_array(
    jsonb_build_object('subject','{{first_name}}, paneles y la deducción del 100 %', 'body',
      E'Hola {{first_name}},\n\n¿En {{company}} ya evaluaron paneles solares? La inversión es **deducible al 100 % en el primer año**, y en plantas que consumen de día el retorno suele ser corto.\n\nSi ya tienen paneles, te ofrezco lo contrario: una revisión termográfica para saber si rinden lo que pagaron.\n\n¿Cuál de las dos te sirve?\n\nFrancisco Cuellar\nENNCO'),
    jsonb_build_object('subject','{{first_name}}, cuánto generaría {{company}}', 'body',
      E'Hola {{first_name}},\n\nCon los recibos de luz del último año te preparo un estudio: cuánto generaría un sistema solar, cuánto cuesta y en cuántos años se paga. Sin costo y sin compromiso.\n\n¿Te lo preparo?\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, ¿con quién lo reviso?', 'body',
      E'Hola {{first_name}},\n\nSi esto lo decide otra persona en {{company}}, ¿me dices con quién? Le escribo de tu parte.\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, queda abierto', 'body',
      E'Hola {{first_name}},\n\nLo dejo abierto. Cuando quieran revisar números de solar o de mantenimiento, búscame.\n\nSi prefieres que no te escriba, responde "baja".\n\nFrancisco')),
  -- Ronda 5 · cierre
  'R5', jsonb_build_array(
    jsonb_build_object('subject','{{first_name}}, ¿sigue siendo tema?', 'body',
      E'Hola {{first_name}},\n\nTe he escrito un par de veces sobre la instalación eléctrica de {{company}} y no quiero ser el proveedor que insiste de más.\n\nSolo una pregunta: ¿es tema para este año o lo dejamos para después? Con un sí o un no me ayudas mucho.\n\nFrancisco Cuellar\nENNCO'),
    jsonb_build_object('subject','{{first_name}}, una idea concreta', 'body',
      E'Hola {{first_name}},\n\nPor si ayuda a decidir: el levantamiento termográfico con dron dura media hora, no para la operación y te deja un reporte con fecha. Sin costo.\n\n¿Te lo agendo?\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, ¿me pasas el contacto?', 'body',
      E'Hola {{first_name}},\n\nSi hay alguien en {{company}} a quien le sirva más, ¿me pasas su contacto?\n\nFrancisco'),
    jsonb_build_object('subject','{{first_name}}, cierro', 'body',
      E'Hola {{first_name}},\n\nCierro el seguimiento. Cuando necesites agendar tu mantenimiento, búscame.\n\nSi prefieres que no te escriba, responde "baja".\n\nFrancisco Cuellar\nENNCO'))
  );

  for v in select * from (values
    (1,'DIRECCION','DIRECCION'),(2,'MANTENIMIENTO','MANTENIMIENTO'),(3,'SEGURIDAD','MANTENIMIENTO'),(4,'COMPRAS','DIRECCION'),
    (5,'RONDA_2','R2'),(6,'RONDA_3','R3'),(7,'RONDA_4','R4'),(8,'RONDA_5','R5')) as x(version,key,body_key) loop
    touches := cuerpo->v.body_key;
    insert into public.sequence_versions(organization_id,campaign_id,version,sender_name,sender_title,content_sha256,approved_by,approved_at)
    values (org,v4_id,v.version,'Francisco Cuellar','Director General, ENNCO',
      encode(extensions.digest(convert_to(touches::text,'utf8'),'sha256'),'hex'),grant_uid,clock_timestamp())
    returning id into version_id;
    idx := 0;
    for t in select * from jsonb_array_elements(touches) loop
      idx := idx + 1;
      insert into public.sequence_touches(organization_id,sequence_version_id,touch_number,day_offset,subject_template,body_template)
      values (org,version_id,idx::smallint,offsets[idx]::smallint,t->>'subject',t->>'body');
    end loop;
    if v.version <= 4 then
      variant_rows := variant_rows || jsonb_build_array(jsonb_build_object('key',v.key,'version',v.version,
        'content_sha256',encode(extensions.digest(convert_to(touches::text,'utf8'),'sha256'),'hex')));
    end if;
  end loop;

  manifest := jsonb_build_object('lane','DIRECT','cc_on_reply_email','francisco.cuellar@ennco.com.mx',
    'sequence_source','migración 202609220066_v4_rotacion.sql (junta #6, 22-sep-2026)',
    'sequence_source_sha256',encode(extensions.digest(convert_to(cuerpo::text,'utf8'),'sha256'),'hex'),
    'content_sha256',encode(extensions.digest(convert_to(cuerpo::text||variant_rows::text,'utf8'),'sha256'),'hex'),
    'day_offsets',to_jsonb(offsets),'variants',variant_rows,
    'rotation',jsonb_build_object('wait_days',7,'rounds',jsonb_build_array(
      jsonb_build_object('round',2,'version',5),jsonb_build_object('round',3,'version',6),
      jsonb_build_object('round',4,'version',7),jsonb_build_object('round',5,'version',8))));

  -- Aprobada por Grant en el chat del 22-sep ("ya aplica todos los cambios"): mismo efecto que
  -- approve_direct_lane_campaign, que exige sesión de teckel_admin y aquí no hay sesión.
  update public.campaigns set name='ENNCO · Bajío industrial v4 (gancho y rotación)',
    manifest_json=manifest, manifest_sha256=encode(extensions.digest(convert_to(manifest::text,'utf8'),'sha256'),'hex'),
    direct_lane_max_touches=4, status='APPROVED', direct_lane_state='RUNNING',
    approved_by=grant_uid, approved_at=clock_timestamp(), suppression_snapshot_at=clock_timestamp(), updated_at=clock_timestamp()
  where id=v4_id;
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,record_id,new_data)
  values (org,grant_uid,'DIRECT_LANE_CAMPAIGN_APPROVED','campaigns',v4_id,
    jsonb_build_object('source','migración 066, junta #6','manifest_sha256',encode(extensions.digest(convert_to(manifest::text,'utf8'),'sha256'),'hex')));

  -- La campaña vieja sigue con sus seguimientos, pero con la regla nueva cierra en el cuarto toque.
  update public.campaigns set direct_lane_max_touches=4, updated_at=clock_timestamp()
  where organization_id=org and name='ENNCO · Bajío industrial' and lane='DIRECT';
end $$;

/* ---------- Ganchos: hallazgo con fuente, no afirmación ---------- */
-- Jorge (junta #6): "encontré esto, no sé si es real; si lo es, ustedes deberían…". Cada gancho
-- nombra dónde se leyó y deja abierta la duda. Las ocho fuentes se comprobaron en línea el 22-sep
-- (KOSTAL devuelve 403 a robots; la nota existe). Aprobados por Grant en el mismo chat.

update public.ennco_account_hooks h set hook_text = x.txt, status = 'APPROVED',
  reviewed_by = '614db7d9-f70b-4f8b-b0e2-d5c0190a06b3', reviewed_at = clock_timestamp(), updated_at = clock_timestamp()
from (values
  ('Mubea', 'Leí en GPI News que Mubea abrió una planta en Apaseo el Grande de unos 75 millones de dólares. No sé si el dato esté al día, pero si es así, es justo la etapa en que lo que se montó con prisa en el arranque empieza a dar lata.'),
  ('Ingredion Incorporated', 'Vi en su sitio que Querétaro les entregó tres sellos de bajas emisiones por su cogeneración. No sé cómo esté hoy esa operación, pero si sigue así, la instalación eléctrica que la sostiene es de las que no se pueden parar.'),
  ('FORVIA', 'Leí en GPI News que FORVIA estaba cerrando la tercera ampliación de su planta de electrónicos en Guanajuato. No sé si ya terminó la obra; si es así, obra nueva sobre un tablero existente es donde más fallas aparecen.'),
  ('AAM - American Axle & Manufacturing', 'Leí en el periódico AM que en Silao preparaban líneas de componentes para auto eléctrico. No sé si ya arrancaron; si es así, a ese ritmo no hay ventana para un paro eléctrico.'),
  ('Hutchinson', 'Vi en GPI News que su operación en Guanajuato lleva más de 80 millones de dólares en expansión. No sé qué tan actual sea la cifra, pero si es así, con clientes como Ford y Toyota una falla eléctrica se paga en penalización.'),
  ('Donaldson', 'Leí en la revista TyT que su planta de León es la más grande de Donaldson en Latinoamérica. No sé si sigue siendo así; si lo es, en una instalación de ese tamaño la termografía casi siempre encuentra más de lo esperado.'),
  ('KOSTAL Group', 'Leí en Líder Empresarial que su planta nueva en Querétaro es la primera de electrónica de potencia de KOSTAL en Norteamérica. No sé en qué etapa va; si ya opera, un punto caliente en tablero ahí se paga caro.'),
  ('Dana Incorporated', 'Leí en la revista TyT que ampliaron la planta de Querétaro para hacer cardanes de Toyota. No sé si ya está operando; si es así, ese crecimiento casi siempre se adelanta a la revisión eléctrica.')
) as x(company, txt), public.accounts a
where a.id = h.account_id and a.legal_name = x.company and h.organization_id = 'e0000000-0000-4000-8000-000000000001';

-- Respaldos por giro y estado: menos afirmación, más "lo que vemos".
update public.ennco_hook_fallbacks f set hook_text = x.txt
from (values
  ('automotive', null, 'Lo que más escucho en plantas automotrices del Bajío es que un paro por falla eléctrica se paga por hora, no por la reparación.'),
  ('food & beverages', null, 'En alimentos y bebidas, lo que me cuentan es que una caída eléctrica no solo para la línea: se lleva el producto que iba en proceso.'),
  ('food production', null, 'En alimentos y bebidas, lo que me cuentan es que una caída eléctrica no solo para la línea: se lleva el producto que iba en proceso.'),
  ('plastics', null, 'En plásticos, un disparo de tablero a media corrida suele llevarse el molde y el turno completo.'),
  ('chemicals', null, 'En química, la instalación eléctrica suele ser de lo primero que revisa una auditoría y de lo último que se documenta.'),
  ('pharmaceuticals', null, 'En farmacéutica, lo caro no suele ser la falla: es demostrar en qué condición estaba la instalación cuando ocurrió.'),
  (null, 'Guanajuato', 'En el corredor de Guanajuato me he encontrado con que pocas plantas tienen por escrito en qué condición está su instalación eléctrica.'),
  (null, 'Querétaro', 'En Querétaro me he encontrado con que pocas plantas tienen por escrito en qué condición está su instalación eléctrica.'),
  (null, null, 'Me he encontrado con que pocas plantas tienen por escrito, con evidencia, en qué condición está hoy su instalación eléctrica.')
) as x(sector, state, txt)
where f.organization_id = 'e0000000-0000-4000-8000-000000000001'
  and f.sector is not distinct from x.sector and f.state is not distinct from x.state;

/* ---------- 20 por buzón, 100 al día ---------- */
-- El tope que realmente limita es direct_lane_effective_cap (el trigger de envío lo aplica al
-- total del día). Tope fijo de 20 y techo de 20: seguimientos primero, nuevos con lo que sobre.

update public.mailboxes
set direct_lane_ramp_mode = 'FIXED', direct_lane_fixed_cap = 20, direct_lane_cap_max = 20, updated_at = clock_timestamp()
where organization_id = 'e0000000-0000-4000-8000-000000000001' and direct_lane_status is not null;

insert into public.audit_log(organization_id, action, record_type, record_id, new_data)
select organization_id, 'DIRECT_LANE_MAILBOX_CAP', 'mailboxes', id, jsonb_build_object('fixed_cap', 20, 'cap_max', 20, 'source', 'junta #6')
from public.mailboxes where organization_id = 'e0000000-0000-4000-8000-000000000001' and direct_lane_status is not null;

/* ---------- Supervisor diario (el "director comercial" por reglas) ---------- */
-- Corre después de la ventana de envío. Revisa cada buzón y la campaña, pausa el buzón que rebote
-- demasiado y devuelve un reporte que el cron manda por Telegram. La parte con IA (investigar
-- ganchos, juzgar el texto) se agrega cuando haya llave de API.

create or replace function public.supervise_direct_lane(target_organization_id uuid, apply_pause boolean,
  proof_command_id text, proof_nonce uuid, proof_expires_at timestamptz, proof_signature text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'app', 'extensions', 'pg_temp'
as $$
declare payload_sha text; mb record; boxes jsonb := '[]'::jsonb; paused jsonb := '[]'::jsonb;
  bounce_limit numeric := 0.10; min_sample integer := 30; today date := (clock_timestamp() at time zone 'America/Mexico_City')::date;
  unanswered jsonb; runway integer; new_7d integer; rotations jsonb; hooks jsonb; failed_today integer; stuck integer;
begin
  payload_sha := encode(digest(convert_to(concat_ws(E'\n','supervise_direct_lane',target_organization_id::text,apply_pause::text),'utf8'),'sha256'),'hex');
  perform app.verify_dispatch_proof(target_organization_id,proof_command_id,proof_nonce,proof_expires_at,payload_sha,proof_signature);

  for mb in
    select m.id, m.normalized_email, m.direct_lane_status, app.direct_lane_effective_cap(m) as cap,
      app.direct_lane_sent_today(target_organization_id, m.id) as sent_today,
      (select count(*) from public.messages x where x.organization_id=target_organization_id and x.mailbox_id=m.id
        and x.lane='DIRECT' and x.direction='OUTBOUND' and x.status in ('SENT','DELIVERED','BOUNCED')
        and x.sent_at > clock_timestamp() - interval '7 days') as sent_7d,
      (select count(*) from public.messages x where x.organization_id=target_organization_id and x.mailbox_id=m.id
        and x.lane='DIRECT' and x.direction='OUTBOUND' and x.status='BOUNCED'
        and x.sent_at > clock_timestamp() - interval '7 days') as bounced_7d
    from public.mailboxes m
    where m.organization_id=target_organization_id and m.direct_lane_status in ('CONNECTED','PAUSED')
    order by m.normalized_email
  loop
    boxes := boxes || jsonb_build_array(jsonb_build_object('email', mb.normalized_email, 'status', mb.direct_lane_status,
      'cap', mb.cap, 'sent_today', mb.sent_today, 'sent_7d', mb.sent_7d, 'bounced_7d', mb.bounced_7d,
      'bounce_rate_7d', case when mb.sent_7d > 0 then round(mb.bounced_7d::numeric / mb.sent_7d, 4) else null end));
    if apply_pause and mb.direct_lane_status = 'CONNECTED' and mb.sent_7d >= min_sample
      and mb.bounced_7d::numeric / mb.sent_7d > bounce_limit then
      update public.mailboxes set direct_lane_status = 'PAUSED', updated_at = clock_timestamp()
      where organization_id = target_organization_id and id = mb.id;
      insert into public.audit_log(organization_id, action, record_type, record_id, new_data)
      values (target_organization_id, 'DIRECT_LANE_SUPERVISOR_PAUSED', 'mailboxes', mb.id,
        jsonb_build_object('bounced_7d', mb.bounced_7d, 'sent_7d', mb.sent_7d, 'limit', bounce_limit));
      paused := paused || to_jsonb(mb.normalized_email);
    end if;
  end loop;

  select count(*) into failed_today from public.messages x
  where x.organization_id=target_organization_id and x.lane='DIRECT' and x.direction='OUTBOUND' and x.status='FAILED'
    and (x.updated_at at time zone 'America/Mexico_City')::date = today;
  select count(*) into stuck from public.campaign_enrollments e
  where e.organization_id=target_organization_id and e.status='PAUSED' and e.stopped_reason like 'DISPATCH_FAILED%';

  -- Respuestas humanas de los últimos 14 días que llevan más de un día sin contestar.
  select coalesce(jsonb_agg(jsonb_build_object('contact', c.normalized_email, 'company', a.legal_name,
    'hours', floor(extract(epoch from clock_timestamp() - e.updated_at) / 3600)) order by e.updated_at), '[]'::jsonb)
  into unanswered
  from public.campaign_enrollments e
  join public.campaigns ca on ca.id = e.campaign_id and ca.lane = 'DIRECT' and ca.name not like 'PRUEBA%'
  join public.contacts c on c.id = e.contact_id
  join public.accounts a on a.id = e.account_id
  where e.organization_id = target_organization_id and e.status = 'REPLIED'
    and e.updated_at < clock_timestamp() - interval '24 hours' and e.updated_at > clock_timestamp() - interval '14 days'
    and not exists (select 1 from public.messages r where r.organization_id = target_organization_id
      and r.enrollment_id = e.id and r.direction = 'OUTBOUND' and r.touch_number is null and r.created_at > e.updated_at);

  -- Cuántos contactos verificados nunca han recibido nada, y a qué ritmo se están usando.
  select count(*) into runway from public.contacts c join public.accounts a on a.id = c.account_id
  where c.organization_id = target_organization_id and c.verified and not c.is_deleted and not a.is_deleted
    and not exists (select 1 from public.campaign_enrollments e where e.organization_id = target_organization_id and e.contact_id = c.id);
  select count(*) into new_7d from public.messages x
  where x.organization_id=target_organization_id and x.lane='DIRECT' and x.direction='OUTBOUND' and x.touch_number=1
    and x.status in ('SENT','DELIVERED','BOUNCED') and x.sent_at > clock_timestamp() - interval '7 days';

  select jsonb_build_object(
    'scheduled_next_7d', count(*) filter (where e.status='PENDING' and e.rotation_round>1 and e.next_touch_at < clock_timestamp() + interval '7 days'),
    'active_by_round', coalesce((select jsonb_object_agg('R'||r, n) from (select e2.rotation_round r, count(*) n from public.campaign_enrollments e2
      where e2.organization_id=target_organization_id and e2.status in ('PENDING','ACTIVE') group by 1) q), '{}'::jsonb))
  into rotations from public.campaign_enrollments e where e.organization_id=target_organization_id;

  select jsonb_build_object('approved', count(*) filter (where status='APPROVED'), 'draft', count(*) filter (where status='DRAFT'))
  into hooks from public.ennco_account_hooks where organization_id=target_organization_id;

  return jsonb_build_object('date', today, 'mailboxes', boxes, 'paused_now', paused, 'bounce_limit', bounce_limit,
    'failed_today', failed_today, 'enrollments_stuck', stuck, 'unanswered_replies', unanswered,
    'never_contacted', runway, 'new_contacts_7d', new_7d,
    'runway_days', case when new_7d > 0 then round(runway / (new_7d / 5.0)) else null end,
    'rotation', rotations, 'hooks', hooks);
end $$;

revoke all on function public.supervise_direct_lane(uuid, boolean, text, uuid, timestamptz, text) from public;
grant execute on function public.supervise_direct_lane(uuid, boolean, text, uuid, timestamptz, text) to anon, authenticated;

/* ---------- La campaña vieja entra a la regla de cuatro toques ---------- */
-- Quienes ya recibieron su cuarto toque (esperaban el quinto) cierran su ronda y quedan
-- agendados para la ronda 2 desde otro buzón, siete días después de su último correo. Va al final
-- porque la rotación necesita la v4 ya en marcha.

update public.campaign_enrollments e
set status = 'COMPLETED', stopped_reason = 'SEQUENCE_COMPLETED', next_touch_at = null, updated_at = clock_timestamp()
from public.campaigns c
where c.id = e.campaign_id and c.organization_id = 'e0000000-0000-4000-8000-000000000001'
  and c.name = 'ENNCO · Bajío industrial' and e.status = 'ACTIVE' and e.next_touch_number > 4;

commit;
