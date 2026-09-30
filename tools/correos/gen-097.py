"""Genera supabase/migrations/202609300097_respuesta_positiva_auto.sql (30-sep-2026, Grant).

Grant: cuando llega una respuesta positiva, el mismo buzón contesta en el mismo hilo con copia a
Paco (francisco.cuellar@ennco.com.mx). Decisiones: automática con candados (solo interés explícito
o solicitud de visita, confianza >= 0.9, plantilla fija), sin proponer fechas, espera aleatoria de
10 a 25 min dentro de 8:00-18:00 L-V, detener la secuencia y marcar oportunidad.

Sobre el SDR de Jorge (078/086/089), sin quitarle candados:
  · Plantillas por subtipo (POSITIVE_VISIT, POSITIVE_ACCEPT) en app.email_sdr_templates y cuerpos
    aprobados por caso en app.email_sdr_body_overrides. DECIDE guarda como borrador el texto
    exacto que saldrá; QUEUE envía ese mismo texto.
  · QUEUE: en automático solo los subtipos positivos, con 2 canarios revisados (eran 5) y espera
    programada (email_sdr_cases.send_after). Lo aprobado a mano sale sin espera.
  · Positivo enviado: sin seguimientos automáticos, respuesta POSITIVE, lead, oportunidad en
    CONVERSATION y aviso confirmado (un positivo atendido no debe pausar la campaña).
  · Un positivo programado no cuenta como aviso pendiente mientras espera su hora.
  · Una respuesta en cola ya no se frena porque el buzón llenó su tope del día.
  · Este archivo NO cambia el modo: sigue en REVIEW hasta que Grant apruebe los dos canarios.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LIVE = ROOT / "tools/correos/vivas-097"
OUT = ROOT / "supabase/migrations/202609300097_respuesta_positiva_auto.sql"
POSITIVE = "('POSITIVE_ACCEPT','POSITIVE_VISIT')"


def patch(name: str, pairs: list[tuple[str, str]]) -> str:
    sql = (LIVE / f"{name}.sql").read_text()
    for old, new in pairs:
        n = sql.count(old)
        if n != 1:
            raise SystemExit(f"{name}: se esperaba 1 coincidencia y hay {n} para: {old[:90]!r}")
        sql = sql.replace(old, new)
    return sql.rstrip() + ";\n"


command = patch("email_sdr_command", [
    # WORK: la conciliación sabe si el caso era un positivo.
    ("for row_value in select sc.id,m.status,m.sent_at,m.provider_message_id from public.email_sdr_cases sc",
     "for row_value in select sc.id,m.status,m.sent_at,m.provider_message_id,sc.decision->>'subtype' as subtype from public.email_sdr_cases sc"),
    # Positivo enviado: Paco toma la conversación; nada de seguimientos del robot encima.
    ("""        update public.email_sdr_cases set state='SENT',initial_sent_at=coalesce(initial_sent_at,row_value.sent_at),
          next_due_at=case when followups_sent<2 then""",
     f"""        update public.email_sdr_cases set state='SENT',initial_sent_at=coalesce(initial_sent_at,row_value.sent_at),
          next_due_at=case when row_value.subtype in {POSITIVE} then null when followups_sent<2 then"""),
    ("""          next_action=case when followups_sent<2 then 'Seguimiento por email sujeto a revisión de conversación y calendario' else 'Seguimiento concluido' end,updated_at=clock_timestamp()
          where id=row_value.id;""",
     f"""          next_action=case when row_value.subtype in {POSITIVE} then 'Respondida automáticamente con copia a Paco. Paco coordina desde su correo'
            when followups_sent<2 then 'Seguimiento por email sujeto a revisión de conversación y calendario' else 'Seguimiento concluido' end,updated_at=clock_timestamp()
          where id=row_value.id;
        if row_value.subtype in {POSITIVE} then perform app.email_sdr_mark_positive(target_organization_id,row_value.id); end if;"""),
    # WORK: un positivo programado espera su hora.
    ("and (sc.state='READY' or (sc.state='SENT' and sc.next_due_at<=clock_timestamp() and sc.followups_sent<2))",
     "and ((sc.state='READY' and coalesce(sc.send_after,'-infinity'::timestamptz)<=clock_timestamp()) or (sc.state='SENT' and sc.next_due_at<=clock_timestamp() and sc.followups_sent<2))"),
    # DECIDE: el borrador de un positivo es el texto exacto que saldrá.
    ("update public.email_sdr_cases set decision=p->'decision',thread_hash=p->>'thread_hash'",
     f"update public.email_sdr_cases set decision=case when p->'decision'->>'subtype' in {POSITIVE} then p->'decision'||jsonb_build_object('draft',coalesce(app.email_sdr_positive_body(target_organization_id,c.id,p->'decision'->>'subtype'),'')) else p->'decision' end,thread_hash=p->>'thread_hash'"),
    # QUEUE: en automático, solo positivos y con 2 canarios.
    ("if cfg.mode<>'AUTO' or reviewed_count<5 or not intent=any(cfg.auto_intents)",
     f"if cfg.mode<>'AUTO' or reviewed_count<2 or not intent=any(cfg.auto_intents) or coalesce(c.decision->>'subtype','') not in {POSITIVE}"),
    # QUEUE: espera aleatoria de 10 a 25 min dentro de la ventana; lo aprobado a mano no espera.
    ("""    followup:=coalesce((p->>'followup')::boolean,false);
    if followup and""",
     f"""    followup:=coalesce((p->>'followup')::boolean,false);
    if not followup and not(c.approved and c.reviewed_thread_hash=c.thread_hash and c.reviewed_policy_version=cfg.policy_version) then
      if c.send_after is null or c.send_after>clock_timestamp() or not app.direct_lane_campaign_window_open(clock_timestamp()) then
        update public.email_sdr_cases set send_after=case when c.send_after is not null and c.send_after>clock_timestamp() then c.send_after
            else app.email_sdr_next_send_at(greatest(coalesce(e.observed_at,inbound.created_at),coalesce(c.send_after,'-infinity'::timestamptz)),c.id::text) end,
          state='READY',next_action='Respuesta automática programada con copia a Paco',lease_until=null,updated_at=clock_timestamp()
          where id=c.id returning send_after into next_due;
        if next_due>clock_timestamp()+interval '30 seconds' then return jsonb_build_object('status','HOLD','reason','SCHEDULED','send_after',next_due); end if;
      end if;
    end if;
    if followup and"""),
    # QUEUE: el cuerpo del positivo sale de la plantilla aprobada (o del texto aprobado para ese caso).
    ("""      when intent='CONTEXT' then E'Claro.""",
     f"""      when c.decision->>'subtype' in {POSITIVE} then app.email_sdr_positive_body(target_organization_id,c.id,c.decision->>'subtype')
      when intent='CONTEXT' then E'Claro."""),
    ("""    select * into mailbox from public.mailboxes where organization_id=target_organization_id and id=inbound.mailbox_id;
    insert into public.messages(""",
     """    if nullif(btrim(body_value),'') is null then return jsonb_build_object('status','HOLD','reason','TEMPLATE_NOT_APPROVED'); end if;
    select * into mailbox from public.mailboxes where organization_id=target_organization_id and id=inbound.mailbox_id;
    insert into public.messages("""),
])

claim = patch("claim_direct_lane_dispatch", [
    ("""    if found then
      if budget_spent then return app.direct_lane_noop(target_organization_id,target_mailbox_id,'BUDGET_EXHAUSTED',null); end if;
""", """    if found then
"""),
])

alert_work = patch("email_sdr_alert_work", [
    ("""    where c.organization_id=target_org and n.channel='CONTROL_ROOM' and n.status<>'DELIVERED';""",
     """    where c.organization_id=target_org and n.channel='CONTROL_ROOM' and n.status<>'DELIVERED'
      and not (c.state='READY' and c.send_after>clock_timestamp());"""),
    ("""    where c.organization_id=target_org and n.channel='CONTROL_ROOM' and n.status<>'DELIVERED'
      and n.created_at<=clock_timestamp()-interval '15 minutes'""",
     """    where c.organization_id=target_org and n.channel='CONTROL_ROOM' and n.status<>'DELIVERED'
      and n.created_at<=clock_timestamp()-interval '15 minutes'
      and not (c.state='READY' and c.send_after>clock_timestamp())"""),
])

set_mode = patch("set_email_sdr_mode", [
    ("if reviewed<5 or cfg.acceptance_evidence", "if reviewed<2 or cfg.acceptance_evidence"),
    ("then raise exception 'SDR_FIVE_REVIEWED_CANARIES_REQUIRED'", "then raise exception 'SDR_REVIEWED_CANARIES_REQUIRED'"),
])

TEMPLATE_VISIT = (
    "Hola {{first_name}},\\n\\n"
    "Gracias por la respuesta. Con gusto vamos a su planta a hacer el recorrido con el dron.\\n\\n"
    "Te copio mi correo principal, francisco.cuellar@ennco.com.mx. Desde ahí coordinamos la visita.\\n\\n"
    "¿Hay algún requisito de acceso que debamos cubrir antes, como alta de proveedor, equipo de seguridad o permiso para volar el dron?\\n\\n"
    "Saludos,\\nFrancisco Cuellar\\nENNCO"
)
TEMPLATE_ACCEPT = (
    "Hola {{first_name}},\\n\\n"
    "Gracias, con gusto. Es un recorrido de media hora con cámara térmica y dron, sin costo, y de ahí sale el reporte para {{company}}.\\n\\n"
    "¿Con quién de mantenimiento o de la planta lo coordino?\\n\\n"
    "Te copio mi correo principal, francisco.cuellar@ennco.com.mx, para darle seguimiento desde ahí.\\n\\n"
    "Saludos,\\nFrancisco Cuellar\\nENNCO"
)
BODY_NATURAL = (
    "Hola Juan,\\n\\n"
    "Gracias por la respuesta y perdón por la demora. Con gusto vamos a San Juan del Río a hacer el recorrido con el dron que te comenté.\\n\\n"
    "Te copio mi correo principal, francisco.cuellar@ennco.com.mx. Desde ahí coordinamos la visita.\\n\\n"
    "¿Hay algún requisito de acceso que debamos cubrir antes, como alta de proveedor, equipo de seguridad o permiso para volar el dron?\\n\\n"
    "Saludos,\\nFrancisco Cuellar\\nENNCO"
)
BODY_DEDIENNE = (
    "Hola Leticia,\\n\\n"
    "Gracias, con gusto lo preparo para DEDIENNE AEROSPACE. Perdón por la demora.\\n\\n"
    "El reporte sale de un recorrido de media hora con cámara térmica y dron, sin costo. Como estás en compras, ¿con quién de mantenimiento o de la planta lo coordino?\\n\\n"
    "Te copio mi correo principal, francisco.cuellar@ennco.com.mx, para darle seguimiento desde ahí.\\n\\n"
    "Saludos,\\nFrancisco Cuellar\\nENNCO"
)
for text in (TEMPLATE_VISIT, TEMPLATE_ACCEPT, BODY_NATURAL, BODY_DEDIENNE):
    assert "—" not in text and "–" not in text and "'" not in text

ORG = "e0000000-0000-4000-8000-000000000001"
GRANT = "614db7d9-f70b-4f8b-b0e2-d5c0190a06b3"

sql = f"""-- 097 · Respuesta automática a respuestas positivas (30-sep-2026). Generado por tools/correos/gen-097.py
-- desde las definiciones vivas de tools/correos/vivas-097/. Ver el docstring del generador.
-- Reversa: update app.email_sdr_settings set mode='REVIEW';  (nada sale en automático en REVIEW)

begin;

set local app.operations_rpc_write = 'on';

alter table public.email_sdr_cases add column if not exists send_after timestamptz;
comment on column public.email_sdr_cases.send_after is
  'Hora programada de la respuesta automática a un positivo (10 a 25 min después, dentro de 8:00-18:00 L-V).';

create table if not exists app.email_sdr_templates (
  subtype text primary key check (subtype in {POSITIVE}),
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
  ('POSITIVE_VISIT', E'{TEMPLATE_VISIT}', 'positivos-v1-2026-09-30', 'Grant (plan 30-sep)'),
  ('POSITIVE_ACCEPT', E'{TEMPLATE_ACCEPT}', 'positivos-v1-2026-09-30', 'Grant (plan 30-sep)')
on conflict (subtype) do update set body=excluded.body, version=excluded.version, approved_by=excluded.approved_by, approved_at=clock_timestamp();

-- Las dos primeras (llevan 1 y 2 días de atraso): texto propio con disculpa. Solo salen si Grant las aprueba.
insert into app.email_sdr_body_overrides(organization_id, case_id, body, reason, approved_by) values
  ('{ORG}', '06344ccb-daf9-4c02-a2c1-2f2b0e28fc77', E'{BODY_NATURAL}',
   'Natural de Alimentos pidió visita el 29-sep; respuesta tardía con disculpa, canario 1', 'Grant (plan 30-sep)'),
  ('{ORG}', '651bbc50-dd68-40cb-b777-58806407eef3', E'{BODY_DEDIENNE}',
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

{command}
{claim}
{alert_work}
{set_mode}
-- Solo los positivos pueden salir en automático (CONTEXT queda a revisión humana). El modo no cambia.
update app.email_sdr_settings set auto_intents=array['EXPLICIT_INTEREST'], updated_at=clock_timestamp()
where organization_id='{ORG}';

-- Los dos positivos pendientes vuelven a evaluarse con el detector nuevo (quedan en REVIEW para Grant).
update public.email_sdr_cases set state='READY', lease_until=null, updated_at=clock_timestamp()
where organization_id='{ORG}' and id in ('06344ccb-daf9-4c02-a2c1-2f2b0e28fc77','651bbc50-dd68-40cb-b777-58806407eef3')
  and state='REVIEW';

insert into public.audit_log(organization_id, actor_user_id, action, record_type, record_id, new_data)
values ('{ORG}', '{GRANT}', 'EMAIL_SDR_POSITIVE_AUTO_CONFIGURED', 'organizations', '{ORG}',
  jsonb_build_object('source','migración 097','templates','positivos-v1-2026-09-30','canaries_required',2,'delay_minutes','10-25','window','08:00-18:00 L-V'));

commit;
"""
OUT.write_text(sql)
print(OUT, len(sql))
