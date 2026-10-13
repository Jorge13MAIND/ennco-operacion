"""Genera supabase/migrations/202610130109_crm.sql (13-oct-2026, Grant).

Pestaña CRM en el hub: todos los contactos que respondieron a los correos, con pipeline al estilo
Twenty y del CRM del Teckel Hub. Decisiones de Grant (13-oct):
  · Etapas del proceso de Paco (informe del 12-oct): Respondió, Calificado, Llamada o visita,
    Levantamiento, Propuesta, Negociación, Ganado, Perdido. Más "Descartado" para los negativos.
  · Entran todas las respuestas humanas (no las automáticas). Los negativos entran descartados con su
    motivo; positivos y dudosos, en Respondió (por calificar).
  · Oscar es el responsable por defecto. Para pasar a Calificado o más allá se exigen las 4
    condiciones de Paco y una siguiente acción con fecha y responsable.
  · Extras: contactos a mano (referidos, llamadas), valor en MXN, recordatorios por Telegram y
    exportar a Excel.
El CRM es una capa propia (crm_records) y no toca opportunities: sus candados contractuales
(sin saltar etapas, Ganado con aprobación canónica) son para el reporte de comisiones, no para el día
a día de Oscar y Paco.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LIVE = ROOT / "tools/correos/vivas-109"
OUT = ROOT / "supabase/migrations/202610130109_crm.sql"
ORG = "e0000000-0000-4000-8000-000000000001"
OSCAR = "518ca09c-47f4-46a7-aa78-99ac474d6b39"


def patch(name: str, pairs: list[tuple[str, str]]) -> str:
    sql = (LIVE / f"{name}.sql").read_text()
    for old, new in pairs:
        n = sql.count(old)
        if n != 1:
            raise SystemExit(f"{name}: se esperaba 1 coincidencia y hay {n} para: {old[:90]!r}")
        sql = sql.replace(old, new)
    return sql.rstrip() + ";\n"


sdr_command = patch("email_sdr_command", [
    ("""  elsif op='TELEGRAM_WORK' then""",
     """  elsif op='CRM_REMINDERS_WORK' then
    return app.crm_reminders_work(target_organization_id);
  elsif op='CRM_REMINDERS_SETTLE' then
    return app.crm_reminders_settle(target_organization_id,p->>'kind',(p->>'id')::uuid,(p->>'delivered')::boolean);
  elsif op='TELEGRAM_WORK' then"""),
    ("""      perform app.email_sdr_classify_positive(target_organization_id,c.id);
    end if;
    return jsonb_build_object('status','RECORDED');""",
     """      perform app.email_sdr_classify_positive(target_organization_id,c.id);
    end if;
    -- 13-oct: toda respuesta humana entra al CRM en cuanto el SDR la clasifica.
    if e.event_kind='REPLY' then perform app.crm_upsert_from_reply(target_organization_id,e.id); end if;
    return jsonb_build_object('status','RECORDED');"""),
    ("""    update public.email_sdr_cases set state='SUPPRESSED',next_due_at=null,next_action='Baja aplicada. No enviar',lease_until=null,updated_at=clock_timestamp() where id=c.id;""",
     """    update public.email_sdr_cases set state='SUPPRESSED',next_due_at=null,next_action='Baja aplicada. No enviar',lease_until=null,updated_at=clock_timestamp() where id=c.id;
    if e.event_kind='REPLY' then perform app.crm_upsert_from_reply(target_organization_id,e.id); end if;"""),
])

STAGES = "'RESPONDIO','CALIFICADO','LLAMADA_VISITA','LEVANTAMIENTO','PROPUESTA','NEGOCIACION','GANADO','PERDIDO','DESCARTADO'"
SERVICES = "'TERMOGRAFIA_DRON','MANTENIMIENTO','SUBESTACION','PANELES_SOLARES','NOM_029','CALIDAD_ENERGIA','OTRO'"

sql = f"""-- 109 · CRM de respuestas (13-oct-2026). Generado por tools/correos/gen-109.py desde
-- tools/correos/vivas-109/. Ver el docstring del generador.

begin;

set local app.operations_rpc_write = 'on';

create table if not exists app.crm_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  default_owner_user_id uuid,
  reminders_enabled boolean not null default true,
  updated_at timestamptz not null default clock_timestamp()
);
alter table app.crm_settings enable row level security;
revoke all on app.crm_settings from public, anon, authenticated;
insert into app.crm_settings (organization_id, default_owner_user_id) values ('{ORG}', '{OSCAR}')
on conflict (organization_id) do nothing;

create table if not exists public.crm_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id),
  account_id uuid references public.accounts(id),
  source text not null check (source in ('CORREO','MANUAL','REFERIDO')),
  full_name text not null check (length(btrim(full_name)) between 1 and 200),
  email text check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  phone text check (phone is null or length(phone) between 7 and 40),
  role_title text check (role_title is null or length(role_title) <= 200),
  company_name text check (company_name is null or length(company_name) <= 200),
  city text check (city is null or length(city) <= 120),
  state text check (state is null or length(state) <= 120),
  stage text not null default 'RESPONDIO' check (stage in ({STAGES})),
  owner_user_id uuid,
  service_interest text check (service_interest is null or service_interest in ({SERVICES})),
  value_mxn numeric(14,2) check (value_mxn is null or value_mxn >= 0),
  next_action text check (next_action is null or length(next_action) <= 500),
  next_action_at timestamptz,
  close_reason text check (close_reason is null or length(close_reason) <= 500),
  qualification jsonb not null default '{{}}'::jsonb,
  reply_intent text,
  last_reply_event_id uuid references public.provider_events(id),
  first_reply_at timestamptz,
  last_reply_at timestamptz,
  last_touch_at timestamptz,
  referred_from_record_id uuid references public.crm_records(id),
  reminded_at timestamptz,
  revision integer not null default 1,
  created_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create unique index if not exists crm_records_contact_unique on public.crm_records (organization_id, contact_id) where contact_id is not null;
create unique index if not exists crm_records_email_unique on public.crm_records (organization_id, lower(email)) where email is not null;
create index if not exists crm_records_stage_idx on public.crm_records (organization_id, stage);

create table if not exists public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  record_id uuid not null references public.crm_records(id) on delete cascade,
  kind text not null check (kind in ('NOTA','LLAMADA','WHATSAPP','REUNION','CAMBIO_ETAPA','EDICION','TAREA','SISTEMA')),
  body text check (body is null or length(body) <= 5000),
  data jsonb not null default '{{}}'::jsonb,
  actor_user_id uuid,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists crm_activities_record_idx on public.crm_activities (record_id, created_at desc);

create table if not exists public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  record_id uuid not null references public.crm_records(id) on delete cascade,
  title text not null check (length(btrim(title)) between 2 and 300),
  due_at timestamptz,
  owner_user_id uuid,
  status text not null default 'PENDIENTE' check (status in ('PENDIENTE','HECHA','CANCELADA')),
  completed_at timestamptz,
  completed_by uuid,
  reminded_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index if not exists crm_tasks_record_idx on public.crm_tasks (record_id, status);

-- La bitácora solo se agrega.
create or replace function app.crm_activities_append_only() returns trigger language plpgsql as $$
begin raise exception 'CRM_ACTIVITY_APPEND_ONLY'; end $$;
drop trigger if exists crm_activities_append_only on public.crm_activities;
create trigger crm_activities_append_only before update or delete on public.crm_activities
  for each row execute function app.crm_activities_append_only();

alter table public.crm_records enable row level security;
alter table public.crm_activities enable row level security;
alter table public.crm_tasks enable row level security;
drop policy if exists crm_records_member_read on public.crm_records;
create policy crm_records_member_read on public.crm_records for select using (app.is_member(organization_id));
drop policy if exists crm_activities_member_read on public.crm_activities;
create policy crm_activities_member_read on public.crm_activities for select using (app.is_member(organization_id));
drop policy if exists crm_tasks_member_read on public.crm_tasks;
create policy crm_tasks_member_read on public.crm_tasks for select using (app.is_member(organization_id));
revoke all on public.crm_records, public.crm_activities, public.crm_tasks from public, anon, authenticated;
grant select on public.crm_records, public.crm_activities, public.crm_tasks to authenticated;

drop trigger if exists crm_records_audit on public.crm_records;
create trigger crm_records_audit after insert or update or delete on public.crm_records
  for each row execute function app.capture_audit_event();
drop trigger if exists crm_tasks_audit on public.crm_tasks;
create trigger crm_tasks_audit after insert or update or delete on public.crm_tasks
  for each row execute function app.capture_audit_event();

create or replace function app.crm_log(target_org uuid, target_record uuid, target_kind text, target_body text, target_data jsonb, target_actor uuid)
returns void language sql security definer set search_path to 'public', 'app', 'pg_temp' as $$
  insert into public.crm_activities (organization_id, record_id, kind, body, data, actor_user_id)
  values (target_org, target_record, target_kind, left(target_body, 5000), coalesce(target_data, '{{}}'::jsonb), target_actor);
$$;

-- Las 4 condiciones de Paco que se marcan a mano. La quinta (siguiente acción con responsable y
-- fecha) se comprueba con los campos del registro.
create or replace function app.crm_qualified(q jsonb) returns boolean language sql immutable as $$
  select coalesce((q->>'mercado')::boolean, false) and coalesce((q->>'contacto')::boolean, false)
    and coalesce((q->>'necesidad')::boolean, false) and coalesce((q->>'avance')::boolean, false);
$$;

-- Toda respuesta humana a una campaña comercial entra al CRM (o actualiza su registro).
create or replace function app.crm_upsert_from_reply(target_org uuid, target_event uuid)
returns uuid language plpgsql security definer set search_path to 'public', 'app', 'pg_temp' as $$
declare e public.provider_events%rowtype; m public.messages%rowtype; ct public.contacts%rowtype;
  a public.accounts%rowtype; campaign_name text; campaign_lane text; sc public.email_sdr_cases%rowtype;
  intent text; subtype text; positive boolean; reason text; rec public.crm_records%rowtype;
  received timestamptz; owner uuid; touch integer;
begin
  select * into e from public.provider_events where organization_id = target_org and id = target_event and event_kind = 'REPLY';
  if not found then return null; end if;
  select * into m from public.messages where organization_id = target_org and id = e.message_id and direction = 'INBOUND';
  if not found or m.contact_id is null then return null; end if;
  select ca.name, ca.lane into campaign_name, campaign_lane from public.campaign_enrollments ce
    join public.campaigns ca on ca.organization_id = ce.organization_id and ca.id = ce.campaign_id
    where ce.organization_id = target_org and ce.id = m.enrollment_id;
  if campaign_lane is distinct from 'DIRECT' or campaign_name ~* '^PRUEBA' then return null; end if;
  select * into ct from public.contacts where organization_id = target_org and id = m.contact_id;
  select * into a from public.accounts where organization_id = target_org and id = ct.account_id;
  select * into sc from public.email_sdr_cases where organization_id = target_org and provider_event_id = e.id;
  select o.touch_number into touch from public.messages o
    where o.organization_id = target_org and o.id = (e.payload_json->>'related_outbound_message_id')::uuid;
  intent := sc.decision->>'intent';
  subtype := sc.decision->>'subtype';
  positive := subtype in ('POSITIVE_ACCEPT','POSITIVE_VISIT') or e.reply_classification = 'POSITIVE';
  reason := case
    when positive then null
    when sc.state = 'SUPPRESSED' or intent = 'UNSUBSCRIBE' then 'Pidió baja'
    when intent = 'REJECTION' then 'No le interesa'
    when intent = 'NOT_NOW' then 'Ahora no'
    when intent = 'WRONG_PERSON' then 'Persona equivocada o ya no está'
    when intent = 'COMPLAINT' then 'Queja'
    when intent = 'OUT_OF_OFFICE' then 'Fuera de la oficina'
    when e.reply_classification = 'NEGATIVE' then 'Respuesta negativa'
  end;
  received := coalesce(e.observed_at, m.created_at);
  select * into rec from public.crm_records where organization_id = target_org and contact_id = ct.id for update;
  if rec.id is null then
    select default_owner_user_id into owner from app.crm_settings where organization_id = target_org;
    insert into public.crm_records (organization_id, contact_id, account_id, source, full_name, email, phone, role_title,
      company_name, city, state, stage, owner_user_id, close_reason, reply_intent, last_reply_event_id, first_reply_at, last_reply_at)
    values (target_org, ct.id, a.id, 'CORREO', coalesce(nullif(btrim(ct.full_name), ''), ct.normalized_email), ct.normalized_email,
      ct.phone_e164, ct.role_title, a.legal_name, a.city, a.state, case when reason is null then 'RESPONDIO' else 'DESCARTADO' end,
      owner, reason, coalesce(subtype, intent), e.id, received, received)
    on conflict do nothing
    returning * into rec;
    if rec.id is null then return null; end if;
    perform app.crm_log(target_org, rec.id, 'SISTEMA',
      'Entró al CRM: respondió al correo' || coalesce(' (toque ' || touch || ')', '') ||
      case when reason is null then '.' else '. Descartado: ' || reason || '.' end,
      jsonb_build_object('provider_event_id', e.id, 'intent', coalesce(subtype, intent)), null);
    return rec.id;
  end if;
  update public.crm_records set
    last_reply_at = greatest(coalesce(last_reply_at, received), received),
    first_reply_at = least(coalesce(first_reply_at, received), received),
    last_reply_event_id = case when received >= coalesce(last_reply_at, '-infinity'::timestamptz) then e.id else last_reply_event_id end,
    reply_intent = case when received >= coalesce(last_reply_at, '-infinity'::timestamptz) then coalesce(subtype, intent, reply_intent) else reply_intent end,
    updated_at = clock_timestamp()
  where id = rec.id;
  if rec.stage = 'DESCARTADO' and positive then
    update public.crm_records set stage = 'RESPONDIO', close_reason = null, revision = revision + 1, updated_at = clock_timestamp() where id = rec.id;
    perform app.crm_log(target_org, rec.id, 'CAMBIO_ETAPA', 'Volvió a responder con interés.',
      jsonb_build_object('de', 'DESCARTADO', 'a', 'RESPONDIO'), null);
  elsif rec.stage = 'RESPONDIO' and reason is not null and rec.last_reply_event_id = e.id
    and not exists (select 1 from public.crm_activities x where x.record_id = rec.id and x.actor_user_id is not null) then
    -- El SDR terminó de clasificar como negativa la misma respuesta y nadie la ha tocado.
    update public.crm_records set stage = 'DESCARTADO', close_reason = reason, revision = revision + 1, updated_at = clock_timestamp() where id = rec.id;
    perform app.crm_log(target_org, rec.id, 'CAMBIO_ETAPA', 'Descartado: ' || reason || '.',
      jsonb_build_object('de', 'RESPONDIO', 'a', 'DESCARTADO'), null);
  end if;
  return rec.id;
end $$;

create or replace function app.crm_record_json(r public.crm_records) returns jsonb language sql stable security definer
set search_path to 'public', 'app', 'pg_temp' as $$
  select to_jsonb(r) - 'organization_id' || jsonb_build_object(
    'owner_email', (select u.email from auth.users u where u.id = r.owner_user_id),
    'open_tasks', (select count(*) from public.crm_tasks t where t.record_id = r.id and t.status = 'PENDIENTE'),
    'next_task_at', (select min(t.due_at) from public.crm_tasks t where t.record_id = r.id and t.status = 'PENDIENTE'),
    'last_reply_body', (select left(m.body_text, 2000) from public.provider_events pe
      join public.messages m on m.organization_id = pe.organization_id and m.id = pe.message_id where pe.id = r.last_reply_event_id),
    'mailbox_email', (select mb.normalized_email from public.provider_events pe
      join public.messages m on m.organization_id = pe.organization_id and m.id = pe.message_id
      join public.mailboxes mb on mb.id = m.mailbox_id where pe.id = r.last_reply_event_id));
$$;
revoke all on function app.crm_record_json(public.crm_records) from public, anon, authenticated;

create or replace function public.read_crm(target_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'app', 'pg_temp' as $$
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'CRM_ACCESS_DENIED'; end if;
  return jsonb_build_object(
    'records', coalesce((select jsonb_agg(app.crm_record_json(r) order by coalesce(r.last_reply_at, r.created_at) desc)
      from public.crm_records r where r.organization_id = target_organization_id), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(jsonb_build_object('id', ou.user_id, 'email', u.email, 'role', ou.role) order by u.email)
      from public.organization_users ou join auth.users u on u.id = ou.user_id
      where ou.organization_id = target_organization_id and ou.active), '[]'::jsonb),
    'default_owner_user_id', (select s.default_owner_user_id from app.crm_settings s where s.organization_id = target_organization_id),
    'generated_at', clock_timestamp());
end $$;
revoke all on function public.read_crm(uuid) from public, anon;
grant execute on function public.read_crm(uuid) to authenticated;

create or replace function public.read_crm_record(target_organization_id uuid, target_record_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'app', 'pg_temp' as $$
declare r public.crm_records%rowtype;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'CRM_ACCESS_DENIED'; end if;
  select * into r from public.crm_records where organization_id = target_organization_id and id = target_record_id;
  if not found then raise exception 'CRM_RECORD_NOT_FOUND'; end if;
  return jsonb_build_object(
    'record', app.crm_record_json(r),
    'activities', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'body', x.body, 'data', x.data,
        'actor_email', u.email, 'created_at', x.created_at) order by x.created_at desc)
      from public.crm_activities x left join auth.users u on u.id = x.actor_user_id where x.record_id = r.id), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'due_at', t.due_at, 'status', t.status,
        'owner_user_id', t.owner_user_id, 'owner_email', u.email, 'completed_at', t.completed_at, 'created_at', t.created_at)
        order by (t.status = 'PENDIENTE') desc, t.due_at nulls last, t.created_at)
      from public.crm_tasks t left join auth.users u on u.id = t.owner_user_id where t.record_id = r.id), '[]'::jsonb),
    'emails', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'direction', m.direction, 'subject', m.subject,
        'body', left(m.body_text, 6000), 'at', coalesce(m.sent_at, m.created_at), 'status', m.status,
        'touch_number', m.touch_number, 'mailbox_email', mb.normalized_email, 'cc_emails', to_jsonb(m.cc_emails))
        order by coalesce(m.sent_at, m.created_at) desc)
      from (select * from public.messages m0 where r.contact_id is not null and m0.organization_id = target_organization_id
              and m0.contact_id = r.contact_id and m0.status not in ('DRY_RUN', 'DRAFT', 'FAILED', 'QUEUED')
            order by coalesce(m0.sent_at, m0.created_at) desc limit 60) m
      left join public.mailboxes mb on mb.id = m.mailbox_id), '[]'::jsonb));
end $$;
revoke all on function public.read_crm_record(uuid, uuid) from public, anon;
grant execute on function public.read_crm_record(uuid, uuid) to authenticated;

-- Todas las escrituras del CRM pasan por aquí (op + payload), con idempotencia y bitácora.
create or replace function app.crm_command(target_organization_id uuid, target_op text, target_payload jsonb, target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path to 'public', 'app', 'pg_temp' as $$
declare p jsonb := coalesce(target_payload, '{{}}'::jsonb); op text := upper(coalesce(target_op, '')); command text;
  replay jsonb; rec public.crm_records%rowtype; result jsonb; actor uuid := auth.uid(); new_stage text; old_stage text;
  changed text[] := '{{}}'; task public.crm_tasks%rowtype; owner uuid; existing uuid; msg text;
begin
  perform app.operations_assert_operator(target_organization_id);
  if op not in ('CREAR','ACTUALIZAR','MOVER','CALIFICAR','NOTA','TAREA_CREAR','TAREA_ESTADO') then raise exception 'CRM_OP_INVALID'; end if;
  command := 'crm.' || lower(op);
  replay := app.operations_command_begin(target_organization_id, command, target_idempotency_key, jsonb_build_object('op', op, 'payload', p));
  if replay is not null then return replay; end if;

  if p ? 'owner_user_id' and nullif(p->>'owner_user_id', '') is not null and not exists (select 1 from public.organization_users ou
      where ou.organization_id = target_organization_id and ou.user_id = (p->>'owner_user_id')::uuid and ou.active) then
    raise exception 'CRM_RESPONSABLE_INVALIDO';
  end if;

  if op = 'CREAR' then
    if nullif(btrim(p->>'full_name'), '') is null then raise exception 'CRM_NOMBRE_REQUERIDO'; end if;
    if nullif(btrim(p->>'email'), '') is not null then
      select id into existing from public.crm_records where organization_id = target_organization_id and lower(email) = lower(btrim(p->>'email'));
      if existing is not null then
        return app.operations_command_finish(target_organization_id, command, target_idempotency_key,
          jsonb_build_object('ok', true, 'record_id', existing, 'message', 'Ese correo ya estaba en el CRM. No se duplicó.'));
      end if;
    end if;
    select default_owner_user_id into owner from app.crm_settings where organization_id = target_organization_id;
    insert into public.crm_records (organization_id, source, full_name, email, phone, role_title, company_name, city, state,
      stage, owner_user_id, service_interest, value_mxn, next_action, next_action_at, referred_from_record_id, created_by, last_touch_at)
    values (target_organization_id, case when p->>'source' = 'REFERIDO' then 'REFERIDO' else 'MANUAL' end,
      btrim(p->>'full_name'), nullif(lower(btrim(p->>'email')), ''), nullif(btrim(p->>'phone'), ''), nullif(btrim(p->>'role_title'), ''),
      nullif(btrim(p->>'company_name'), ''), nullif(btrim(p->>'city'), ''), nullif(btrim(p->>'state'), ''), 'RESPONDIO',
      coalesce(nullif(p->>'owner_user_id', '')::uuid, owner), nullif(p->>'service_interest', ''), nullif(p->>'value_mxn', '')::numeric,
      nullif(btrim(p->>'next_action'), ''), nullif(p->>'next_action_at', '')::timestamptz,
      nullif(p->>'referred_from_record_id', '')::uuid, actor, clock_timestamp())
    returning * into rec;
    perform app.crm_log(target_organization_id, rec.id, 'SISTEMA',
      case when rec.source = 'REFERIDO' then 'Agregado a mano como referido.' else 'Agregado a mano.' end, '{{}}'::jsonb, actor);
    if nullif(btrim(p->>'note'), '') is not null then
      perform app.crm_log(target_organization_id, rec.id, 'NOTA', btrim(p->>'note'), '{{}}'::jsonb, actor);
    end if;
    result := jsonb_build_object('ok', true, 'record_id', rec.id, 'message', 'Contacto agregado al CRM.');

  elsif op in ('ACTUALIZAR', 'MOVER', 'CALIFICAR', 'NOTA', 'TAREA_CREAR') then
    select * into rec from public.crm_records where organization_id = target_organization_id and id = (p->>'record_id')::uuid for update;
    if not found then raise exception 'CRM_RECORD_NOT_FOUND'; end if;
    if p ? 'expected_revision' and (p->>'expected_revision')::integer <> rec.revision then raise exception 'CRM_REGISTRO_DESACTUALIZADO'; end if;

    if op in ('ACTUALIZAR', 'MOVER') then
      -- Campos editables; solo se tocan los que vienen en el payload.
      if p ? 'full_name' then
        if nullif(btrim(p->>'full_name'), '') is null then raise exception 'CRM_NOMBRE_REQUERIDO'; end if;
        rec.full_name := btrim(p->>'full_name'); changed := array_append(changed, 'nombre'); end if;
      if p ? 'email' then rec.email := nullif(lower(btrim(p->>'email')), ''); changed := array_append(changed, 'correo'); end if;
      if p ? 'phone' then rec.phone := nullif(btrim(p->>'phone'), ''); changed := array_append(changed, 'teléfono'); end if;
      if p ? 'role_title' then rec.role_title := nullif(btrim(p->>'role_title'), ''); changed := array_append(changed, 'puesto'); end if;
      if p ? 'company_name' then rec.company_name := nullif(btrim(p->>'company_name'), ''); changed := array_append(changed, 'empresa'); end if;
      if p ? 'city' then rec.city := nullif(btrim(p->>'city'), ''); changed := array_append(changed, 'ciudad'); end if;
      if p ? 'state' then rec.state := nullif(btrim(p->>'state'), ''); changed := array_append(changed, 'estado'); end if;
      if p ? 'service_interest' then rec.service_interest := nullif(p->>'service_interest', ''); changed := array_append(changed, 'servicio'); end if;
      if p ? 'value_mxn' then rec.value_mxn := nullif(p->>'value_mxn', '')::numeric; changed := array_append(changed, 'valor'); end if;
      if p ? 'owner_user_id' then rec.owner_user_id := nullif(p->>'owner_user_id', '')::uuid; changed := array_append(changed, 'responsable'); end if;
      if p ? 'next_action' then rec.next_action := nullif(btrim(p->>'next_action'), ''); rec.reminded_at := null; changed := array_append(changed, 'siguiente acción'); end if;
      if p ? 'next_action_at' then rec.next_action_at := nullif(p->>'next_action_at', '')::timestamptz; rec.reminded_at := null; changed := array_append(changed, 'fecha de la siguiente acción'); end if;
      if p ? 'close_reason' then rec.close_reason := nullif(btrim(p->>'close_reason'), ''); changed := array_append(changed, 'motivo'); end if;
      if p ? 'qualification' then rec.qualification := rec.qualification || (p->'qualification'); changed := array_append(changed, 'calificación'); end if;
    end if;

    if op = 'MOVER' then
      new_stage := upper(coalesce(p->>'stage', ''));
      if new_stage not in ({STAGES}) then raise exception 'CRM_ETAPA_INVALIDA'; end if;
      old_stage := rec.stage;
      -- Proceso de Paco: calificado o más allá exige las 4 condiciones y siguiente acción con fecha y responsable.
      if new_stage in ('CALIFICADO','LLAMADA_VISITA','LEVANTAMIENTO','PROPUESTA','NEGOCIACION','GANADO') then
        if not app.crm_qualified(rec.qualification) then raise exception 'CRM_CALIFICACION_INCOMPLETA'; end if;
        if new_stage <> 'GANADO' and (nullif(btrim(rec.next_action), '') is null or rec.next_action_at is null or rec.owner_user_id is null) then
          raise exception 'CRM_SIGUIENTE_ACCION_REQUERIDA';
        end if;
      end if;
      if new_stage = 'GANADO' and coalesce(rec.value_mxn, 0) <= 0 then raise exception 'CRM_VALOR_REQUERIDO'; end if;
      if new_stage in ('PERDIDO', 'DESCARTADO') and nullif(btrim(rec.close_reason), '') is null then raise exception 'CRM_MOTIVO_REQUERIDO'; end if;
      if new_stage not in ('PERDIDO', 'DESCARTADO') then rec.close_reason := null; end if;
      rec.stage := new_stage;
    elsif op = 'CALIFICAR' then
      rec.qualification := rec.qualification || jsonb_strip_nulls(jsonb_build_object(
        'mercado', (p->'qualification'->>'mercado')::boolean, 'contacto', (p->'qualification'->>'contacto')::boolean,
        'necesidad', (p->'qualification'->>'necesidad')::boolean, 'avance', (p->'qualification'->>'avance')::boolean));
    end if;

    if op in ('ACTUALIZAR', 'MOVER', 'CALIFICAR') then
      update public.crm_records set full_name = rec.full_name, email = rec.email, phone = rec.phone, role_title = rec.role_title,
        company_name = rec.company_name, city = rec.city, state = rec.state, stage = rec.stage, owner_user_id = rec.owner_user_id,
        service_interest = rec.service_interest, value_mxn = rec.value_mxn, next_action = rec.next_action,
        next_action_at = rec.next_action_at, close_reason = rec.close_reason, qualification = rec.qualification,
        reminded_at = rec.reminded_at, last_touch_at = clock_timestamp(), revision = revision + 1, updated_at = clock_timestamp()
      where id = rec.id returning * into rec;
    end if;

    if op = 'MOVER' and old_stage is distinct from new_stage then
      perform app.crm_log(target_organization_id, rec.id, 'CAMBIO_ETAPA', nullif(btrim(p->>'note'), ''),
        jsonb_build_object('de', old_stage, 'a', new_stage, 'motivo', rec.close_reason, 'campos', to_jsonb(changed)), actor);
      msg := 'Etapa actualizada.';
    elsif op = 'CALIFICAR' then
      perform app.crm_log(target_organization_id, rec.id, 'EDICION',
        case when app.crm_qualified(rec.qualification) then 'Cumple las 4 condiciones de calificación.' else 'Actualizó la calificación.' end,
        jsonb_build_object('calificacion', rec.qualification), actor);
      msg := 'Calificación guardada.';
    elsif op in ('ACTUALIZAR', 'MOVER') and cardinality(changed) > 0 then
      perform app.crm_log(target_organization_id, rec.id, 'EDICION', 'Editó ' || array_to_string(changed, ', ') || '.',
        jsonb_build_object('campos', to_jsonb(changed)), actor);
      msg := 'Cambios guardados.';
    elsif op = 'NOTA' then
      if nullif(btrim(p->>'body'), '') is null then raise exception 'CRM_NOTA_VACIA'; end if;
      perform app.crm_log(target_organization_id, rec.id,
        case when p->>'kind' in ('LLAMADA', 'WHATSAPP', 'REUNION') then p->>'kind' else 'NOTA' end, btrim(p->>'body'), '{{}}'::jsonb, actor);
      update public.crm_records set last_touch_at = clock_timestamp(), updated_at = clock_timestamp() where id = rec.id returning * into rec;
      msg := 'Nota guardada.';
    elsif op = 'TAREA_CREAR' then
      if nullif(btrim(p->>'title'), '') is null then raise exception 'CRM_TAREA_VACIA'; end if;
      insert into public.crm_tasks (organization_id, record_id, title, due_at, owner_user_id, created_by)
      values (target_organization_id, rec.id, btrim(p->>'title'), nullif(p->>'due_at', '')::timestamptz,
        coalesce(nullif(p->>'owner_user_id', '')::uuid, rec.owner_user_id), actor)
      returning * into task;
      perform app.crm_log(target_organization_id, rec.id, 'TAREA', 'Tarea: ' || task.title,
        jsonb_build_object('task_id', task.id, 'due_at', task.due_at), actor);
      msg := 'Tarea creada.';
    else
      msg := 'Sin cambios.';
    end if;
    result := jsonb_build_object('ok', true, 'record_id', rec.id, 'revision', rec.revision, 'stage', rec.stage, 'message', msg);

  elsif op = 'TAREA_ESTADO' then
    select * into task from public.crm_tasks where organization_id = target_organization_id and id = (p->>'task_id')::uuid for update;
    if not found then raise exception 'CRM_TAREA_NO_ENCONTRADA'; end if;
    if p->>'status' not in ('PENDIENTE', 'HECHA', 'CANCELADA') then raise exception 'CRM_TAREA_ESTADO_INVALIDO'; end if;
    update public.crm_tasks set status = p->>'status',
      completed_at = case when p->>'status' = 'HECHA' then clock_timestamp() end,
      completed_by = case when p->>'status' = 'HECHA' then actor end, updated_at = clock_timestamp()
    where id = task.id returning * into task;
    perform app.crm_log(target_organization_id, task.record_id, 'TAREA',
      case task.status when 'HECHA' then 'Completó: ' when 'CANCELADA' then 'Canceló: ' else 'Reabrió: ' end || task.title,
      jsonb_build_object('task_id', task.id, 'status', task.status), actor);
    update public.crm_records set last_touch_at = clock_timestamp(), updated_at = clock_timestamp() where id = task.record_id;
    result := jsonb_build_object('ok', true, 'record_id', task.record_id, 'task_id', task.id, 'message', 'Tarea actualizada.');
  end if;

  return app.operations_command_finish(target_organization_id, command, target_idempotency_key, result);
end $$;
revoke all on function app.crm_command(uuid, text, jsonb, text) from public, anon, authenticated;

create or replace function public.crm_command(target_organization_id uuid, target_op text, target_payload jsonb, target_idempotency_key text)
returns jsonb language sql security definer set search_path to 'public', 'app', 'pg_temp' as $$
  select app.crm_command(target_organization_id, target_op, target_payload, target_idempotency_key);
$$;
revoke all on function public.crm_command(uuid, text, jsonb, text) from public, anon;
grant execute on function public.crm_command(uuid, text, jsonb, text) to authenticated;

-- Recordatorios por Telegram: tareas y siguientes acciones vencidas, una vez cada una, en horario hábil.
create or replace function app.crm_reminders_work(target_org uuid)
returns jsonb language plpgsql security definer set search_path to 'public', 'app', 'pg_temp' as $$
declare items jsonb := '[]'::jsonb; local_now timestamp := clock_timestamp() at time zone 'America/Mexico_City'; row_value record;
begin
  perform pg_advisory_xact_lock(hashtextextended('crm-reminders:' || target_org::text, 0));
  if not coalesce((select reminders_enabled from app.crm_settings where organization_id = target_org), false)
    or extract(isodow from local_now) > 5 or local_now::time < time '08:00' or local_now::time >= time '19:00' then
    return jsonb_build_object('status', 'CRM_REMINDERS', 'items', items, 'chat_ids', '[]'::jsonb);
  end if;
  for row_value in
    select 'TAREA' kind, t.id, t.title what, t.due_at due, r.id record_id from public.crm_tasks t
      join public.crm_records r on r.id = t.record_id
      where t.organization_id = target_org and t.status = 'PENDIENTE' and t.due_at <= clock_timestamp() and t.reminded_at is null
    union all
    select 'SIGUIENTE', r.id, r.next_action, r.next_action_at, r.id from public.crm_records r
      where r.organization_id = target_org and r.stage not in ('GANADO', 'PERDIDO', 'DESCARTADO')
        and r.next_action_at <= clock_timestamp() and r.reminded_at is null and nullif(btrim(r.next_action), '') is not null
    order by 4 limit 20
  loop
    if row_value.kind = 'TAREA' then update public.crm_tasks set reminded_at = clock_timestamp() where id = row_value.id;
    else update public.crm_records set reminded_at = clock_timestamp() where id = row_value.id; end if;
    items := items || jsonb_build_array(jsonb_build_object('kind', row_value.kind, 'id', row_value.id, 'what', row_value.what,
      'due_at', row_value.due, 'record', (select app.crm_record_json(r) - 'last_reply_body' from public.crm_records r where r.id = row_value.record_id)));
  end loop;
  return jsonb_build_object('status', 'CRM_REMINDERS', 'items', items,
    'chat_ids', (select to_jsonb(s.telegram_chat_ids) from app.email_sdr_settings s where s.organization_id = target_org));
end $$;
revoke all on function app.crm_reminders_work(uuid) from public, anon, authenticated;

create or replace function app.crm_reminders_settle(target_org uuid, target_kind text, target_id uuid, delivered boolean)
returns jsonb language plpgsql security definer set search_path to 'public', 'app', 'pg_temp' as $$
begin
  if not coalesce(delivered, false) then
    if target_kind = 'TAREA' then update public.crm_tasks set reminded_at = null where organization_id = target_org and id = target_id;
    else update public.crm_records set reminded_at = null where organization_id = target_org and id = target_id; end if;
  end if;
  return jsonb_build_object('status', 'SETTLED');
end $$;
revoke all on function app.crm_reminders_settle(uuid, text, uuid, boolean) from public, anon, authenticated;

{sdr_command}
-- Rezago: todas las respuestas humanas que ya llegaron, en orden.
do $$
declare e record;
begin
  for e in select pe.id from public.provider_events pe where pe.organization_id = '{ORG}' and pe.event_kind = 'REPLY'
    order by pe.observed_at loop
    perform app.crm_upsert_from_reply('{ORG}', e.id);
  end loop;
end $$;

insert into public.audit_log (organization_id, action, record_type, new_data)
values ('{ORG}', 'CRM_CREATED', 'crm_records', jsonb_build_object('source', 'migración 109',
  'records', (select count(*) from public.crm_records where organization_id = '{ORG}'), 'order', 'Grant 13-oct'));

commit;
"""
OUT.write_text(sql)
print(OUT, len(sql))
