-- 109 · CRM de respuestas (13-oct-2026). Generado por tools/correos/gen-109.py desde
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
insert into app.crm_settings (organization_id, default_owner_user_id) values ('e0000000-0000-4000-8000-000000000001', '518ca09c-47f4-46a7-aa78-99ac474d6b39')
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
  stage text not null default 'RESPONDIO' check (stage in ('RESPONDIO','CALIFICADO','LLAMADA_VISITA','LEVANTAMIENTO','PROPUESTA','NEGOCIACION','GANADO','PERDIDO','DESCARTADO')),
  owner_user_id uuid,
  service_interest text check (service_interest is null or service_interest in ('TERMOGRAFIA_DRON','MANTENIMIENTO','SUBESTACION','PANELES_SOLARES','NOM_029','CALIDAD_ENERGIA','OTRO')),
  value_mxn numeric(14,2) check (value_mxn is null or value_mxn >= 0),
  next_action text check (next_action is null or length(next_action) <= 500),
  next_action_at timestamptz,
  close_reason text check (close_reason is null or length(close_reason) <= 500),
  qualification jsonb not null default '{}'::jsonb,
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
  data jsonb not null default '{}'::jsonb,
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
  values (target_org, target_record, target_kind, left(target_body, 5000), coalesce(target_data, '{}'::jsonb), target_actor);
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
declare p jsonb := coalesce(target_payload, '{}'::jsonb); op text := upper(coalesce(target_op, '')); command text;
  replay jsonb; rec public.crm_records%rowtype; result jsonb; actor uuid := auth.uid(); new_stage text; old_stage text;
  changed text[] := '{}'; task public.crm_tasks%rowtype; owner uuid; existing uuid; msg text;
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
      case when rec.source = 'REFERIDO' then 'Agregado a mano como referido.' else 'Agregado a mano.' end, '{}'::jsonb, actor);
    if nullif(btrim(p->>'note'), '') is not null then
      perform app.crm_log(target_organization_id, rec.id, 'NOTA', btrim(p->>'note'), '{}'::jsonb, actor);
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
      if new_stage not in ('RESPONDIO','CALIFICADO','LLAMADA_VISITA','LEVANTAMIENTO','PROPUESTA','NEGOCIACION','GANADO','PERDIDO','DESCARTADO') then raise exception 'CRM_ETAPA_INVALIDA'; end if;
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
        case when p->>'kind' in ('LLAMADA', 'WHATSAPP', 'REUNION') then p->>'kind' else 'NOTA' end, btrim(p->>'body'), '{}'::jsonb, actor);
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
  elsif op='CRM_REMINDERS_WORK' then
    return app.crm_reminders_work(target_organization_id);
  elsif op='CRM_REMINDERS_SETTLE' then
    return app.crm_reminders_settle(target_organization_id,p->>'kind',(p->>'id')::uuid,(p->>'delivered')::boolean);
  elsif op='TELEGRAM_WORK' then
    return app.email_sdr_telegram_work(target_organization_id);
  elsif op='TELEGRAM_SETTLE' then
    return app.email_sdr_telegram_settle(target_organization_id,(p->>'case_id')::uuid,p->>'chat_id',
      (p->>'delivered')::boolean,p->>'error');
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
          next_action=case when row_value.subtype in ('POSITIVE_ACCEPT','POSITIVE_VISIT') then 'Respondida automáticamente con copia a Paco y Oscar. Oscar coordina los detalles'
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
    -- 13-oct: toda respuesta humana entra al CRM en cuanto el SDR la clasifica.
    if e.event_kind='REPLY' then perform app.crm_upsert_from_reply(target_organization_id,e.id); end if;
    return jsonb_build_object('status','RECORDED');
  elsif op='SUPPRESSED' then
    if not app.is_suppressed(target_organization_id,contact.account_id,contact.normalized_email,split_part(contact.normalized_email,'@',2)) then raise exception 'SDR_SUPPRESSION_NOT_CONFIRMED'; end if;
    update public.email_sdr_cases set state='SUPPRESSED',next_due_at=null,next_action='Baja aplicada. No enviar',lease_until=null,updated_at=clock_timestamp() where id=c.id;
    if e.event_kind='REPLY' then perform app.crm_upsert_from_reply(target_organization_id,e.id); end if;
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
          state='READY',next_action='Respuesta automática programada con copia a Paco y Oscar',lease_until=null,updated_at=clock_timestamp()
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
      app.email_sdr_reply_cc(campaign.manifest_json->>'cc_on_reply_email',cfg.reply_cc_emails),e.id)
    on conflict(organization_id,idempotency_key) do nothing returning id into message_id_value;
    if message_id_value is null then return jsonb_build_object('status','DUPLICATE'); end if;
    update public.email_sdr_cases set state='QUEUED',message_id=message_id_value,followups_sent=followups_sent+case when followup then 1 else 0 end,
      next_action='Esperar recibo del transporte original',lease_until=null,updated_at=clock_timestamp() where id=c.id;
    return jsonb_build_object('status','QUEUED','message_id',message_id_value);
  end if;
  raise exception 'SDR_COMMAND_INVALID';
end $function$;

-- Rezago: todas las respuestas humanas que ya llegaron, en orden.
do $$
declare e record;
begin
  for e in select pe.id from public.provider_events pe where pe.organization_id = 'e0000000-0000-4000-8000-000000000001' and pe.event_kind = 'REPLY'
    order by pe.observed_at loop
    perform app.crm_upsert_from_reply('e0000000-0000-4000-8000-000000000001', e.id);
  end loop;
end $$;

insert into public.audit_log (organization_id, action, record_type, new_data)
values ('e0000000-0000-4000-8000-000000000001', 'CRM_CREATED', 'crm_records', jsonb_build_object('source', 'migración 109',
  'records', (select count(*) from public.crm_records where organization_id = 'e0000000-0000-4000-8000-000000000001'), 'order', 'Grant 13-oct'));

commit;
