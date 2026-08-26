\set ON_ERROR_STOP on

do $$ begin
  if to_regprocedure('public.configure_single_teckel_operator(uuid,uuid,text,text)') is not null
    or exists(
      select 1 from information_schema.columns
      where table_schema='public' and table_name='operational_assignments' and column_name='coverage_mode'
    )
    or app.operations_assignment_is_active('26000000-0000-4000-8000-000000000001')
    or not exists(
      select 1 from public.operational_assignments
      where organization_id='26000000-0000-4000-8000-000000000001' and status='INACTIVE' and backup_user_id is null
    )
  then raise exception 'M026_ROLLBACK_NOT_FAIL_CLOSED'; end if;
end $$;

set request.jwt.claim.sub='26100000-0000-4000-8000-000000000002';
set request.jwt.claim.aal='aal2';
set role authenticated;
do $$ begin
  begin
    perform public.assign_operational_task(
      '26000000-0000-4000-8000-000000000001','26300000-0000-4000-8000-000000000002',
      '26100000-0000-4000-8000-000000000002',null,repeat('8',64)
    );
    raise exception 'M026_ROLLBACK_NULL_BACKUP_BYPASS';
  exception when others then
    if sqlerrm='M026_ROLLBACK_NULL_BACKUP_BYPASS' then raise; end if;
  end;
end $$;
reset role;

select 'SINGLE_TECKEL_OPERATOR_ROLLBACK_PASS' as result;
