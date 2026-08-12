\set ON_ERROR_STOP on

set request.jwt.claim.sub = '81111111-1111-4111-8111-111111111111';
set request.jwt.claim.aal = 'aal2';
set role authenticated;

do $$
declare evaluation jsonb;
begin
  if to_regclass('public.operational_capacity_configs') is not null
    or to_regclass('public.opportunity_capacity_schedules') is not null
    or to_regclass('public.operational_capacity_commands') is not null
  then raise exception 'M018_ROLLBACK_LEFT_CAPACITY_TABLES'; end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.opportunities'::regclass
      and tgname = 'opportunities_m018_rollback_fail_closed' and not tgisinternal
  ) then raise exception 'M018_ROLLBACK_MISSING_CLOSED_WON_GUARD'; end if;

  evaluation := app.evaluate_monthly_operational_capacity(
    '11111111-1111-4111-8111-111111111111', '2027-01-01'
  );
  if evaluation->>'state' <> 'UNKNOWN'
    or evaluation->>'reason_code' <> 'M018_ROLLED_BACK_CAPACITY_UNAVAILABLE'
  then raise exception 'M018_ROLLBACK_EVALUATION_NOT_FAIL_CLOSED'; end if;
  begin
    perform app.create_operational_capacity_config(
      '11111111-1111-4111-8111-111111111111', 2, 1, '2027-01-01',
      'Synthetic rollback', 'capacity-rollback-config'
    );
    raise exception 'EXPECTED_ROLLBACK_CONFIG_BLOCK';
  exception when others then
    if sqlerrm <> 'M018_ROLLED_BACK_CAPACITY_CONFIG_DISABLED' then raise; end if;
  end;
  begin
    perform app.schedule_closed_won_capacity(
      '11111111-1111-4111-8111-111111111111',
      '41111111-1111-4111-8111-111111111114',
      '2027-03-10', 'Synthetic rollback', 'capacity-rollback-schedule'
    );
    raise exception 'EXPECTED_ROLLBACK_SCHEDULE_BLOCK';
  exception when others then
    if sqlerrm <> 'M018_ROLLED_BACK_CAPACITY_SCHEDULING_DISABLED' then raise; end if;
  end;
end;
$$;

reset role;
reset request.jwt.claim.aal;
reset request.jwt.claim.sub;

do $$
begin
  begin
    update public.opportunities set stage = 'CLOSED_WON'
    where id = '41111111-1111-4111-8111-111111111116';
    raise exception 'EXPECTED_ROLLBACK_CLOSED_WON_BLOCK';
  exception when others then
    if sqlerrm <> 'M018_ROLLED_BACK_CLOSED_WON_DISABLED' then raise; end if;
  end;
end;
$$;

\echo 'MONTHLY_OPERATIONAL_CAPACITY_ROLLBACK_GATE_PASS'
