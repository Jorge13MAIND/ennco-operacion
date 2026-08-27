-- M033: estas aserciones prueban el rechazo de la sesión de un solo factor.
-- Se fija la política en modo estricto para que sigan probando exactamente lo
-- mismo que antes de DEC-106. Los dos modos se prueban en el gate 034.
do $m033$ begin
  if to_regclass('app.auth_policy') is not null then
    update app.auth_policy set require_mfa = true;
  end if;
end $m033$;

\set ON_ERROR_STOP on

insert into public.organizations (id, slug, legal_name) values
  ('11111111-1111-4111-8111-111111111111', 'capacity-org-a', 'Synthetic Capacity Organization A'),
  ('22222222-2222-4222-8222-222222222222', 'capacity-org-b', 'Synthetic Capacity Organization B');
insert into public.organization_users (organization_id, user_id, role) values
  ('11111111-1111-4111-8111-111111111111', '81111111-1111-4111-8111-111111111111', 'ennco_admin'),
  ('11111111-1111-4111-8111-111111111111', '81111111-1111-4111-8111-111111111112', 'ennco_operator'),
  ('22222222-2222-4222-8222-222222222222', '82222222-2222-4222-8222-222222222222', 'ennco_admin');
insert into public.accounts (
  id, organization_id, legal_name, normalized_name, evidence_class, source_confidence
) values
  ('21111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Synthetic Account A1', 'synthetic account a1', 'synthetic_demo', 'VERIFIED'),
  ('21111111-1111-4111-8111-111111111112', '11111111-1111-4111-8111-111111111111', 'Synthetic Account A2', 'synthetic account a2', 'synthetic_demo', 'VERIFIED'),
  ('21111111-1111-4111-8111-111111111113', '11111111-1111-4111-8111-111111111111', 'Synthetic Account A3', 'synthetic account a3', 'synthetic_demo', 'VERIFIED'),
  ('21111111-1111-4111-8111-111111111114', '11111111-1111-4111-8111-111111111111', 'Synthetic Account A4', 'synthetic account a4', 'synthetic_demo', 'VERIFIED'),
  ('21111111-1111-4111-8111-111111111115', '11111111-1111-4111-8111-111111111111', 'Synthetic Account A5', 'synthetic account a5', 'synthetic_demo', 'VERIFIED'),
  ('21111111-1111-4111-8111-111111111116', '11111111-1111-4111-8111-111111111111', 'Synthetic Prospect', 'synthetic prospect', 'synthetic_demo', 'VERIFIED'),
  ('22222222-2222-4222-8222-222222222221', '22222222-2222-4222-8222-222222222222', 'Synthetic Account B1', 'synthetic account b1', 'synthetic_demo', 'VERIFIED');

alter table public.opportunities disable trigger opportunities_strict_stage_transition;
insert into public.opportunities (id, organization_id, account_id, stage) values
  ('41111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111111', 'CLOSED_WON'),
  ('41111111-1111-4111-8111-111111111112', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111112', 'CLOSED_WON'),
  ('41111111-1111-4111-8111-111111111113', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111113', 'CLOSED_WON'),
  ('41111111-1111-4111-8111-111111111114', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111114', 'CLOSED_WON'),
  ('41111111-1111-4111-8111-111111111115', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111115', 'CLOSED_WON'),
  ('41111111-1111-4111-8111-111111111116', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111116', 'PROSPECTING'),
  ('42222222-2222-4222-8222-222222222221', '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222221', 'CLOSED_WON');
alter table public.opportunities enable trigger opportunities_strict_stage_transition;
insert into public.leads (
  id, organization_id, account_id, status, contractual_qualified, evidence_class
) values (
  '61111111-1111-4111-8111-111111111118',
  '11111111-1111-4111-8111-111111111111',
  '21111111-1111-4111-8111-111111111116',
  'CAPTURED', false, 'synthetic_demo'
);

set request.jwt.claim.sub = '81111111-1111-4111-8111-111111111111';
set request.jwt.claim.aal = 'aal2';
set role authenticated;

do $$
declare
  evaluation jsonb;
  tasks_before bigint := (select count(*) from public.tasks);
  outbox_before bigint := (select count(*) from public.event_outbox);
begin
  evaluation := app.evaluate_monthly_operational_capacity(
    '11111111-1111-4111-8111-111111111111', '2027-01-01'
  );
  if evaluation->>'status' <> 'READ_ONLY'
    or evaluation->>'state' <> 'UNKNOWN'
    or evaluation->>'reason_code' <> 'CAPACITY_CONFIG_MISSING'
    or (evaluation->>'committed_projects')::integer <> 0
    or (evaluation->>'unscheduled_closed_won_projects')::integer <> 5
    or evaluation->'available_projects' <> 'null'::jsonb
  then raise exception 'MISSING_CONFIG_DID_NOT_RETURN_UNKNOWN'; end if;
  if (select count(*) from public.tasks) <> tasks_before
    or (select count(*) from public.event_outbox) <> outbox_before
  then raise exception 'READ_ONLY_EVALUATION_MUTATED_STATE'; end if;

  begin
    perform app.schedule_closed_won_capacity(
      '11111111-1111-4111-8111-111111111111',
      '41111111-1111-4111-8111-111111111111',
      '2027-01-15', 'Synthetic initial execution month', 'capacity-missing-config-01'
    );
    raise exception 'EXPECTED_MISSING_CONFIG_REJECTION';
  exception when others then
    if sqlerrm <> 'CAPACITY_CONFIG_MISSING_FAIL_CLOSED' then raise; end if;
  end;
  if exists (select 1 from public.opportunity_capacity_schedules)
    or exists (select 1 from public.operational_capacity_commands)
  then raise exception 'MISSING_CONFIG_LEFT_CAPACITY_MUTATION'; end if;

  begin
    perform app.create_operational_capacity_config(
      '11111111-1111-4111-8111-111111111111', 3, 2, '2027-01-01',
      'Synthetic invalid initial capacity', 'capacity-config-invalid-initial'
    );
    raise exception 'EXPECTED_INITIAL_TWO_PROJECT_REQUIREMENT';
  exception when others then
    if sqlerrm <> 'INITIAL_CAPACITY_MUST_MATCH_CONFIRMED_TWO_PROJECTS' then raise; end if;
  end;
  if exists (select 1 from public.operational_capacity_configs) then
    raise exception 'INVALID_INITIAL_CONFIG_WAS_PERSISTED';
  end if;

  begin
    perform app.evaluate_monthly_operational_capacity(
      '11111111-1111-4111-8111-111111111111', '2027-01-15'
    );
    raise exception 'EXPECTED_FIRST_DAY_VALIDATION';
  exception when others then
    if sqlerrm <> 'CAPACITY_MONTH_FIRST_DAY_REQUIRED' then raise; end if;
  end;
end;
$$;

select app.create_operational_capacity_config(
  '11111111-1111-4111-8111-111111111111', 2, 1, '2027-01-01',
  'CONFIRMED_CAPACITY_TWO_PROJECTS_SYNTHETIC', 'capacity-config-v1-2027'
);

do $$
declare evaluation jsonb;
begin
  evaluation := app.evaluate_monthly_operational_capacity(
    '11111111-1111-4111-8111-111111111111', '2027-01-01'
  );
  if evaluation->>'state' <> 'UNKNOWN'
    or evaluation->>'reason_code' <> 'CLOSED_WON_EXECUTION_DATE_MISSING'
    or (evaluation->>'unscheduled_closed_won_projects')::integer <> 5
    or evaluation->'available_projects' <> 'null'::jsonb
  then raise exception 'UNSCHEDULED_CLOSED_WON_DID_NOT_FAIL_CLOSED'; end if;
end;
$$;

do $$
declare result jsonb;
begin
  result := app.create_operational_capacity_config(
    '11111111-1111-4111-8111-111111111111', 2, 1, '2027-01-01',
    'CONFIRMED_CAPACITY_TWO_PROJECTS_SYNTHETIC', 'capacity-config-v1-2027'
  );
  if result->>'status' <> 'DUPLICATE' or (result->>'config_version')::integer <> 1 then
    raise exception 'CAPACITY_CONFIG_IDEMPOTENCY_FAILED';
  end if;
  begin
    perform app.create_operational_capacity_config(
      '11111111-1111-4111-8111-111111111111', 2, 2, '2027-01-01',
      'Synthetic drift', 'capacity-config-v1-2027'
    );
    raise exception 'EXPECTED_CONFIG_IDEMPOTENCY_DRIFT';
  exception when others then
    if sqlerrm <> 'CAPACITY_CONFIG_IDEMPOTENCY_DRIFT' then raise; end if;
  end;
end;
$$;

select app.create_operational_capacity_config(
  '11111111-1111-4111-8111-111111111111', 2, 1, '2027-01-01',
  'CONFIRMED_CAPACITY_TWO_PROJECTS_SYNTHETIC_REVALIDATED', 'capacity-config-v2-2027'
);

do $$
begin
  begin
    perform app.schedule_closed_won_capacity(
      '11111111-1111-4111-8111-111111111111',
      '41111111-1111-4111-8111-111111111116',
      '2027-01-20', 'Synthetic non-won', 'capacity-non-won-01'
    );
    raise exception 'EXPECTED_NON_WON_REJECTION';
  exception when others then
    if sqlerrm <> 'CAPACITY_REQUIRES_CLOSED_WON_OPPORTUNITY' then raise; end if;
  end;
  begin
    perform app.schedule_closed_won_capacity(
      '11111111-1111-4111-8111-111111111111',
      '42222222-2222-4222-8222-222222222221',
      '2027-01-20', 'Synthetic cross tenant', 'capacity-cross-tenant-01'
    );
    raise exception 'EXPECTED_CROSS_TENANT_REJECTION';
  exception when others then
    if sqlerrm <> 'CAPACITY_OPPORTUNITY_NOT_FOUND_OR_TENANT_MISMATCH' then raise; end if;
  end;
end;
$$;

select app.schedule_closed_won_capacity(
  '11111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111111',
  '2027-01-15', 'Synthetic January project one', 'capacity-schedule-jan-one'
);
select app.schedule_closed_won_capacity(
  '11111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111112',
  '2027-02-16', 'Synthetic initial February project two', 'capacity-schedule-initial-two'
);
select app.schedule_closed_won_capacity(
  '11111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111113',
  '2027-02-17', 'Synthetic initial February project three', 'capacity-schedule-initial-three'
);
select app.schedule_closed_won_capacity(
  '11111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111114',
  '2027-02-18', 'Synthetic initial February project four', 'capacity-schedule-initial-four'
);
select app.schedule_closed_won_capacity(
  '11111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111115',
  '2027-02-19', 'Synthetic initial February project five', 'capacity-schedule-initial-five'
);

do $$
declare evaluation jsonb;
begin
  evaluation := app.evaluate_monthly_operational_capacity(
    '11111111-1111-4111-8111-111111111111', '2027-01-01'
  );
  if evaluation->>'state' <> 'WARNING'
    or (evaluation->>'unscheduled_closed_won_projects')::integer <> 0
    or (evaluation->>'config_version')::integer <> 2
    or (evaluation->>'monthly_limit')::integer <> 2
    or (evaluation->>'warning_at')::integer <> 1
    or (evaluation->>'committed_projects')::integer <> 1
  then raise exception 'LATEST_EFFECTIVE_CAPACITY_CONFIG_NOT_SELECTED'; end if;
  if exists (
    select 1 from public.tasks where task_type = 'CAPACITY_DATE_MISSING' and status = 'OPEN'
  ) then raise exception 'CAPACITY_DATE_MISSING_TASK_NOT_RESOLVED'; end if;
  if not exists (
    select 1 from public.tasks where task_type = 'CAPACITY_DATE_MISSING' and status = 'DONE'
  ) or not exists (
    select 1 from public.event_outbox
    where event_type = 'operational_capacity.execution_date_missing'
      and payload_json->>'reason_code' = 'CLOSED_WON_EXECUTION_DATE_MISSING'
  ) then raise exception 'CAPACITY_DATE_MISSING_ALERT_LIFECYCLE_INVALID'; end if;
end;
$$;

do $$
declare
  replay jsonb;
  evaluation jsonb;
  task_count bigint := (select count(*) from public.tasks);
  outbox_count bigint := (select count(*) from public.event_outbox);
  command_count bigint := (select count(*) from public.operational_capacity_commands);
begin
  replay := app.schedule_closed_won_capacity(
    '11111111-1111-4111-8111-111111111111',
    '41111111-1111-4111-8111-111111111111',
    '2027-01-15', 'Synthetic January project one', 'capacity-schedule-jan-one'
  );
  if replay->>'status' <> 'DUPLICATE' then
    raise exception 'CAPACITY_SCHEDULE_IDEMPOTENCY_FAILED';
  end if;
  if (select count(*) from public.tasks) <> task_count
    or (select count(*) from public.event_outbox) <> outbox_count
    or (select count(*) from public.operational_capacity_commands) <> command_count
  then raise exception 'CAPACITY_SCHEDULE_REPLAY_MUTATED_STATE'; end if;
  evaluation := app.evaluate_monthly_operational_capacity(
    '11111111-1111-4111-8111-111111111111', '2027-01-01'
  );
  if evaluation->>'state' <> 'WARNING'
    or (evaluation->>'committed_projects')::integer <> 1
    or (evaluation->>'available_projects')::integer <> 1
    or (evaluation->>'over_capacity_projects')::integer <> 0
  then raise exception 'CAPACITY_WARNING_EVALUATION_INVALID'; end if;
  if not exists (
    select 1 from public.tasks where task_type = 'CAPACITY_WARNING'
      and normalized_objective = 'CAPACITY_MONTH:2027-01-01' and status = 'OPEN'
  ) or not exists (
    select 1 from public.event_outbox where event_type = 'operational_capacity.warning'
      and payload_json->>'committed_projects' = '1'
  ) then raise exception 'CAPACITY_WARNING_ALERT_MISSING'; end if;

  begin
    perform app.schedule_closed_won_capacity(
      '11111111-1111-4111-8111-111111111111',
      '41111111-1111-4111-8111-111111111112',
      '2027-01-16', 'Synthetic drift', 'capacity-schedule-jan-one'
    );
    raise exception 'EXPECTED_SCHEDULE_IDEMPOTENCY_DRIFT';
  exception when others then
    if sqlerrm <> 'CAPACITY_SCHEDULE_IDEMPOTENCY_DRIFT' then raise; end if;
  end;
end;
$$;

select app.schedule_closed_won_capacity(
  '11111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111112',
  '2027-01-16', 'Synthetic January project two', 'capacity-schedule-jan-two'
);
select app.schedule_closed_won_capacity(
  '11111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111113',
  '2027-01-17', 'Synthetic January project three', 'capacity-schedule-jan-three'
);

do $$
declare
  evaluation jsonb;
  tasks_before bigint;
  outbox_before bigint;
  audit_before bigint;
begin
  evaluation := app.evaluate_monthly_operational_capacity(
    '11111111-1111-4111-8111-111111111111', '2027-01-01'
  );
  if evaluation->>'state' <> 'FULL'
    or (evaluation->>'committed_projects')::integer <> 3
    or (evaluation->>'available_projects')::integer <> 0
    or (evaluation->>'over_capacity_projects')::integer <> 1
  then raise exception 'CAPACITY_EXCEEDED_EVALUATION_INVALID'; end if;
  if (select count(*) from public.leads) <> 1
    or (evaluation->>'committed_projects')::integer <> 3
  then raise exception 'LEAD_WAS_CONFUSED_WITH_OPERATIONAL_CAPACITY'; end if;
  if not exists (
    select 1 from public.tasks where task_type = 'CAPACITY_EXCEEDED'
      and normalized_objective = 'CAPACITY_MONTH:2027-01-01' and status = 'OPEN'
  ) or not exists (
    select 1 from public.event_outbox where event_type = 'operational_capacity.exceeded'
      and payload_json->>'over_capacity_projects' = '1'
  ) then raise exception 'CAPACITY_EXCEEDED_ALERT_MISSING'; end if;
  if exists (
    select 1 from public.tasks where task_type in ('CAPACITY_WARNING', 'CAPACITY_FULL')
      and normalized_objective = 'CAPACITY_MONTH:2027-01-01' and status = 'OPEN'
  ) then raise exception 'STALE_CAPACITY_ALERT_TASK_REMAINED_OPEN'; end if;

  tasks_before := (select count(*) from public.tasks);
  outbox_before := (select count(*) from public.event_outbox);
  audit_before := (select count(*) from public.audit_log);
  perform app.evaluate_monthly_operational_capacity(
    '11111111-1111-4111-8111-111111111111', '2027-01-01'
  );
  if (select count(*) from public.tasks) <> tasks_before
    or (select count(*) from public.event_outbox) <> outbox_before
    or (select count(*) from public.audit_log) <> audit_before
  then raise exception 'READ_ONLY_CAPACITY_EVALUATION_MUTATED_STATE'; end if;

  if exists (
    select 1 from public.operational_capacity_configs where idempotency_key !~ '^[a-f0-9]{64}$'
  ) or exists (
    select 1 from public.opportunity_capacity_schedules where idempotency_key !~ '^[a-f0-9]{64}$'
  ) or exists (
    select 1 from public.operational_capacity_commands where idempotency_key !~ '^[a-f0-9]{64}$'
  ) then raise exception 'CAPACITY_IDEMPOTENCY_KEY_NOT_HASHED'; end if;
  if exists (
    select 1 from public.event_outbox
    where event_type like 'operational_capacity.%'
      and payload_json::text ~* '(synthetic january|@|source_reference)'
  ) then raise exception 'CAPACITY_OUTBOX_EXPOSED_SOURCE_OR_CONTACT_DATA'; end if;
end;
$$;

select app.schedule_closed_won_capacity(
  '11111111-1111-4111-8111-111111111111',
  '41111111-1111-4111-8111-111111111113',
  '2027-02-17', 'Synthetic reschedule to February', 'capacity-reschedule-feb-three'
);

do $$
declare
  january jsonb;
  february jsonb;
  old_replay jsonb;
begin
  january := app.evaluate_monthly_operational_capacity(
    '11111111-1111-4111-8111-111111111111', '2027-01-01'
  );
  february := app.evaluate_monthly_operational_capacity(
    '11111111-1111-4111-8111-111111111111', '2027-02-01'
  );
  if january->>'state' <> 'FULL' or (january->>'committed_projects')::integer <> 2
    or february->>'state' <> 'FULL' or (february->>'committed_projects')::integer <> 3
    or (february->>'over_capacity_projects')::integer <> 1
  then raise exception 'CAPACITY_RESCHEDULE_RECONCILIATION_INVALID'; end if;
  old_replay := app.schedule_closed_won_capacity(
    '11111111-1111-4111-8111-111111111111',
    '41111111-1111-4111-8111-111111111113',
    '2027-01-17', 'Synthetic January project three', 'capacity-schedule-jan-three'
  );
  if old_replay->>'status' <> 'DUPLICATE' then
    raise exception 'SUPERSEDED_COMMAND_REPLAY_NOT_IDEMPOTENT';
  end if;
  if (select capacity_month from public.opportunity_capacity_schedules
      where opportunity_id = '41111111-1111-4111-8111-111111111113') <> '2027-02-01'
  then raise exception 'SUPERSEDED_REPLAY_MOVED_CAPACITY_BACK'; end if;

  begin
    insert into public.operational_capacity_configs (
      organization_id, version, monthly_limit, warning_at, effective_from_month,
      source_reference, idempotency_key, created_by
    ) values (
      '11111111-1111-4111-8111-111111111111', 99, 2, 1, '2027-01-01',
      'Forbidden direct insert', repeat('9', 64), '81111111-1111-4111-8111-111111111111'
    );
    raise exception 'EXPECTED_DIRECT_CONFIG_DML_REJECTION';
  exception when insufficient_privilege then null; end;
  begin
    update public.opportunity_capacity_schedules set execution_date = '2027-03-01';
    raise exception 'EXPECTED_DIRECT_SCHEDULE_DML_REJECTION';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.operational_capacity_commands;
    raise exception 'EXPECTED_DIRECT_COMMAND_DML_REJECTION';
  exception when insufficient_privilege then null; end;
end;
$$;

reset role;
reset request.jwt.claim.aal;
reset request.jwt.claim.sub;

set request.jwt.claim.sub = '81111111-1111-4111-8111-111111111111';
set request.jwt.claim.aal = 'aal1';
set role authenticated;
do $$
begin
  begin
    perform app.evaluate_monthly_operational_capacity(
      '11111111-1111-4111-8111-111111111111', '2027-01-01'
    );
    raise exception 'EXPECTED_AAL1_CAPACITY_READ_REJECTION';
  exception when others then
    if sqlerrm <> 'CAPACITY_READ_AAL2_MEMBERSHIP_REQUIRED' then raise; end if;
  end;
  begin
    perform app.schedule_closed_won_capacity(
      '11111111-1111-4111-8111-111111111111',
      '41111111-1111-4111-8111-111111111114',
      '2027-03-01', 'Synthetic AAL1 rejection', 'capacity-aal1-reject'
    );
    raise exception 'EXPECTED_AAL1_CAPACITY_WRITE_REJECTION';
  exception when others then
    if sqlerrm <> 'CAPACITY_OPERATOR_AAL2_REQUIRED' then raise; end if;
  end;
end;
$$;
reset role;
reset request.jwt.claim.aal;
reset request.jwt.claim.sub;

set request.jwt.claim.sub = '82222222-2222-4222-8222-222222222222';
set request.jwt.claim.aal = 'aal2';
set role authenticated;
select app.create_operational_capacity_config(
  '22222222-2222-4222-8222-222222222222', 2, 1, '2027-01-01',
  'CONFIRMED_CAPACITY_TWO_PROJECTS_SYNTHETIC_B', 'capacity-config-org-b-v1'
);
reset role;
reset request.jwt.claim.aal;
reset request.jwt.claim.sub;

set request.jwt.claim.sub = '81111111-1111-4111-8111-111111111111';
set request.jwt.claim.aal = 'aal2';
set role authenticated;
do $$
begin
  if (select count(*) from public.operational_capacity_configs) <> 2 then
    raise exception 'CAPACITY_CONFIG_RLS_TENANT_LEAK';
  end if;
  if exists (
    select 1 from public.operational_capacity_configs
    where organization_id <> '11111111-1111-4111-8111-111111111111'
  ) then raise exception 'CAPACITY_CONFIG_RLS_WRONG_TENANT_VISIBLE'; end if;
  begin
    perform app.evaluate_monthly_operational_capacity(
      '22222222-2222-4222-8222-222222222222', '2027-01-01'
    );
    raise exception 'EXPECTED_CROSS_TENANT_READ_REJECTION';
  exception when others then
    if sqlerrm <> 'CAPACITY_READ_AAL2_MEMBERSHIP_REQUIRED' then raise; end if;
  end;
  if has_table_privilege('authenticated', 'public.operational_capacity_configs', 'INSERT')
    or has_table_privilege('authenticated', 'public.operational_capacity_configs', 'UPDATE')
    or has_table_privilege('authenticated', 'public.operational_capacity_configs', 'DELETE')
    or has_table_privilege('authenticated', 'public.opportunity_capacity_schedules', 'INSERT')
    or has_table_privilege('authenticated', 'public.opportunity_capacity_schedules', 'UPDATE')
    or has_table_privilege('authenticated', 'public.opportunity_capacity_schedules', 'DELETE')
    or has_table_privilege('authenticated', 'public.operational_capacity_commands', 'INSERT')
    or has_table_privilege('authenticated', 'public.operational_capacity_commands', 'UPDATE')
    or has_table_privilege('authenticated', 'public.operational_capacity_commands', 'DELETE')
  then raise exception 'AUTHENTICATED_CAPACITY_DML_EXPOSED'; end if;
  if has_function_privilege(
    'authenticated', 'app.reconcile_operational_capacity_alert(uuid,date)', 'EXECUTE'
  ) then raise exception 'INTERNAL_CAPACITY_ALERT_RPC_EXPOSED'; end if;
end;
$$;
reset role;
reset request.jwt.claim.aal;
reset request.jwt.claim.sub;

do $$
begin
  begin
    update public.operational_capacity_configs set source_reference = 'Forbidden owner update'
    where organization_id = '11111111-1111-4111-8111-111111111111' and version = 1;
    raise exception 'EXPECTED_CONFIG_APPEND_ONLY_GUARD';
  exception when others then
    if sqlerrm <> 'OPERATIONAL_CAPACITY_CONFIG_APPEND_ONLY' then raise; end if;
  end;
  begin
    update public.operational_capacity_commands set change_reason = 'Forbidden owner update'
    where organization_id = '11111111-1111-4111-8111-111111111111';
    raise exception 'EXPECTED_COMMAND_APPEND_ONLY_GUARD';
  exception when others then
    if sqlerrm <> 'OPERATIONAL_CAPACITY_COMMAND_APPEND_ONLY' then raise; end if;
  end;
  begin
    delete from public.opportunity_capacity_schedules
    where organization_id = '11111111-1111-4111-8111-111111111111';
    raise exception 'EXPECTED_SCHEDULE_DELETE_GUARD';
  exception when others then
    if sqlerrm <> 'OPERATIONAL_CAPACITY_SCHEDULE_DELETE_FORBIDDEN' then raise; end if;
  end;
  if not exists (
    select 1 from public.audit_log where record_type = 'operational_capacity_configs'
  ) or not exists (
    select 1 from public.audit_log where record_type = 'opportunity_capacity_schedules'
  ) or not exists (
    select 1 from public.audit_log where record_type = 'operational_capacity_commands'
  ) then raise exception 'CAPACITY_AUDIT_TRAIL_MISSING'; end if;
end;
$$;

\echo 'MONTHLY_OPERATIONAL_CAPACITY_GATE_PASS'
