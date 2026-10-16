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
end $function$

