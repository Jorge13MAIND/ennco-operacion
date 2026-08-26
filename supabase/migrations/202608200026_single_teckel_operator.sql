begin;

alter table public.operational_assignments
  add column if not exists coverage_mode text not null default 'PRIMARY_BACKUP';

do $$
declare constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid='public.operational_assignments'::regclass
      and contype='c'
      and pg_get_constraintdef(oid) like '%status%ACTIVE%'
      and pg_get_constraintdef(oid) like '%primary_user_id%'
      and pg_get_constraintdef(oid) like '%backup_user_id%'
  loop
    execute format('alter table public.operational_assignments drop constraint %I',constraint_name);
  end loop;
end $$;

do $$ begin
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.operational_assignments'::regclass
      and conname='operational_assignments_coverage_mode_check'
  ) then
    alter table public.operational_assignments
      add constraint operational_assignments_coverage_mode_check
      check (coverage_mode in ('PRIMARY_BACKUP','SINGLE_TECKEL_OPERATOR'));
  end if;
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.operational_assignments'::regclass
      and conname='operational_assignments_active_coverage_check'
  ) then
    alter table public.operational_assignments
      add constraint operational_assignments_active_coverage_check check (
        (status='ACTIVE') = (
          primary_user_id is not null
          and configured_by is not null
          and configured_at is not null
          and (
            (coverage_mode='PRIMARY_BACKUP' and backup_user_id is not null and primary_user_id is distinct from backup_user_id)
            or (coverage_mode='SINGLE_TECKEL_OPERATOR' and backup_user_id is null)
          )
        )
      );
  end if;
end $$;

create or replace function app.operations_assignment_is_active(target_organization_id uuid)
returns boolean language sql stable security definer set search_path=public,app,pg_temp as $$
  select exists(
    select 1
    from public.operational_assignments a
    join public.organization_users primary_member
      on primary_member.organization_id=a.organization_id
      and primary_member.user_id=a.primary_user_id
      and primary_member.active
      and primary_member.role in ('ennco_admin','ennco_operator','teckel_admin','teckel_operator')
    where a.organization_id=target_organization_id
      and a.status='ACTIVE'
      and (
        (
          a.coverage_mode='SINGLE_TECKEL_OPERATOR'
          and a.backup_user_id is null
          and primary_member.role in ('teckel_admin','teckel_operator')
        )
        or (
          a.coverage_mode='PRIMARY_BACKUP'
          and a.backup_user_id is not null
          and exists(
            select 1 from public.organization_users backup_member
            where backup_member.organization_id=a.organization_id
              and backup_member.user_id=a.backup_user_id
              and backup_member.active
              and backup_member.role in ('ennco_admin','ennco_operator','teckel_admin','teckel_operator')
          )
        )
      )
  )
$$;

create or replace function app.configure_single_teckel_operator(
  target_organization_id uuid,
  target_primary_user_id uuid,
  target_source_reference text,
  target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; response jsonb;
begin
  perform app.operations_assert_operator(target_organization_id,true);
  if nullif(btrim(target_source_reference),'') is null or char_length(target_source_reference)>500 then
    raise exception 'OPERATIONS_ASSIGNMENT_SOURCE_INVALID';
  end if;
  if not exists(
    select 1 from public.organization_users
    where organization_id=target_organization_id
      and user_id=target_primary_user_id
      and active
      and role in ('teckel_admin','teckel_operator')
  ) then
    raise exception 'SINGLE_TECKEL_OPERATOR_REQUIRED';
  end if;
  replay:=app.operations_command_begin(
    target_organization_id,'configure_single_teckel_operator',target_idempotency_key,
    jsonb_build_object(
      'primary_user_id',target_primary_user_id,
      'coverage_mode','SINGLE_TECKEL_OPERATOR',
      'source_reference',target_source_reference
    )
  );
  if replay is not null then return replay; end if;
  perform pg_advisory_xact_lock(hashtextextended('operations-assignment:'||target_organization_id::text,0));
  perform set_config('app.operations_rpc_write','on',true);
  insert into public.operational_assignments(
    organization_id,primary_user_id,backup_user_id,status,source_reference,configured_by,configured_at,updated_at,coverage_mode
  ) values (
    target_organization_id,target_primary_user_id,null,'ACTIVE',target_source_reference,auth.uid(),now(),now(),'SINGLE_TECKEL_OPERATOR'
  ) on conflict (organization_id) do update set
    primary_user_id=excluded.primary_user_id,
    backup_user_id=null,
    status='ACTIVE',
    source_reference=excluded.source_reference,
    configured_by=excluded.configured_by,
    configured_at=excluded.configured_at,
    updated_at=excluded.updated_at,
    coverage_mode='SINGLE_TECKEL_OPERATOR';
  response:=jsonb_build_object(
    'status','CONFIGURED',
    'organization_id',target_organization_id,
    'primary_user_id',target_primary_user_id,
    'backup_user_id',null,
    'coverage_mode','SINGLE_TECKEL_OPERATOR',
    'replayed',false
  );
  return app.operations_command_finish(
    target_organization_id,'configure_single_teckel_operator',target_idempotency_key,response
  );
end $$;

create or replace function app.assign_operational_task(
  target_organization_id uuid,target_task_id uuid,target_owner_user_id uuid,target_backup_user_id uuid,
  target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; response jsonb; assignment public.operational_assignments%rowtype;
begin
  perform app.operations_assert_operator(target_organization_id);
  select * into assignment
  from public.operational_assignments
  where organization_id=target_organization_id and status='ACTIVE'
  for update;
  if not found or not app.operations_assignment_is_active(target_organization_id) then
    raise exception 'OPERATOR_ASSIGNMENT_UNKNOWN';
  end if;
  if assignment.coverage_mode='SINGLE_TECKEL_OPERATOR' then
    if target_backup_user_id is not null then raise exception 'SINGLE_OPERATOR_BACKUP_NOT_ALLOWED'; end if;
    if target_owner_user_id is distinct from assignment.primary_user_id then raise exception 'SINGLE_OPERATOR_OWNER_MISMATCH'; end if;
  else
    if target_backup_user_id is null or target_owner_user_id is not distinct from target_backup_user_id then
      raise exception 'TASK_OWNER_BACKUP_MUST_DIFFER';
    end if;
    if (select count(*) from public.organization_users where organization_id=target_organization_id
        and user_id in (target_owner_user_id,target_backup_user_id) and active
        and role in ('ennco_admin','ennco_operator','teckel_admin','teckel_operator'))<>2
    then raise exception 'TASK_OPERATIONAL_ASSIGNEES_REQUIRED'; end if;
  end if;
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

create or replace function app.complete_operational_task_v2(
  target_organization_id uuid,target_task_id uuid,target_completion_evidence_sha256 text,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; task_record public.tasks%rowtype; response jsonb;
begin
  perform app.operations_assert_operator(target_organization_id);
  if target_completion_evidence_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'TASK_COMPLETION_EVIDENCE_INVALID'; end if;
  replay:=app.operations_command_begin(target_organization_id,'complete_operational_task_v2',target_idempotency_key,
    jsonb_build_object('task_id',target_task_id,'evidence_sha256',target_completion_evidence_sha256));
  if replay is not null then return replay; end if;
  select * into task_record from public.tasks where organization_id=target_organization_id and id=target_task_id for update;
  if not found or task_record.status<>'OPEN' then raise exception 'OPEN_TASK_NOT_FOUND'; end if;
  if task_record.owner_user_id is null then raise exception 'TASK_OWNER_REQUIRED'; end if;
  if auth.uid() is distinct from task_record.owner_user_id
    and (task_record.backup_user_id is null or auth.uid() is distinct from task_record.backup_user_id)
    and not app.has_role(target_organization_id,array['ennco_admin'::public.user_role,'teckel_admin'::public.user_role])
  then raise exception 'TASK_ASSIGNEE_REQUIRED'; end if;
  perform set_config('app.operations_rpc_write','on',true);
  update public.tasks set status='DONE',completed_at=now(),completed_by=auth.uid(),completion_evidence_sha256=target_completion_evidence_sha256 where id=target_task_id;
  update public.operational_sla_cases set status=case when status='BREACHED' or due_at<clock_timestamp() then 'BREACHED' else 'MET' end,
    completed_at=now(),completion_evidence_sha256=target_completion_evidence_sha256,
    breach_recorded_at=case when status='BREACHED' or due_at<clock_timestamp() then coalesce(breach_recorded_at,now()) else null end,updated_at=now()
  where organization_id=target_organization_id and subject_type='task' and subject_id=target_task_id and status in ('OPEN','BREACHED');
  response:=jsonb_build_object('status','DONE','task_id',target_task_id,'correlation_id',coalesce(task_record.correlation_id,gen_random_uuid()),'replayed',false);
  return app.operations_command_finish(target_organization_id,'complete_operational_task_v2',target_idempotency_key,response);
end $$;

create or replace function public.configure_single_teckel_operator(uuid,uuid,text,text) returns jsonb
language sql security definer set search_path=app,public,pg_temp as $$
  select app.configure_single_teckel_operator($1,$2,$3,$4)
$$;

revoke all on function app.configure_single_teckel_operator(uuid,uuid,text,text) from public,authenticated,service_role;
revoke all on function public.configure_single_teckel_operator(uuid,uuid,text,text) from public,service_role;
grant execute on function public.configure_single_teckel_operator(uuid,uuid,text,text) to authenticated;

commit;
