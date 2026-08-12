begin;

drop trigger if exists opportunities_m018_rollback_fail_closed on public.opportunities;
drop function if exists app.block_closed_won_without_m018();

create table public.operational_capacity_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null check (version > 0),
  monthly_limit integer not null check (monthly_limit between 1 and 100),
  warning_at integer not null check (warning_at between 1 and monthly_limit),
  effective_from_month date not null check (
    effective_from_month = date_trunc('month', effective_from_month)::date
  ),
  source_reference text not null check (
    nullif(btrim(source_reference), '') is not null
    and octet_length(source_reference) <= 1000
  ),
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, version),
  unique (organization_id, idempotency_key),
  unique (organization_id, id)
);

create index operational_capacity_configs_effective_idx
on public.operational_capacity_configs (
  organization_id, effective_from_month desc, version desc
);

create table public.opportunity_capacity_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  opportunity_id uuid not null,
  execution_date date not null,
  capacity_month date not null check (
    capacity_month = date_trunc('month', execution_date)::date
  ),
  config_id uuid not null,
  config_version integer not null check (config_version > 0),
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  change_reason text not null check (
    nullif(btrim(change_reason), '') is not null
    and octet_length(change_reason) <= 2000
  ),
  scheduled_by uuid not null,
  scheduled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, opportunity_id),
  unique (organization_id, idempotency_key),
  unique (organization_id, id),
  constraint opportunity_capacity_schedules_opportunity_tenant_fkey
    foreign key (organization_id, opportunity_id)
    references public.opportunities (organization_id, id),
  constraint opportunity_capacity_schedules_config_tenant_fkey
    foreign key (organization_id, config_id)
    references public.operational_capacity_configs (organization_id, id)
);

create index opportunity_capacity_schedules_month_idx
on public.opportunity_capacity_schedules (organization_id, capacity_month, opportunity_id);

-- The command ledger preserves every idempotency key even after a reschedule.
-- This prevents an old retry from silently moving a project back to a prior month.
create table public.operational_capacity_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  schedule_id uuid not null,
  opportunity_id uuid not null,
  execution_date date not null,
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  change_reason text not null,
  result_status text not null check (result_status in ('SCHEDULED', 'RESCHEDULED', 'UNCHANGED')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  constraint operational_capacity_commands_schedule_tenant_fkey
    foreign key (organization_id, schedule_id)
    references public.opportunity_capacity_schedules (organization_id, id),
  constraint operational_capacity_commands_opportunity_tenant_fkey
    foreign key (organization_id, opportunity_id)
    references public.opportunities (organization_id, id)
);

create or replace function app.enforce_capacity_config_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'OPERATIONAL_CAPACITY_CONFIG_APPEND_ONLY';
  end if;
  if current_setting('app.capacity_config_rpc', true) is distinct from 'true' then
    raise exception 'OPERATIONAL_CAPACITY_CONFIG_RPC_REQUIRED';
  end if;
  return new;
end;
$$;

create trigger operational_capacity_configs_append_only
before insert or update or delete on public.operational_capacity_configs
for each row execute function app.enforce_capacity_config_append_only();

create or replace function app.enforce_capacity_schedule_write_path()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  linked_stage public.commercial_stage;
  linked_config_version integer;
  linked_effective_month date;
begin
  if tg_op = 'DELETE' then
    raise exception 'OPERATIONAL_CAPACITY_SCHEDULE_DELETE_FORBIDDEN';
  end if;
  if current_setting('app.capacity_schedule_rpc', true) is distinct from 'true' then
    raise exception 'OPERATIONAL_CAPACITY_SCHEDULE_RPC_REQUIRED';
  end if;
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.opportunity_id is distinct from old.opportunity_id
    or new.created_at is distinct from old.created_at
  ) then raise exception 'OPERATIONAL_CAPACITY_SCHEDULE_IDENTITY_IMMUTABLE'; end if;

  select o.stage into linked_stage
  from public.opportunities o
  where o.organization_id = new.organization_id and o.id = new.opportunity_id;
  if not found or linked_stage <> 'CLOSED_WON' then
    raise exception 'CAPACITY_REQUIRES_CLOSED_WON_OPPORTUNITY';
  end if;

  select c.version, c.effective_from_month
  into linked_config_version, linked_effective_month
  from public.operational_capacity_configs c
  where c.organization_id = new.organization_id and c.id = new.config_id;
  if not found
    or linked_config_version <> new.config_version
    or linked_effective_month > new.capacity_month
  then raise exception 'CAPACITY_CONFIG_REFERENCE_INVALID'; end if;
  return new;
end;
$$;

create trigger opportunity_capacity_schedules_rpc_only
before insert or update or delete on public.opportunity_capacity_schedules
for each row execute function app.enforce_capacity_schedule_write_path();

create or replace function app.enforce_capacity_command_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'OPERATIONAL_CAPACITY_COMMAND_APPEND_ONLY';
  end if;
  if current_setting('app.capacity_schedule_rpc', true) is distinct from 'true' then
    raise exception 'OPERATIONAL_CAPACITY_SCHEDULE_RPC_REQUIRED';
  end if;
  return new;
end;
$$;

create trigger operational_capacity_commands_append_only
before insert or update or delete on public.operational_capacity_commands
for each row execute function app.enforce_capacity_command_append_only();

create or replace function app.create_operational_capacity_config(
  target_organization_id uuid,
  target_monthly_limit integer,
  target_warning_at integer,
  target_effective_from_month date,
  target_source_reference text,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  idempotency_hash text := encode(digest(coalesce(target_idempotency_key, ''), 'sha256'), 'hex');
  existing_config public.operational_capacity_configs%rowtype;
  created_config public.operational_capacity_configs%rowtype;
  next_version integer;
  affected_capacity_month date;
begin
  if not app.has_role(target_organization_id, array[
    'ennco_admin'::public.user_role, 'teckel_admin'::public.user_role
  ]) then raise exception 'CAPACITY_CONFIG_ADMIN_AAL2_REQUIRED'; end if;
  if target_monthly_limit is null or target_monthly_limit not between 1 and 100
    or target_warning_at is null or target_warning_at not between 1 and target_monthly_limit
    or target_effective_from_month is null
    or target_effective_from_month <> date_trunc('month', target_effective_from_month)::date
    or nullif(btrim(target_source_reference), '') is null
    or octet_length(target_source_reference) > 1000
    or target_idempotency_key is null
    or target_idempotency_key !~ '^[A-Za-z0-9._:-]{8,200}$'
  then raise exception 'CAPACITY_CONFIG_INPUT_INVALID'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || ':operational-capacity-config', 0
  ));
  select * into existing_config
  from public.operational_capacity_configs
  where organization_id = target_organization_id and idempotency_key = idempotency_hash;
  if found then
    if existing_config.monthly_limit = target_monthly_limit
      and existing_config.warning_at = target_warning_at
      and existing_config.effective_from_month = target_effective_from_month
      and existing_config.source_reference = btrim(target_source_reference)
    then return jsonb_build_object(
      'status', 'DUPLICATE', 'config_id', existing_config.id,
      'config_version', existing_config.version
    ); end if;
    raise exception 'CAPACITY_CONFIG_IDEMPOTENCY_DRIFT';
  end if;

  select coalesce(max(version), 0) + 1 into next_version
  from public.operational_capacity_configs
  where organization_id = target_organization_id;
  if next_version = 1 and (
    target_monthly_limit <> 2 or target_warning_at <> 1
  ) then raise exception 'INITIAL_CAPACITY_MUST_MATCH_CONFIRMED_TWO_PROJECTS'; end if;

  perform set_config('app.capacity_config_rpc', 'true', true);
  insert into public.operational_capacity_configs (
    organization_id, version, monthly_limit, warning_at, effective_from_month,
    source_reference, idempotency_key, created_by
  ) values (
    target_organization_id, next_version, target_monthly_limit, target_warning_at,
    target_effective_from_month, btrim(target_source_reference), idempotency_hash, auth.uid()
  ) returning * into created_config;

  insert into public.event_outbox (
    organization_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload_json
  ) values (
    target_organization_id, 'operational_capacity_config', created_config.id,
    'operational_capacity.configured', 'capacity-config:' || idempotency_hash,
    jsonb_build_object(
      'config_id', created_config.id,
      'config_version', created_config.version,
      'monthly_limit', created_config.monthly_limit,
      'warning_at', created_config.warning_at,
      'effective_from_month', created_config.effective_from_month
    )
  ) on conflict (organization_id, idempotency_key) do nothing;
  for affected_capacity_month in
    select distinct s.capacity_month
    from public.opportunity_capacity_schedules s
    where s.organization_id = target_organization_id
      and s.capacity_month >= target_effective_from_month
    order by s.capacity_month
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      target_organization_id::text || ':capacity-month:' || affected_capacity_month::text, 0
    ));
    perform app.reconcile_operational_capacity_alert(
      target_organization_id, affected_capacity_month
    );
  end loop;
  return jsonb_build_object(
    'status', 'CREATED', 'config_id', created_config.id,
    'config_version', created_config.version
  );
end;
$$;

create or replace function app.evaluate_monthly_operational_capacity(
  target_organization_id uuid,
  target_capacity_month date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  selected_config public.operational_capacity_configs%rowtype;
  committed integer;
  unscheduled_closed_won integer;
  evaluated_state text;
  available integer;
  over_capacity integer;
begin
  if not app.is_member(target_organization_id) then
    raise exception 'CAPACITY_READ_AAL2_MEMBERSHIP_REQUIRED';
  end if;
  if target_capacity_month is null
    or target_capacity_month <> date_trunc('month', target_capacity_month)::date
  then raise exception 'CAPACITY_MONTH_FIRST_DAY_REQUIRED'; end if;

  select count(*)::integer into committed
  from public.opportunity_capacity_schedules s
  join public.opportunities o
    on o.organization_id = s.organization_id and o.id = s.opportunity_id
  where s.organization_id = target_organization_id
    and s.capacity_month = target_capacity_month
    and o.stage = 'CLOSED_WON';
  select count(*)::integer into unscheduled_closed_won
  from public.opportunities o
  where o.organization_id = target_organization_id
    and o.stage = 'CLOSED_WON'
    and not exists (
      select 1 from public.opportunity_capacity_schedules s
      where s.organization_id = o.organization_id and s.opportunity_id = o.id
    );

  select * into selected_config
  from public.operational_capacity_configs c
  where c.organization_id = target_organization_id
    and c.effective_from_month <= target_capacity_month
  order by c.effective_from_month desc, c.version desc, c.created_at desc, c.id desc
  limit 1;
  if not found then
    return jsonb_build_object(
      'status', 'READ_ONLY', 'state', 'UNKNOWN',
      'organization_id', target_organization_id,
      'capacity_month', target_capacity_month,
      'config_id', null, 'config_version', null,
      'monthly_limit', null, 'warning_at', null,
      'committed_projects', committed,
      'unscheduled_closed_won_projects', unscheduled_closed_won,
      'available_projects', null, 'over_capacity_projects', null,
      'reason_code', 'CAPACITY_CONFIG_MISSING',
      'evaluated_at', clock_timestamp()
    );
  end if;

  if unscheduled_closed_won > 0 then
    return jsonb_build_object(
      'status', 'READ_ONLY', 'state', 'UNKNOWN',
      'organization_id', target_organization_id,
      'capacity_month', target_capacity_month,
      'config_id', selected_config.id,
      'config_version', selected_config.version,
      'monthly_limit', selected_config.monthly_limit,
      'warning_at', selected_config.warning_at,
      'committed_projects', committed,
      'unscheduled_closed_won_projects', unscheduled_closed_won,
      'available_projects', null, 'over_capacity_projects', null,
      'reason_code', 'CLOSED_WON_EXECUTION_DATE_MISSING',
      'evaluated_at', clock_timestamp()
    );
  end if;

  if committed < selected_config.warning_at then evaluated_state := 'HEALTHY';
  elsif committed < selected_config.monthly_limit then evaluated_state := 'WARNING';
  else evaluated_state := 'FULL';
  end if;
  available := greatest(selected_config.monthly_limit - committed, 0);
  over_capacity := greatest(committed - selected_config.monthly_limit, 0);
  return jsonb_build_object(
    'status', 'READ_ONLY', 'state', evaluated_state,
    'organization_id', target_organization_id,
    'capacity_month', target_capacity_month,
    'config_id', selected_config.id,
    'config_version', selected_config.version,
    'monthly_limit', selected_config.monthly_limit,
    'warning_at', selected_config.warning_at,
    'committed_projects', committed,
    'unscheduled_closed_won_projects', unscheduled_closed_won,
    'available_projects', available,
    'over_capacity_projects', over_capacity,
    'reason_code', null,
    'evaluated_at', clock_timestamp()
  );
end;
$$;

create or replace function app.reconcile_operational_capacity_alert(
  target_organization_id uuid,
  target_capacity_month date
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  evaluation jsonb;
  capacity_state text;
  committed integer;
  monthly_limit integer;
  alert_kind text;
  alert_event text;
  alert_task_id uuid;
  objective text := 'CAPACITY_MONTH:' || target_capacity_month::text;
  unscheduled_closed_won integer;
begin
  evaluation := app.evaluate_monthly_operational_capacity(
    target_organization_id, target_capacity_month
  );
  capacity_state := evaluation->>'state';
  if capacity_state = 'UNKNOWN' then
    if evaluation->>'reason_code' = 'CAPACITY_CONFIG_MISSING' then
      raise exception 'CAPACITY_CONFIG_MISSING_FAIL_CLOSED';
    end if;
    unscheduled_closed_won := (evaluation->>'unscheduled_closed_won_projects')::integer;
    insert into public.tasks (
      organization_id, task_type, normalized_objective, owner_user_id, due_at, status
    ) values (
      target_organization_id, 'CAPACITY_DATE_MISSING',
      'UNSCHEDULED_CLOSED_WON_PROJECTS', auth.uid(), clock_timestamp(), 'OPEN'
    ) on conflict do nothing returning id into alert_task_id;
    if alert_task_id is null then
      select id into alert_task_id from public.tasks
      where organization_id = target_organization_id
        and task_type = 'CAPACITY_DATE_MISSING'
        and normalized_objective = 'UNSCHEDULED_CLOSED_WON_PROJECTS'
        and status = 'OPEN';
    end if;
    insert into public.event_outbox (
      organization_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload_json
    ) values (
      target_organization_id, 'operational_capacity', coalesce(alert_task_id, gen_random_uuid()),
      'operational_capacity.execution_date_missing',
      'capacity-date-missing:' || target_organization_id::text || ':' || unscheduled_closed_won::text,
      jsonb_build_object(
        'reason_code', 'CLOSED_WON_EXECUTION_DATE_MISSING',
        'unscheduled_closed_won_projects', unscheduled_closed_won,
        'task_id', alert_task_id
      )
    ) on conflict (organization_id, idempotency_key) do nothing;
    return evaluation;
  end if;
  committed := (evaluation->>'committed_projects')::integer;
  monthly_limit := (evaluation->>'monthly_limit')::integer;

  if capacity_state = 'HEALTHY' then
    update public.tasks
    set status = 'CANCELLED', completed_at = clock_timestamp()
    where organization_id = target_organization_id
      and task_type in ('CAPACITY_WARNING', 'CAPACITY_FULL', 'CAPACITY_EXCEEDED')
      and normalized_objective = objective and status = 'OPEN';
    return evaluation;
  end if;
  if capacity_state = 'WARNING' then
    alert_kind := 'CAPACITY_WARNING';
    alert_event := 'operational_capacity.warning';
  elsif committed > monthly_limit then
    alert_kind := 'CAPACITY_EXCEEDED';
    alert_event := 'operational_capacity.exceeded';
  else
    alert_kind := 'CAPACITY_FULL';
    alert_event := 'operational_capacity.full';
  end if;

  update public.tasks
  set status = 'CANCELLED', completed_at = clock_timestamp()
  where organization_id = target_organization_id
    and task_type in ('CAPACITY_WARNING', 'CAPACITY_FULL', 'CAPACITY_EXCEEDED')
    and task_type <> alert_kind
    and normalized_objective = objective and status = 'OPEN';
  insert into public.tasks (
    organization_id, task_type, normalized_objective, owner_user_id, due_at, status
  ) values (
    target_organization_id, alert_kind, objective, auth.uid(),
    case when alert_kind = 'CAPACITY_WARNING'
      then clock_timestamp() + interval '1 day' else clock_timestamp() end,
    'OPEN'
  ) on conflict do nothing returning id into alert_task_id;
  if alert_task_id is null then
    select id into alert_task_id from public.tasks
    where organization_id = target_organization_id
      and task_type = alert_kind and normalized_objective = objective and status = 'OPEN';
  end if;

  insert into public.event_outbox (
    organization_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload_json
  ) values (
    target_organization_id, 'operational_capacity', coalesce(alert_task_id, gen_random_uuid()),
    alert_event,
    'capacity-alert:' || target_organization_id::text || ':' || target_capacity_month::text
      || ':v' || (evaluation->>'config_version') || ':' || lower(alert_kind)
      || ':' || committed::text,
    jsonb_build_object(
      'capacity_month', target_capacity_month,
      'config_version', (evaluation->>'config_version')::integer,
      'state', capacity_state,
      'alert_kind', alert_kind,
      'committed_projects', committed,
      'monthly_limit', monthly_limit,
      'available_projects', (evaluation->>'available_projects')::integer,
      'over_capacity_projects', (evaluation->>'over_capacity_projects')::integer,
      'task_id', alert_task_id
    )
  ) on conflict (organization_id, idempotency_key) do nothing;
  return evaluation;
end;
$$;

create or replace function app.schedule_closed_won_capacity(
  target_organization_id uuid,
  target_opportunity_id uuid,
  target_execution_date date,
  target_change_reason text,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  idempotency_hash text := encode(digest(coalesce(target_idempotency_key, ''), 'sha256'), 'hex');
  requested_month date := date_trunc('month', target_execution_date)::date;
  opportunity_record public.opportunities%rowtype;
  selected_config public.operational_capacity_configs%rowtype;
  existing_schedule public.opportunity_capacity_schedules%rowtype;
  existing_command public.operational_capacity_commands%rowtype;
  resulting_schedule public.opportunity_capacity_schedules%rowtype;
  result_status text;
  capacity_result jsonb;
  prior_capacity_result jsonb;
  lock_month date;
  unscheduled_after integer;
  capacity_month_to_reconcile date;
begin
  if not app.has_role(target_organization_id, array[
    'ennco_admin'::public.user_role, 'ennco_operator'::public.user_role,
    'teckel_admin'::public.user_role, 'teckel_operator'::public.user_role
  ]) then raise exception 'CAPACITY_OPERATOR_AAL2_REQUIRED'; end if;
  if target_execution_date is null
    or nullif(btrim(target_change_reason), '') is null
    or octet_length(target_change_reason) > 2000
    or target_idempotency_key is null
    or target_idempotency_key !~ '^[A-Za-z0-9._:-]{8,200}$'
  then raise exception 'CAPACITY_SCHEDULE_INPUT_INVALID'; end if;

  perform pg_advisory_xact_lock_shared(hashtextextended(
    target_organization_id::text || ':operational-capacity-config', 0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || ':capacity-opportunity:' || target_opportunity_id::text, 0
  ));
  select * into opportunity_record
  from public.opportunities
  where organization_id = target_organization_id and id = target_opportunity_id
  for share;
  if not found then raise exception 'CAPACITY_OPPORTUNITY_NOT_FOUND_OR_TENANT_MISMATCH'; end if;
  if opportunity_record.stage <> 'CLOSED_WON' then
    raise exception 'CAPACITY_REQUIRES_CLOSED_WON_OPPORTUNITY';
  end if;

  select * into existing_schedule
  from public.opportunity_capacity_schedules
  where organization_id = target_organization_id and opportunity_id = target_opportunity_id
  for update;
  for lock_month in
    select distinct month_value
    from unnest(array[requested_month, existing_schedule.capacity_month]) month_value
    where month_value is not null order by month_value
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      target_organization_id::text || ':capacity-month:' || lock_month::text, 0
    ));
  end loop;

  select * into existing_command
  from public.operational_capacity_commands
  where organization_id = target_organization_id and idempotency_key = idempotency_hash;
  if found then
    if existing_command.opportunity_id = target_opportunity_id
      and existing_command.execution_date = target_execution_date
      and existing_command.change_reason = btrim(target_change_reason)
    then
      capacity_result := app.evaluate_monthly_operational_capacity(
        target_organization_id, date_trunc('month', existing_command.execution_date)::date
      );
      return jsonb_build_object(
        'status', 'DUPLICATE', 'schedule_id', existing_command.schedule_id,
        'opportunity_id', existing_command.opportunity_id,
        'execution_date', existing_command.execution_date,
        'capacity_month', date_trunc('month', existing_command.execution_date)::date,
        'capacity', capacity_result
      );
    end if;
    raise exception 'CAPACITY_SCHEDULE_IDEMPOTENCY_DRIFT';
  end if;

  select * into selected_config
  from public.operational_capacity_configs c
  where c.organization_id = target_organization_id
    and c.effective_from_month <= requested_month
  order by c.effective_from_month desc, c.version desc, c.created_at desc, c.id desc
  limit 1;
  if not found then raise exception 'CAPACITY_CONFIG_MISSING_FAIL_CLOSED'; end if;

  perform set_config('app.capacity_schedule_rpc', 'true', true);
  if existing_schedule.id is null then
    insert into public.opportunity_capacity_schedules (
      organization_id, opportunity_id, execution_date, capacity_month,
      config_id, config_version, idempotency_key, change_reason, scheduled_by
    ) values (
      target_organization_id, target_opportunity_id, target_execution_date, requested_month,
      selected_config.id, selected_config.version, idempotency_hash,
      btrim(target_change_reason), auth.uid()
    ) returning * into resulting_schedule;
    result_status := 'SCHEDULED';
  elsif existing_schedule.execution_date = target_execution_date
    and existing_schedule.change_reason = btrim(target_change_reason)
  then
    resulting_schedule := existing_schedule;
    result_status := 'UNCHANGED';
  else
    update public.opportunity_capacity_schedules
    set execution_date = target_execution_date,
        capacity_month = requested_month,
        config_id = selected_config.id,
        config_version = selected_config.version,
        idempotency_key = idempotency_hash,
        change_reason = btrim(target_change_reason),
        scheduled_by = auth.uid(),
        scheduled_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where id = existing_schedule.id and organization_id = target_organization_id
    returning * into resulting_schedule;
    result_status := 'RESCHEDULED';
  end if;

  insert into public.operational_capacity_commands (
    organization_id, schedule_id, opportunity_id, execution_date,
    idempotency_key, change_reason, result_status, created_by
  ) values (
    target_organization_id, resulting_schedule.id, target_opportunity_id,
    target_execution_date, idempotency_hash, btrim(target_change_reason),
    result_status, auth.uid()
  );
  insert into public.event_outbox (
    organization_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload_json
  ) values (
    target_organization_id, 'operational_capacity_schedule', resulting_schedule.id,
    'operational_capacity.schedule_recorded', 'capacity-command:' || idempotency_hash,
    jsonb_build_object(
      'schedule_id', resulting_schedule.id,
      'opportunity_id', target_opportunity_id,
      'execution_date', target_execution_date,
      'capacity_month', requested_month,
      'config_version', selected_config.version,
      'result_status', result_status
    )
  ) on conflict (organization_id, idempotency_key) do nothing;

  select count(*)::integer into unscheduled_after
  from public.opportunities o
  where o.organization_id = target_organization_id
    and o.stage = 'CLOSED_WON'
    and not exists (
      select 1 from public.opportunity_capacity_schedules s
      where s.organization_id = o.organization_id and s.opportunity_id = o.id
    );
  if unscheduled_after = 0 then
    update public.tasks
    set status = 'DONE', completed_at = clock_timestamp()
    where organization_id = target_organization_id
      and task_type = 'CAPACITY_DATE_MISSING'
      and normalized_objective = 'UNSCHEDULED_CLOSED_WON_PROJECTS'
      and status = 'OPEN';
    for capacity_month_to_reconcile in
      select distinct s.capacity_month
      from public.opportunity_capacity_schedules s
      where s.organization_id = target_organization_id
        and s.capacity_month <> requested_month
        and (
          existing_schedule.id is null
          or s.capacity_month <> existing_schedule.capacity_month
        )
      order by s.capacity_month
    loop
      perform pg_advisory_xact_lock(hashtextextended(
        target_organization_id::text || ':capacity-month:' || capacity_month_to_reconcile::text, 0
      ));
      perform app.reconcile_operational_capacity_alert(
        target_organization_id, capacity_month_to_reconcile
      );
    end loop;
  end if;

  if existing_schedule.id is not null
    and existing_schedule.capacity_month <> requested_month
  then
    prior_capacity_result := app.reconcile_operational_capacity_alert(
      target_organization_id, existing_schedule.capacity_month
    );
  end if;
  capacity_result := app.reconcile_operational_capacity_alert(
    target_organization_id, requested_month
  );
  return jsonb_build_object(
    'status', result_status, 'schedule_id', resulting_schedule.id,
    'opportunity_id', target_opportunity_id,
    'execution_date', target_execution_date,
    'capacity_month', requested_month,
    'capacity', capacity_result,
    'prior_month_capacity', prior_capacity_result
  );
end;
$$;

alter table public.operational_capacity_configs enable row level security;
alter table public.opportunity_capacity_schedules enable row level security;
alter table public.operational_capacity_commands enable row level security;

create policy operational_capacity_configs_member_read
on public.operational_capacity_configs for select
using (app.is_member(organization_id));
create policy opportunity_capacity_schedules_member_read
on public.opportunity_capacity_schedules for select
using (app.is_member(organization_id));
create policy operational_capacity_commands_member_read
on public.operational_capacity_commands for select
using (app.is_member(organization_id));

create trigger operational_capacity_configs_audit
after insert or update or delete on public.operational_capacity_configs
for each row execute function app.capture_audit_event();
create trigger opportunity_capacity_schedules_audit
after insert or update or delete on public.opportunity_capacity_schedules
for each row execute function app.capture_audit_event();
create trigger operational_capacity_commands_audit
after insert or update or delete on public.operational_capacity_commands
for each row execute function app.capture_audit_event();

revoke all on table public.operational_capacity_configs from public, authenticated;
revoke all on table public.opportunity_capacity_schedules from public, authenticated;
revoke all on table public.operational_capacity_commands from public, authenticated;
grant select on table public.operational_capacity_configs to authenticated;
grant select on table public.opportunity_capacity_schedules to authenticated;
grant select on table public.operational_capacity_commands to authenticated;

revoke all on function app.enforce_capacity_config_append_only() from public;
revoke all on function app.enforce_capacity_schedule_write_path() from public;
revoke all on function app.enforce_capacity_command_append_only() from public;
revoke all on function app.create_operational_capacity_config(uuid, integer, integer, date, text, text) from public;
revoke all on function app.evaluate_monthly_operational_capacity(uuid, date) from public;
revoke all on function app.reconcile_operational_capacity_alert(uuid, date) from public;
revoke all on function app.schedule_closed_won_capacity(uuid, uuid, date, text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function app.create_operational_capacity_config(uuid, integer, integer, date, text, text) to authenticated;
    grant execute on function app.evaluate_monthly_operational_capacity(uuid, date) to authenticated;
    grant execute on function app.schedule_closed_won_capacity(uuid, uuid, date, text, text) to authenticated;
    revoke execute on function app.reconcile_operational_capacity_alert(uuid, date) from authenticated;
    revoke insert, update, delete, truncate on public.operational_capacity_configs from authenticated;
    revoke insert, update, delete, truncate on public.opportunity_capacity_schedules from authenticated;
    revoke insert, update, delete, truncate on public.operational_capacity_commands from authenticated;
  end if;
end;
$$;

commit;
