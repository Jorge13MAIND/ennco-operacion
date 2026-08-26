begin;

revoke all on function public.configure_single_teckel_operator(uuid,uuid,text,text) from public,authenticated,service_role;
drop function if exists public.configure_single_teckel_operator(uuid,uuid,text,text);
drop function if exists app.configure_single_teckel_operator(uuid,uuid,text,text);

select set_config('app.operations_rpc_write','on',true);
update public.operational_assignments
set status='INACTIVE',backup_user_id=null,coverage_mode='PRIMARY_BACKUP',updated_at=now()
where coverage_mode='SINGLE_TECKEL_OPERATOR';

alter table public.operational_assignments
  drop constraint if exists operational_assignments_active_coverage_check,
  drop constraint if exists operational_assignments_coverage_mode_check,
  drop column if exists coverage_mode;

do $$ begin
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.operational_assignments'::regclass
      and conname='operational_assignments_active_primary_backup_check'
  ) then
    alter table public.operational_assignments
      add constraint operational_assignments_active_primary_backup_check check (
        (status='ACTIVE') = (
          primary_user_id is not null and backup_user_id is not null
          and configured_by is not null and configured_at is not null
        )
      );
  end if;
end $$;

create or replace function app.operations_assignment_is_active(target_organization_id uuid)
returns boolean language sql stable security definer set search_path=public,app,pg_temp as $$
  select exists(
    select 1 from public.operational_assignments a
    join public.organization_users primary_member
      on primary_member.organization_id=a.organization_id and primary_member.user_id=a.primary_user_id and primary_member.active
      and primary_member.role in ('ennco_admin','ennco_operator','teckel_admin','teckel_operator')
    join public.organization_users backup_member
      on backup_member.organization_id=a.organization_id and backup_member.user_id=a.backup_user_id and backup_member.active
      and backup_member.role in ('ennco_admin','ennco_operator','teckel_admin','teckel_operator')
    where a.organization_id=target_organization_id and a.status='ACTIVE'
  )
$$;

create or replace function app.assign_operational_task(
  target_organization_id uuid,target_task_id uuid,target_owner_user_id uuid,target_backup_user_id uuid,
  target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; response jsonb;
begin
  perform app.operations_assert_operator(target_organization_id);
  if target_backup_user_id is null or target_owner_user_id is not distinct from target_backup_user_id then
    raise exception 'TASK_OWNER_BACKUP_MUST_DIFFER';
  end if;
  if (select count(*) from public.organization_users where organization_id=target_organization_id
      and user_id in (target_owner_user_id,target_backup_user_id) and active
      and role in ('ennco_admin','ennco_operator','teckel_admin','teckel_operator'))<>2
  then raise exception 'TASK_OPERATIONAL_ASSIGNEES_REQUIRED'; end if;
  replay:=app.operations_command_begin(target_organization_id,'assign_operational_task',target_idempotency_key,
    jsonb_build_object('task_id',target_task_id,'owner_user_id',target_owner_user_id,'backup_user_id',target_backup_user_id));
  if replay is not null then return replay; end if;
  perform set_config('app.operations_rpc_write','on',true);
  update public.tasks set owner_user_id=target_owner_user_id,backup_user_id=target_backup_user_id
  where organization_id=target_organization_id and id=target_task_id and status='OPEN';
  if not found then raise exception 'OPEN_TASK_NOT_FOUND'; end if;
  update public.operational_sla_cases set owner_user_id=target_owner_user_id,backup_user_id=target_backup_user_id,updated_at=now()
  where organization_id=target_organization_id and subject_type='task' and subject_id=target_task_id and status in ('OPEN','BREACHED');
  response:=jsonb_build_object(
    'status','ASSIGNED','task_id',target_task_id,'owner_user_id',target_owner_user_id,
    'backup_user_id',target_backup_user_id,
    'correlation_id',coalesce((select correlation_id from public.tasks where id=target_task_id),gen_random_uuid()),
    'replayed',false
  );
  return app.operations_command_finish(target_organization_id,'assign_operational_task',target_idempotency_key,response);
end $$;

revoke all on function app.assign_operational_task(uuid,uuid,uuid,uuid,text) from public,authenticated;

commit;
