-- 111 · Directorio de empresas en el CRM (16-oct-2026). Generado por tools/correos/gen-111.py desde
-- tools/correos/vivas-111/. Ver el docstring del generador.

begin;

set local app.operations_rpc_write = 'on';

alter table public.crm_records drop constraint if exists crm_records_source_check;
alter table public.crm_records add constraint crm_records_source_check check (source in ('CORREO','MANUAL','REFERIDO','DIRECTORIO'));
alter table public.crm_records drop constraint if exists crm_records_stage_check;
alter table public.crm_records add constraint crm_records_stage_check check (stage in ('POR_CONTACTAR','RESPONDIO','CALIFICADO','LLAMADA_VISITA','LEVANTAMIENTO','PROPUESTA','NEGOCIACION','GANADO','PERDIDO','DESCARTADO'));
alter table public.crm_records alter column full_name drop not null;
alter table public.crm_records drop constraint if exists crm_records_full_name_check;
alter table public.crm_records add constraint crm_records_full_name_check
  check ((full_name is null or length(btrim(full_name)) between 1 and 200) and (full_name is not null or company_name is not null));
alter table public.crm_records add column if not exists industrial_park text check (industrial_park is null or length(industrial_park) <= 200);
alter table public.crm_records add column if not exists address text check (address is null or length(address) <= 400);
alter table public.crm_records add column if not exists sector text check (sector is null or length(sector) <= 300);
alter table public.crm_records add column if not exists source_url text check (source_url is null or (length(source_url) <= 600 and source_url ~* '^https?://'));
alter table public.crm_records add column if not exists import_batch text check (import_batch is null or length(import_batch) <= 200);

-- Llave para comparar nombres de empresa: sin acentos, sin razón social ni signos.
create or replace function app.crm_company_key(name text) returns text language sql immutable as $$
  select nullif(btrim(regexp_replace(regexp_replace(regexp_replace(
    lower(translate(coalesce(name, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
    '[^a-z0-9]+', ' ', 'g'),
    '\m(s a p i|sapi|s a|sa|s de r l|de r l|s r l|rl|c v|cv|de cv|de c v|inc|llc|gmbh|ltd|corp|corporation|company|co|group|grupo|mexico|mexicana|mexicano|de|del|la|el|y)\M', ' ', 'g'),
    '\s+', ' ', 'g')), '');
$$;
create unique index if not exists crm_records_directory_company_unique
  on public.crm_records (organization_id, app.crm_company_key(company_name)) where source = 'DIRECTORIO';

-- Cuenta de la campaña de correo que corresponde a una empresa del directorio (si hay una sola clara).
create or replace function app.crm_match_account(target_org uuid, company text) returns uuid language sql stable
set search_path to 'public', 'app', 'pg_temp' as $$
  with k as (select app.crm_company_key(company) key)
  select a.id from public.accounts a, k
  where a.organization_id = target_org and not a.is_deleted and k.key is not null and length(k.key) >= 4
    and (app.crm_company_key(a.legal_name) = k.key
      or (length(app.crm_company_key(a.legal_name)) >= 5 and (app.crm_company_key(a.legal_name) like k.key || ' %' or k.key like app.crm_company_key(a.legal_name) || ' %')))
  order by exists (select 1 from public.campaign_enrollments ce where ce.account_id = a.id) desc, a.created_at
  limit 1;
$$;

create or replace function app.crm_import_rows(target_org uuid, target_rows jsonb, target_file text, target_actor uuid)
returns jsonb language plpgsql security definer set search_path to 'public', 'app', 'pg_temp' as $$
declare r jsonb; company text; key text; owner uuid; rec public.crm_records%rowtype; account uuid;
  inserted integer := 0; duplicates integer := 0; skipped integer := 0; in_campaign integer := 0;
begin
  if jsonb_typeof(target_rows) <> 'array' or jsonb_array_length(target_rows) > 200 then raise exception 'CRM_IMPORT_ROWS_INVALID'; end if;
  select default_owner_user_id into owner from app.crm_settings where organization_id = target_org;
  for r in select * from jsonb_array_elements(target_rows) loop
    company := left(btrim(regexp_replace(coalesce(r->>'company_name', ''), '\s+', ' ', 'g')), 200);
    key := app.crm_company_key(company);
    if key is null then skipped := skipped + 1; continue; end if;
    if exists (select 1 from public.crm_records x where x.organization_id = target_org and x.source = 'DIRECTORIO'
        and app.crm_company_key(x.company_name) = key) then duplicates := duplicates + 1; continue; end if;
    account := app.crm_match_account(target_org, company);
    insert into public.crm_records (organization_id, account_id, source, full_name, email, phone, role_title, company_name, city, state,
      industrial_park, address, sector, source_url, import_batch, stage, owner_user_id, created_by)
    values (target_org, account, 'DIRECTORIO',
      nullif(left(btrim(r->>'full_name'), 200), ''),
      case when lower(btrim(r->>'email')) ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then lower(btrim(r->>'email')) end,
      case when length(btrim(r->>'phone')) between 7 and 40 then btrim(r->>'phone') end,
      nullif(left(btrim(r->>'role_title'), 200), ''), company,
      nullif(left(btrim(regexp_replace(r->>'city', '\s+', ' ', 'g')), 120), ''),
      nullif(left(btrim(regexp_replace(r->>'state', '\s+', ' ', 'g')), 120), ''),
      nullif(left(btrim(regexp_replace(r->>'industrial_park', '\s+', ' ', 'g')), 200), ''),
      nullif(left(btrim(regexp_replace(r->>'address', '\s+', ' ', 'g')), 400), ''),
      nullif(left(btrim(regexp_replace(r->>'sector', '\s+', ' ', 'g')), 300), ''),
      case when btrim(r->>'source_url') ~* '^https?://' then left(btrim(r->>'source_url'), 600) end,
      nullif(left(btrim(target_file), 200), ''), 'POR_CONTACTAR', owner, target_actor)
    on conflict do nothing
    returning * into rec;
    if rec.id is null then duplicates := duplicates + 1; continue; end if;
    inserted := inserted + 1;
    if account is not null and exists (select 1 from public.campaign_enrollments ce where ce.account_id = account) then in_campaign := in_campaign + 1; end if;
    perform app.crm_log(target_org, rec.id, 'SISTEMA', 'Importado del directorio' || coalesce(' "' || nullif(btrim(target_file), '') || '"', '') || '.',
      jsonb_build_object('import_batch', target_file), target_actor);
    rec := null;
  end loop;
  return jsonb_build_object('ok', true, 'inserted', inserted, 'duplicates', duplicates, 'skipped', skipped, 'in_campaign', in_campaign,
    'message', inserted || ' empresas agregadas al CRM' || case when duplicates > 0 then ', ' || duplicates || ' ya estaban' else '' end || '.');
end $$;
revoke all on function app.crm_import_rows(uuid, jsonb, text, uuid) from public, anon, authenticated;

-- Vista previa de una importación: qué entra, qué ya estaba y qué empresa ya está en la campaña de correo.
create or replace function public.crm_import_preview(target_organization_id uuid, target_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'app', 'pg_temp' as $$
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'CRM_ACCESS_DENIED'; end if;
  if jsonb_typeof(target_rows) <> 'array' or jsonb_array_length(target_rows) > 1000 then raise exception 'CRM_IMPORT_ROWS_INVALID'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('index', x.i - 1, 'company_name', x.r->>'company_name',
      'status', case when app.crm_company_key(x.r->>'company_name') is null then 'SIN_NOMBRE'
        when exists (select 1 from public.crm_records c where c.organization_id = target_organization_id and c.source = 'DIRECTORIO'
          and app.crm_company_key(c.company_name) = app.crm_company_key(x.r->>'company_name')) then 'YA_EN_CRM'
        when (select count(*) from jsonb_array_elements(target_rows) with ordinality y(r2, j)
          where y.j < x.i and app.crm_company_key(y.r2->>'company_name') = app.crm_company_key(x.r->>'company_name')) > 0 then 'REPETIDA_EN_ARCHIVO'
        else 'NUEVA' end,
      'account_name', (select a.legal_name from public.accounts a where a.id = app.crm_match_account(target_organization_id, x.r->>'company_name')),
      'in_email_campaign', exists (select 1 from public.campaign_enrollments ce
        where ce.account_id = app.crm_match_account(target_organization_id, x.r->>'company_name')))
      order by x.i)
    from jsonb_array_elements(target_rows) with ordinality x(r, i)), '[]'::jsonb);
end $$;
revoke all on function public.crm_import_preview(uuid, jsonb) from public, anon;
grant execute on function public.crm_import_preview(uuid, jsonb) to authenticated;

CREATE OR REPLACE FUNCTION app.crm_record_json(r crm_records)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
  select to_jsonb(r) - 'organization_id' || jsonb_build_object(
    'in_email_campaign', r.account_id is not null and exists (select 1 from public.campaign_enrollments ce
      join public.campaigns ca on ca.organization_id = ce.organization_id and ca.id = ce.campaign_id
      where ce.organization_id = r.organization_id and ce.account_id = r.account_id and ca.lane = 'DIRECT' and ca.name !~* '^PRUEBA'),
    'owner_email', (select u.email from auth.users u where u.id = r.owner_user_id),
    'open_tasks', (select count(*) from public.crm_tasks t where t.record_id = r.id and t.status = 'PENDIENTE'),
    'next_task_at', (select min(t.due_at) from public.crm_tasks t where t.record_id = r.id and t.status = 'PENDIENTE'),
    'last_reply_body', (select left(m.body_text, 2000) from public.provider_events pe
      join public.messages m on m.organization_id = pe.organization_id and m.id = pe.message_id where pe.id = r.last_reply_event_id),
    'mailbox_email', (select mb.normalized_email from public.provider_events pe
      join public.messages m on m.organization_id = pe.organization_id and m.id = pe.message_id
      join public.mailboxes mb on mb.id = m.mailbox_id where pe.id = r.last_reply_event_id));
$function$;

CREATE OR REPLACE FUNCTION app.crm_command(target_organization_id uuid, target_op text, target_payload jsonb, target_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare p jsonb := coalesce(target_payload, '{}'::jsonb); op text := upper(coalesce(target_op, '')); command text;
  replay jsonb; rec public.crm_records%rowtype; result jsonb; actor uuid := auth.uid(); new_stage text; old_stage text;
  changed text[] := '{}'; task public.crm_tasks%rowtype; owner uuid; existing uuid; msg text;
begin
  perform app.operations_assert_operator(target_organization_id);
  if op not in ('CREAR','ACTUALIZAR','MOVER','CALIFICAR','NOTA','TAREA_CREAR','TAREA_ESTADO','IMPORTAR') then raise exception 'CRM_OP_INVALID'; end if;
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
        if nullif(btrim(p->>'full_name'), '') is null and (rec.source <> 'DIRECTORIO' or rec.company_name is null) then raise exception 'CRM_NOMBRE_REQUERIDO'; end if;
        rec.full_name := nullif(btrim(p->>'full_name'), ''); changed := array_append(changed, 'nombre'); end if;
      if p ? 'industrial_park' then rec.industrial_park := nullif(btrim(p->>'industrial_park'), ''); changed := array_append(changed, 'parque'); end if;
      if p ? 'address' then rec.address := nullif(btrim(p->>'address'), ''); changed := array_append(changed, 'dirección'); end if;
      if p ? 'sector' then rec.sector := nullif(btrim(p->>'sector'), ''); changed := array_append(changed, 'sector'); end if;
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
      if new_stage not in ('POR_CONTACTAR','RESPONDIO','CALIFICADO','LLAMADA_VISITA','LEVANTAMIENTO','PROPUESTA','NEGOCIACION','GANADO','PERDIDO','DESCARTADO') then raise exception 'CRM_ETAPA_INVALIDA'; end if;
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
        industrial_park = rec.industrial_park, address = rec.address, sector = rec.sector,
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

  elsif op = 'IMPORTAR' then
    -- 16-oct: directorio de empresas (vista previa en crm_import_preview).
    result := app.crm_import_rows(target_organization_id, p->'rows', p->>'file_name', actor);

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
end $function$;

commit;
