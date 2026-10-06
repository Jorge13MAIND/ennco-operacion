"""Genera supabase/migrations/202610060104_positivos_y_respuestas_automaticas.sql (6-oct-2026, Grant).

Grant, después del lead de Condumex que se quedó sin respuesta:
  · "Prefiero que haya falsos positivos": toda respuesta humana que no sea claramente negativa es
    positiva (la regla vive en src/lib/correos/sdr/policy.ts). Aquí, la base la califica como lead
    positivo en el momento en que el SDR decide, sin esperar al envío: lead, oportunidad en
    CONVERSATION y respuesta marcada POSITIVE. El correo simple con copia a Paco sale como ya salía.
  · Respuestas automáticas: "Regreso a la oficina el 12 de octubre" → el 13 le sale el siguiente toque
    (si cae en fin de semana o festivo, el siguiente día hábil). Sin fecha, 7 días después. Si llegó en
    el toque 4, se adelanta la siguiente ronda a ese día. "Ya no trabajo aquí" o cuenta deshabilitada:
    se detiene, se suprime ese correo y los correos que mencione quedan como referidos para Paco, sin
    escribirles solos.
Outlook manda la respuesta automática como correo nuevo, fuera del hilo, así que se enlaza por
remitente con lo último que ese buzón le envió (45 días). La detección vive en
src/lib/correos/auto-reply.ts; el sync llama a public.apply_direct_lane_auto_reply.
Este archivo no lleva datos de contactos: el repositorio es público. El rezago se aplica aparte.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LIVE = ROOT / "tools/correos/vivas-104"
OUT = ROOT / "supabase/migrations/202610060104_positivos_y_respuestas_automaticas.sql"


def patch(name: str, pairs: list[tuple[str, str]]) -> str:
    sql = (LIVE / f"{name}.sql").read_text()
    for old, new in pairs:
        n = sql.count(old)
        if n != 1:
            raise SystemExit(f"{name}: se esperaba 1 coincidencia y hay {n} para: {old[:90]!r}")
        sql = sql.replace(old, new)
    return sql.rstrip() + ";\n"


sdr_command = patch("email_sdr_command", [
    ("""      where pe.organization_id=target_organization_id and pe.event_kind in ('REPLY','AUTO_REPLY') and m.direction='INBOUND'
""",
     """      where pe.organization_id=target_organization_id and pe.event_kind in ('REPLY','AUTO_REPLY') and m.direction='INBOUND'
        and not (pe.payload_json ? 'auto_handled')
"""),
    ("""      next_action=left(coalesce(p->>'next_action','Revisión humana requerida'),1000),lease_until=null,updated_at=clock_timestamp() where id=c.id;
    return jsonb_build_object('status','RECORDED');""",
     """      next_action=left(coalesce(p->>'next_action','Revisión humana requerida'),1000),lease_until=null,updated_at=clock_timestamp() where id=c.id;
    -- 6-oct (Grant): un positivo queda calificado en cuanto se decide, aunque el envío espere o se frene.
    if p->'decision'->>'subtype' in ('POSITIVE_ACCEPT','POSITIVE_VISIT') and e.event_kind='REPLY' then
      perform app.email_sdr_classify_positive(target_organization_id,c.id);
    end if;
    return jsonb_build_object('status','RECORDED');"""),
])

sql = f"""-- 104 · Positivos inmediatos y respuestas automáticas (6-oct-2026).
-- Generado por tools/correos/gen-104.py desde tools/correos/vivas-104/. Ver el docstring del generador.

begin;

set local app.operations_rpc_write = 'on';

-- Referidos que deja un contacto que ya no está. Paco decide; nadie les escribe solo.
create table if not exists public.email_contact_referrals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  contact_id uuid not null references public.contacts(id),
  account_id uuid references public.accounts(id),
  referred_email text not null check (referred_email ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{{2,24}}$'),
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
      if referral ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{{2,24}}$' and referral <> from_email then
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
  payload_sha := encode(digest(convert_to(concat_ws(E'\\n', 'apply_direct_lane_auto_reply', target_organization_id::text, target_mailbox_id::text,
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

{sdr_command}
insert into public.audit_log (organization_id, action, record_type, new_data)
select s.organization_id, 'EMAIL_SDR_POLICY_EXPANDED', 'email_sdr_settings',
  jsonb_build_object('source', 'migración 104', 'positives', 'todo lo no negativo', 'auto_replies', 'OOO reprograma, GONE detiene y guarda referidos',
    'order', 'Grant 6-oct: prefiero falsos positivos; fuera de oficina retoma el día hábil siguiente al regreso')
from app.email_sdr_settings s;

commit;
"""
OUT.write_text(sql)
print(OUT, len(sql))
