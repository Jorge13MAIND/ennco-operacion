-- M033: estas aserciones prueban el rechazo de la sesión de un solo factor.
-- Se fija la política en modo estricto para que sigan probando exactamente lo
-- mismo que antes de DEC-106. Los dos modos se prueban en el gate 034.
do $m033$ begin
  if to_regclass('app.auth_policy') is not null then
    update app.auth_policy set require_mfa = true;
  end if;
end $m033$;

\set ON_ERROR_STOP on

insert into public.organizations(id,slug,legal_name) values
  ('26000000-0000-4000-8000-000000000001','m026-a','M026 Synthetic A'),
  ('26000000-0000-4000-8000-000000000002','m026-b','M026 Synthetic B');
insert into public.organization_users(organization_id,user_id,role,active) values
  ('26000000-0000-4000-8000-000000000001','26100000-0000-4000-8000-000000000001','ennco_admin',true),
  ('26000000-0000-4000-8000-000000000001','26100000-0000-4000-8000-000000000002','teckel_operator',true),
  ('26000000-0000-4000-8000-000000000001','26100000-0000-4000-8000-000000000003','ennco_operator',true),
  ('26000000-0000-4000-8000-000000000001','26100000-0000-4000-8000-000000000004','auditor_readonly',true),
  ('26000000-0000-4000-8000-000000000002','26200000-0000-4000-8000-000000000001','teckel_operator',true);

set request.jwt.claim.sub='26100000-0000-4000-8000-000000000001';
set request.jwt.claim.aal='aal1';
set role authenticated;
do $$ begin
  begin
    perform public.configure_single_teckel_operator(
      '26000000-0000-4000-8000-000000000001','26100000-0000-4000-8000-000000000002',
      'JORGE_CONFIRMED_2026_08_20',repeat('1',64)
    );
    raise exception 'M026_AAL1_CONFIGURATION_BYPASS';
  exception when others then
    if sqlerrm='M026_AAL1_CONFIGURATION_BYPASS' then raise; end if;
  end;
end $$;

set request.jwt.claim.aal='aal2';
do $$ declare configured jsonb; replay jsonb; begin
  configured:=public.configure_single_teckel_operator(
    '26000000-0000-4000-8000-000000000001','26100000-0000-4000-8000-000000000002',
    'JORGE_CONFIRMED_2026_08_20',repeat('1',64)
  );
  if configured->>'status'<>'CONFIGURED'
    or configured->>'coverage_mode'<>'SINGLE_TECKEL_OPERATOR'
    or configured->'backup_user_id'<>'null'::jsonb
    or configured->>'replayed'<>'false'
  then raise exception 'M026_CONFIGURATION_RESULT_INVALID:%',configured; end if;
  replay:=public.configure_single_teckel_operator(
    '26000000-0000-4000-8000-000000000001','26100000-0000-4000-8000-000000000002',
    'JORGE_CONFIRMED_2026_08_20',repeat('1',64)
  );
  if replay->>'replayed'<>'true' then raise exception 'M026_CONFIGURATION_REPLAY_INVALID'; end if;

  begin
    perform public.configure_single_teckel_operator(
      '26000000-0000-4000-8000-000000000001','26100000-0000-4000-8000-000000000003',
      'NON_TECKEL_MUST_FAIL',repeat('2',64)
    );
    raise exception 'M026_NON_TECKEL_OWNER_BYPASS';
  exception when others then
    if sqlerrm='M026_NON_TECKEL_OWNER_BYPASS' then raise; end if;
  end;
  begin
    perform public.configure_single_teckel_operator(
      '26000000-0000-4000-8000-000000000001','26200000-0000-4000-8000-000000000001',
      'CROSS_TENANT_MUST_FAIL',repeat('3',64)
    );
    raise exception 'M026_CROSS_TENANT_OWNER_BYPASS';
  exception when others then
    if sqlerrm='M026_CROSS_TENANT_OWNER_BYPASS' then raise; end if;
  end;
end $$;
reset role;

do $$ begin
  if not app.operations_assignment_is_active('26000000-0000-4000-8000-000000000001')
    or not exists(
      select 1 from public.operational_assignments
      where organization_id='26000000-0000-4000-8000-000000000001'
        and primary_user_id='26100000-0000-4000-8000-000000000002'
        and backup_user_id is null and status='ACTIVE' and coverage_mode='SINGLE_TECKEL_OPERATOR'
    )
  then raise exception 'M026_SINGLE_ASSIGNMENT_NOT_ACTIVE'; end if;
end $$;

insert into public.tasks(id,organization_id,task_type,normalized_objective,due_at,correlation_id)
values(
  '26300000-0000-4000-8000-000000000001','26000000-0000-4000-8000-000000000001',
  'SINGLE_OPERATOR_GATE','synthetic single operator task',now()+interval '4 hours','26310000-0000-4000-8000-000000000001'
);

set request.jwt.claim.sub='26100000-0000-4000-8000-000000000002';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ declare assigned jsonb; completed jsonb; begin
  assigned:=public.assign_operational_task(
    '26000000-0000-4000-8000-000000000001','26300000-0000-4000-8000-000000000001',
    '26100000-0000-4000-8000-000000000002',null,repeat('4',64)
  );
  if assigned->>'status'<>'ASSIGNED' or assigned->'backup_user_id'<>'null'::jsonb
  then raise exception 'M026_SINGLE_TASK_ASSIGNMENT_INVALID:%',assigned; end if;
  begin
    perform public.assign_operational_task(
      '26000000-0000-4000-8000-000000000001','26300000-0000-4000-8000-000000000001',
      '26100000-0000-4000-8000-000000000002','26100000-0000-4000-8000-000000000001',repeat('5',64)
    );
    raise exception 'M026_SINGLE_TASK_BACKUP_BYPASS';
  exception when others then
    if sqlerrm='M026_SINGLE_TASK_BACKUP_BYPASS' then raise; end if;
  end;
  completed:=public.complete_operational_task_v2(
    '26000000-0000-4000-8000-000000000001','26300000-0000-4000-8000-000000000001',repeat('a',64),repeat('6',64)
  );
  if completed->>'status'<>'DONE' then raise exception 'M026_SINGLE_TASK_COMPLETION_INVALID'; end if;
end $$;
reset role;

insert into public.tasks(id,organization_id,task_type,normalized_objective,due_at,owner_user_id,correlation_id)
values(
  '26300000-0000-4000-8000-000000000002','26000000-0000-4000-8000-000000000001',
  'SINGLE_OPERATOR_AUTHZ','synthetic authorization task',now()+interval '4 hours',
  '26100000-0000-4000-8000-000000000002','26310000-0000-4000-8000-000000000002'
);
set request.jwt.claim.sub='26100000-0000-4000-8000-000000000003';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ begin
  begin
    perform public.complete_operational_task_v2(
      '26000000-0000-4000-8000-000000000001','26300000-0000-4000-8000-000000000002',repeat('b',64),repeat('7',64)
    );
    raise exception 'M026_NULL_BACKUP_AUTHORIZATION_BYPASS';
  exception when others then
    if sqlerrm='M026_NULL_BACKUP_AUTHORIZATION_BYPASS' then raise; end if;
  end;
  begin
    update public.operational_assignments set status='INACTIVE'
    where organization_id='26000000-0000-4000-8000-000000000001';
    raise exception 'M026_DIRECT_ASSIGNMENT_WRITE_BYPASS';
  exception when others then
    if sqlerrm='M026_DIRECT_ASSIGNMENT_WRITE_BYPASS' then raise; end if;
  end;
  if has_function_privilege('service_role','public.configure_single_teckel_operator(uuid,uuid,text,text)','EXECUTE')
    or has_function_privilege('authenticated','app.configure_single_teckel_operator(uuid,uuid,text,text)','EXECUTE')
  then raise exception 'M026_PRIVILEGE_SURFACE_OPEN'; end if;
end $$;
reset role;

select 'SINGLE_TECKEL_OPERATOR_FORWARD_PASS' as result;
