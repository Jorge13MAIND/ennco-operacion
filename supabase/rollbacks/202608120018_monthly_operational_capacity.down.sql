begin;

revoke execute on function app.create_operational_capacity_config(uuid, integer, integer, date, text, text) from authenticated;
revoke execute on function app.evaluate_monthly_operational_capacity(uuid, date) from authenticated;
revoke execute on function app.schedule_closed_won_capacity(uuid, uuid, date, text, text) from authenticated;

drop function if exists app.reconcile_operational_capacity_alert(uuid, date);
drop function if exists app.create_operational_capacity_config(uuid, integer, integer, date, text, text);
drop function if exists app.evaluate_monthly_operational_capacity(uuid, date);
drop function if exists app.schedule_closed_won_capacity(uuid, uuid, date, text, text);

drop table if exists public.operational_capacity_commands;
drop table if exists public.opportunity_capacity_schedules;
drop table if exists public.operational_capacity_configs;

drop function if exists app.enforce_capacity_command_append_only();
drop function if exists app.enforce_capacity_schedule_write_path();
drop function if exists app.enforce_capacity_config_append_only();

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
begin
  raise exception 'M018_ROLLED_BACK_CAPACITY_CONFIG_DISABLED';
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
begin
  if not app.is_member(target_organization_id) then
    raise exception 'CAPACITY_READ_AAL2_MEMBERSHIP_REQUIRED';
  end if;
  return jsonb_build_object(
    'status', 'READ_ONLY', 'state', 'UNKNOWN',
    'organization_id', target_organization_id,
    'capacity_month', date_trunc('month', target_capacity_month)::date,
    'config_id', null, 'config_version', null,
    'monthly_limit', null, 'warning_at', null,
    'committed_projects', 0,
    'unscheduled_closed_won_projects', null,
    'available_projects', null, 'over_capacity_projects', null,
    'reason_code', 'M018_ROLLED_BACK_CAPACITY_UNAVAILABLE',
    'evaluated_at', clock_timestamp()
  );
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
begin
  raise exception 'M018_ROLLED_BACK_CAPACITY_SCHEDULING_DISABLED';
end;
$$;

create or replace function app.block_closed_won_without_m018()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.stage = 'CLOSED_WON' and old.stage <> 'CLOSED_WON' then
    raise exception 'M018_ROLLED_BACK_CLOSED_WON_DISABLED';
  end if;
  return new;
end;
$$;

create trigger opportunities_m018_rollback_fail_closed
before update of stage on public.opportunities
for each row execute function app.block_closed_won_without_m018();

revoke all on function app.create_operational_capacity_config(uuid, integer, integer, date, text, text) from public;
revoke all on function app.evaluate_monthly_operational_capacity(uuid, date) from public;
revoke all on function app.schedule_closed_won_capacity(uuid, uuid, date, text, text) from public;
revoke all on function app.block_closed_won_without_m018() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function app.create_operational_capacity_config(uuid, integer, integer, date, text, text) to authenticated;
    grant execute on function app.evaluate_monthly_operational_capacity(uuid, date) to authenticated;
    grant execute on function app.schedule_closed_won_capacity(uuid, uuid, date, text, text) to authenticated;
  end if;
end;
$$;

commit;
