begin;

drop trigger if exists messages_m022_rollback_fail_closed on public.messages;
drop function if exists app.m022_block_real_outbound();
do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'control_cadence_policy_versions',
    'control_cadence_policy_items',
    'control_cadence_occurrences',
    'control_cadence_human_sessions',
    'control_cadence_attendance',
    'control_cadence_evidence_items',
    'control_cadence_delivery_requirements',
    'control_cadence_breaches',
    'control_cadence_reconciliation_runs',
    'control_cadence_command_ledger'
  ] loop
    if to_regclass(format('public.%I', target_table)) is not null then
      execute format(
        'drop trigger if exists %I on public.%I',
        target_table || '_m022_rollback_fail_closed',
        target_table
      );
    end if;
  end loop;
end;
$$;
drop function if exists app.m022_rollback_fail_closed();

create table if not exists public.control_cadence_policy_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null check (version > 0),
  state text not null default 'DRAFT' check (state in ('DRAFT','ACTIVE','SUPERSEDED')),
  timezone_name text not null default 'America/Mexico_City' check (timezone_name='America/Mexico_City'),
  evidence_class public.evidence_class not null,
  heartbeat_stale_after_minutes integer check (heartbeat_stale_after_minutes between 1 and 1440),
  policy_sha256 text not null check (policy_sha256 ~ '^[a-f0-9]{64}$'),
  approval_evidence_sha256 text check (approval_evidence_sha256 is null or approval_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  activated_by uuid,
  activated_at timestamptz,
  superseded_at timestamptz,
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  foreign key (organization_id,created_by) references public.organization_users(organization_id,user_id),
  foreign key (organization_id,activated_by) references public.organization_users(organization_id,user_id),
  unique (organization_id,id),
  unique (organization_id,version),
  unique (organization_id,idempotency_key),
  check (
    (state='DRAFT' and activated_by is null and activated_at is null and superseded_at is null and approval_evidence_sha256 is null)
    or (state='ACTIVE' and activated_by is not null and activated_at is not null and superseded_at is null and approval_evidence_sha256 is not null)
    or (state='SUPERSEDED' and activated_by is not null and activated_at is not null and superseded_at is not null and approval_evidence_sha256 is not null)
  )
);
create unique index if not exists control_cadence_one_active_policy
  on public.control_cadence_policy_versions(organization_id) where state='ACTIVE';

create table if not exists public.control_cadence_policy_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_version_id uuid not null,
  cadence_code text not null check (cadence_code in (
    'CONTROL_ROOM_DAILY_UPDATE','INTERNAL_DAILY_REVIEW','STAGING_WEEKLY_DEMO',
    'ENNCO_TECKEL_WEEKLY_MEETING','EXECUTIVE_MONTHLY_REVIEW'
  )),
  frequency text not null check (frequency in ('DAILY','WEEKLY','MONTHLY')),
  execution_mode text not null check (execution_mode in ('AUTOMATED','HUMAN')),
  config_state text not null default 'UNKNOWN' check (config_state in ('UNKNOWN','VERIFIED')),
  owner_user_id uuid,
  local_time time,
  day_of_week smallint check (day_of_week between 1 and 7),
  day_of_month smallint check (day_of_month between 1 and 28),
  duration_minutes integer check (duration_minutes between 1 and 1440),
  due_offset_minutes integer check (due_offset_minutes between 1 and 1440),
  requires_checklist boolean,
  requires_delivery boolean,
  delivery_channels text[],
  config_evidence_sha256 text check (config_evidence_sha256 is null or config_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (organization_id,policy_version_id) references public.control_cadence_policy_versions(organization_id,id) on delete cascade,
  foreign key (organization_id,owner_user_id) references public.organization_users(organization_id,user_id),
  unique (organization_id,id),
  unique (organization_id,policy_version_id,cadence_code),
  check ((cadence_code in ('CONTROL_ROOM_DAILY_UPDATE','INTERNAL_DAILY_REVIEW'))=(frequency='DAILY')),
  check ((cadence_code in ('STAGING_WEEKLY_DEMO','ENNCO_TECKEL_WEEKLY_MEETING'))=(frequency='WEEKLY')),
  check ((cadence_code='EXECUTIVE_MONTHLY_REVIEW')=(frequency='MONTHLY')),
  check ((cadence_code='CONTROL_ROOM_DAILY_UPDATE')=(execution_mode='AUTOMATED')),
  check (cadence_code<>'ENNCO_TECKEL_WEEKLY_MEETING' or duration_minutes=45),
  check (
    (config_state='UNKNOWN' and config_evidence_sha256 is null)
    or (
      config_state='VERIFIED' and owner_user_id is not null and local_time is not null
      and due_offset_minutes is not null and duration_minutes is not null
      and requires_checklist is not null and requires_delivery is not null and delivery_channels is not null
      and ((requires_delivery and cardinality(delivery_channels)>0) or (not requires_delivery and cardinality(delivery_channels)=0))
      and config_evidence_sha256 is not null
      and (frequency<>'WEEKLY' or day_of_week is not null)
      and (frequency<>'MONTHLY' or day_of_month is not null)
      and (frequency='WEEKLY' or day_of_week is null)
      and (frequency='MONTHLY' or day_of_month is null)
    )
  )
);

create table if not exists public.control_cadence_occurrences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_version_id uuid not null,
  policy_item_id uuid not null,
  cadence_code text not null,
  window_key text not null,
  window_started_at timestamptz not null,
  window_ended_at timestamptz not null,
  scheduled_at timestamptz not null,
  due_at timestamptz not null,
  execution_status text not null default 'SCHEDULED' check (execution_status in ('SCHEDULED','OPEN','COMPLETED','UNKNOWN')),
  compliance_status text not null default 'PENDING' check (compliance_status in ('PENDING','MET','BREACHED','UNKNOWN')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id,policy_version_id) references public.control_cadence_policy_versions(organization_id,id),
  foreign key (organization_id,policy_item_id) references public.control_cadence_policy_items(organization_id,id),
  unique (organization_id,id),
  unique (organization_id,policy_item_id,window_key),
  check (window_ended_at>window_started_at and scheduled_at>=window_started_at and scheduled_at<window_ended_at and due_at>=scheduled_at),
  check ((execution_status='COMPLETED')=(completed_at is not null))
);

create table if not exists public.control_cadence_human_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  occurrence_id uuid not null,
  window_key text not null,
  session_status text not null check (session_status in ('PLANNED','HELD','CANCELLED','NO_SHOW')),
  started_at timestamptz,
  ended_at timestamptz,
  evidence_class public.evidence_class not null,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  recorded_by uuid not null,
  recorded_at timestamptz not null default now(),
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  foreign key (organization_id,occurrence_id) references public.control_cadence_occurrences(organization_id,id),
  foreign key (organization_id,recorded_by) references public.organization_users(organization_id,user_id),
  unique (organization_id,id),
  unique (organization_id,idempotency_key),
  check ((session_status='HELD')=(started_at is not null and ended_at is not null)),
  check (ended_at is null or ended_at>=started_at)
);

create table if not exists public.control_cadence_attendance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null,
  participant_user_id uuid not null,
  participant_side text not null check (participant_side in ('ENNCO','TECKEL')),
  attendance_status text not null check (attendance_status in ('ATTENDED','ABSENT')),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  recorded_by uuid not null,
  recorded_at timestamptz not null default now(),
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  foreign key (organization_id,session_id) references public.control_cadence_human_sessions(organization_id,id),
  foreign key (organization_id,participant_user_id) references public.organization_users(organization_id,user_id),
  foreign key (organization_id,recorded_by) references public.organization_users(organization_id,user_id),
  unique (organization_id,id),
  unique (organization_id,session_id,participant_user_id),
  unique (organization_id,idempotency_key)
);

create table if not exists public.control_cadence_evidence_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  occurrence_id uuid not null,
  window_key text not null,
  evidence_type text not null check (evidence_type in ('AUTOMATED_SNAPSHOT','CHECKLIST')),
  completeness text not null check (completeness in ('COMPLETE','PARTIAL','UNKNOWN')),
  evidence_class public.evidence_class not null,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  recorded_by uuid not null,
  recorded_at timestamptz not null default now(),
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  foreign key (organization_id,occurrence_id) references public.control_cadence_occurrences(organization_id,id),
  foreign key (organization_id,recorded_by) references public.organization_users(organization_id,user_id),
  unique (organization_id,id),
  unique (organization_id,occurrence_id,evidence_type,idempotency_key)
);

create table if not exists public.control_cadence_delivery_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  occurrence_id uuid not null,
  channel text not null check (channel ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  delivery_status text not null default 'PENDING' check (delivery_status in ('PENDING','DELIVERED','FAILED','UNKNOWN')),
  evidence_class public.evidence_class,
  evidence_sha256 text check (evidence_sha256 is null or evidence_sha256 ~ '^[a-f0-9]{64}$'),
  source_reference text,
  delivery_acknowledged boolean not null default false,
  delivered_at timestamptz,
  recorded_by uuid,
  idempotency_key text check (idempotency_key is null or idempotency_key ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id,occurrence_id) references public.control_cadence_occurrences(organization_id,id),
  foreign key (organization_id,recorded_by) references public.organization_users(organization_id,user_id),
  unique (organization_id,id),
  unique (organization_id,occurrence_id,channel),
  check ((delivery_status='DELIVERED')=(delivered_at is not null and evidence_class is not null and evidence_sha256 is not null and nullif(btrim(source_reference),'') is not null and delivery_acknowledged and recorded_by is not null and idempotency_key is not null))
);

create table if not exists public.control_cadence_breaches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  occurrence_id uuid not null,
  breach_kind text not null check (breach_kind in ('EXECUTION_OVERDUE','EVIDENCE_INCOMPLETE','ATTENDANCE_INCOMPLETE','DELIVERY_INCOMPLETE')),
  severity public.incident_severity not null check (severity in ('P0','P1')),
  status text not null default 'OPEN' check (status in ('OPEN','MITIGATED')),
  detected_at timestamptz not null,
  mitigated_at timestamptz,
  mitigated_by uuid,
  mitigation_evidence_sha256 text check (mitigation_evidence_sha256 is null or mitigation_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  incident_id uuid,
  outbox_event_id uuid,
  created_at timestamptz not null default now(),
  foreign key (organization_id,occurrence_id) references public.control_cadence_occurrences(organization_id,id),
  foreign key (organization_id,incident_id) references public.incidents(organization_id,id),
  foreign key (organization_id,outbox_event_id) references public.event_outbox(organization_id,id),
  foreign key (organization_id,mitigated_by) references public.organization_users(organization_id,user_id),
  unique (organization_id,id),
  unique (organization_id,occurrence_id,breach_kind),
  check ((status='MITIGATED')=(mitigated_at is not null and mitigated_by is not null and mitigation_evidence_sha256 is not null))
);

create table if not exists public.control_cadence_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_version_id uuid,
  evaluated_at timestamptz not null,
  heartbeat_at timestamptz not null,
  state text not null check (state in ('HEALTHY','DEGRADED','UNKNOWN')),
  reason_code text,
  input_sha256 text not null check (input_sha256 ~ '^[a-f0-9]{64}$'),
  output_sha256 text not null check (output_sha256 ~ '^[a-f0-9]{64}$'),
  occurrence_count integer not null check (occurrence_count>=0),
  breach_count integer not null check (breach_count>=0),
  incident_count integer not null check (incident_count>=0),
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (organization_id,policy_version_id) references public.control_cadence_policy_versions(organization_id,id),
  unique (organization_id,id),
  unique (organization_id,idempotency_key)
);

create table if not exists public.control_cadence_command_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  command_name text not null,
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  response_json jsonb,
  actor_user_id uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (organization_id,command_name,idempotency_key)
);

create or replace function app.control_cadence_internal_executor()
returns boolean language sql stable set search_path=pg_catalog,app as $$
  select current_user=(
    select pg_get_userbyid(p.proowner) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app' and p.proname='control_cadence_command_begin' limit 1
  ) and coalesce(current_setting('app.control_cadence_rpc_write',true),'off')='on'
$$;

create or replace function app.prevent_control_cadence_direct_write()
returns trigger language plpgsql set search_path=public,app,pg_temp as $$
begin
  if not app.control_cadence_internal_executor() then raise exception 'CONTROL_CADENCE_RPC_REQUIRED'; end if;
  return coalesce(new,old);
end $$;

create or replace function app.control_cadence_audit_snapshot(target_table text,target_row jsonb)
returns jsonb language sql immutable set search_path=pg_catalog as $$
  select case target_table
    when 'control_cadence_policy_versions' then target_row-'policy_sha256'-'approval_evidence_sha256'-'idempotency_key'
    when 'control_cadence_policy_items' then target_row-'config_evidence_sha256'
    when 'control_cadence_human_sessions' then target_row-'evidence_sha256'-'idempotency_key'
    when 'control_cadence_attendance' then target_row-'evidence_sha256'-'idempotency_key'
    when 'control_cadence_evidence_items' then target_row-'evidence_sha256'-'idempotency_key'
    when 'control_cadence_delivery_requirements' then target_row-'evidence_sha256'-'idempotency_key'
    when 'control_cadence_breaches' then target_row-'mitigation_evidence_sha256'
    when 'control_cadence_command_ledger' then target_row-'request_sha256'-'response_json'-'idempotency_key'
    else target_row-'idempotency_key'
  end
$$;

create or replace function app.capture_control_cadence_audit()
returns trigger language plpgsql security definer set search_path=public,app,pg_temp as $$
declare row_old jsonb; row_new jsonb; org_id uuid; rec_id uuid;
begin
  row_old:=case when tg_op in ('UPDATE','DELETE') then app.control_cadence_audit_snapshot(tg_table_name,to_jsonb(old)) end;
  row_new:=case when tg_op in ('INSERT','UPDATE') then app.control_cadence_audit_snapshot(tg_table_name,to_jsonb(new)) end;
  org_id:=coalesce((row_new->>'organization_id')::uuid,(row_old->>'organization_id')::uuid);
  rec_id:=coalesce((row_new->>'id')::uuid,(row_old->>'id')::uuid);
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,record_id,old_data,new_data)
  values(org_id,auth.uid(),lower(tg_op),tg_table_name,rec_id,row_old,row_new);
  return coalesce(new,old);
end $$;

create or replace function app.control_cadence_assert_operator(target_organization_id uuid,target_admin_only boolean default false)
returns void language plpgsql security definer set search_path=public,app,pg_temp as $$
begin
  if target_admin_only then
    if not app.has_role(target_organization_id,array['ennco_admin'::public.user_role,'teckel_admin'::public.user_role]) then raise exception 'CONTROL_CADENCE_ADMIN_REQUIRED'; end if;
  elsif not app.has_role(target_organization_id,array['ennco_admin'::public.user_role,'ennco_operator'::public.user_role,'teckel_admin'::public.user_role,'teckel_operator'::public.user_role]) then
    raise exception 'CONTROL_CADENCE_OPERATOR_REQUIRED';
  end if;
end $$;

create or replace function app.control_cadence_command_begin(target_organization_id uuid,target_command_name text,target_idempotency_key text,target_request jsonb)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare expected_sha text; existing public.control_cadence_command_ledger%rowtype;
begin
  if target_idempotency_key !~ '^[a-f0-9]{64}$' then raise exception 'CONTROL_CADENCE_IDEMPOTENCY_KEY_INVALID'; end if;
  expected_sha:=encode(digest(target_request::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':cadence-command:'||target_command_name||':'||target_idempotency_key,0));
  select * into existing from public.control_cadence_command_ledger where organization_id=target_organization_id and command_name=target_command_name and idempotency_key=target_idempotency_key for update;
  if found then
    if existing.request_sha256<>expected_sha then raise exception 'CONTROL_CADENCE_IDEMPOTENCY_REUSE_MISMATCH'; end if;
    if existing.response_json is null then raise exception 'CONTROL_CADENCE_COMMAND_INCOMPLETE'; end if;
    return existing.response_json||jsonb_build_object('replayed',true);
  end if;
  perform set_config('app.control_cadence_rpc_write','on',true);
  insert into public.control_cadence_command_ledger(organization_id,command_name,idempotency_key,request_sha256,actor_user_id)
  values(target_organization_id,target_command_name,target_idempotency_key,expected_sha,auth.uid());
  return null;
end $$;

create or replace function app.control_cadence_command_finish(target_organization_id uuid,target_command_name text,target_idempotency_key text,target_response jsonb)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
begin
  perform set_config('app.control_cadence_rpc_write','on',true);
  update public.control_cadence_command_ledger set response_json=target_response,completed_at=clock_timestamp()
  where organization_id=target_organization_id and command_name=target_command_name and idempotency_key=target_idempotency_key and response_json is null;
  if not found then raise exception 'CONTROL_CADENCE_COMMAND_FINISH_FAILED'; end if;
  return target_response||jsonb_build_object('replayed',false);
end $$;

create or replace function app.create_control_cadence_policy(
  target_organization_id uuid,target_version integer,target_evidence_class public.evidence_class,
  target_heartbeat_stale_after_minutes integer,target_items jsonb,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; policy_id uuid; policy_sha text; item jsonb; response jsonb; item_count integer:=0;
begin
  perform app.control_cadence_assert_operator(target_organization_id,true);
  if target_version<=0 or jsonb_typeof(target_items)<>'array' or target_heartbeat_stale_after_minutes not between 1 and 1440 then raise exception 'CONTROL_CADENCE_POLICY_INPUT_INVALID'; end if;
  replay:=app.control_cadence_command_begin(target_organization_id,'create_control_cadence_policy',target_idempotency_key,
    jsonb_build_object('version',target_version,'evidence_class',target_evidence_class,'heartbeat_stale_after_minutes',target_heartbeat_stale_after_minutes,'items',target_items));
  if replay is not null then return replay; end if;
  policy_sha:=encode(digest(jsonb_build_object('version',target_version,'timezone','America/Mexico_City','evidence_class',target_evidence_class,'heartbeat_stale_after_minutes',target_heartbeat_stale_after_minutes,'items',target_items)::text,'sha256'),'hex');
  perform set_config('app.control_cadence_rpc_write','on',true);
  insert into public.control_cadence_policy_versions(organization_id,version,evidence_class,heartbeat_stale_after_minutes,policy_sha256,created_by,idempotency_key)
  values(target_organization_id,target_version,target_evidence_class,target_heartbeat_stale_after_minutes,policy_sha,auth.uid(),target_idempotency_key)
  returning id into policy_id;
  for item in select value from jsonb_array_elements(target_items) loop
    item_count:=item_count+1;
    if (item-'code'-'config_state'-'owner_user_id'-'local_time'-'day_of_week'-'day_of_month'-'duration_minutes'-'due_offset_minutes'-'requires_checklist'-'requires_delivery'-'delivery_channels'-'config_evidence_sha256')<>'{}'::jsonb then raise exception 'CONTROL_CADENCE_POLICY_ITEM_SCHEMA_INVALID'; end if;
    if item->>'code' not in ('CONTROL_ROOM_DAILY_UPDATE','INTERNAL_DAILY_REVIEW','STAGING_WEEKLY_DEMO','ENNCO_TECKEL_WEEKLY_MEETING','EXECUTIVE_MONTHLY_REVIEW') then raise exception 'CONTROL_CADENCE_CODE_INVALID'; end if;
    insert into public.control_cadence_policy_items(
      organization_id,policy_version_id,cadence_code,frequency,execution_mode,config_state,owner_user_id,local_time,day_of_week,day_of_month,
      duration_minutes,due_offset_minutes,requires_checklist,requires_delivery,delivery_channels,config_evidence_sha256
    ) values (
      target_organization_id,policy_id,item->>'code',
      case when item->>'code' in ('CONTROL_ROOM_DAILY_UPDATE','INTERNAL_DAILY_REVIEW') then 'DAILY' when item->>'code' in ('STAGING_WEEKLY_DEMO','ENNCO_TECKEL_WEEKLY_MEETING') then 'WEEKLY' else 'MONTHLY' end,
      case when item->>'code'='CONTROL_ROOM_DAILY_UPDATE' then 'AUTOMATED' else 'HUMAN' end,
      coalesce(item->>'config_state','UNKNOWN'),nullif(item->>'owner_user_id','')::uuid,nullif(item->>'local_time','')::time,
      nullif(item->>'day_of_week','')::smallint,nullif(item->>'day_of_month','')::smallint,nullif(item->>'duration_minutes','')::integer,
      nullif(item->>'due_offset_minutes','')::integer,case when item ? 'requires_checklist' then (item->>'requires_checklist')::boolean end,
      case when item ? 'requires_delivery' then (item->>'requires_delivery')::boolean end,
      case when item ? 'delivery_channels' then array(select jsonb_array_elements_text(item->'delivery_channels') order by 1) end,
      nullif(item->>'config_evidence_sha256','')
    );
  end loop;
  response:=jsonb_build_object('status','DRAFT','policy_version_id',policy_id,'version',target_version,'item_count',item_count,'policy_sha256',policy_sha,'correlation_id',gen_random_uuid());
  return app.control_cadence_command_finish(target_organization_id,'create_control_cadence_policy',target_idempotency_key,response);
end $$;

create or replace function app.activate_control_cadence_policy(target_organization_id uuid,target_policy_version_id uuid,target_approval_evidence_sha256 text,target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; policy_record public.control_cadence_policy_versions%rowtype; response jsonb; canonical_count integer;
begin
  perform app.control_cadence_assert_operator(target_organization_id,true);
  if target_approval_evidence_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'CONTROL_CADENCE_APPROVAL_EVIDENCE_INVALID'; end if;
  replay:=app.control_cadence_command_begin(target_organization_id,'activate_control_cadence_policy',target_idempotency_key,
    jsonb_build_object('policy_version_id',target_policy_version_id,'approval_evidence_sha256',target_approval_evidence_sha256));
  if replay is not null then return replay; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':cadence-policy-activation',0));
  select * into policy_record from public.control_cadence_policy_versions where organization_id=target_organization_id and id=target_policy_version_id for update;
  if not found or policy_record.state<>'DRAFT' then raise exception 'CONTROL_CADENCE_DRAFT_POLICY_NOT_FOUND'; end if;
  select count(*) into canonical_count from public.control_cadence_policy_items i
  where i.organization_id=target_organization_id and i.policy_version_id=target_policy_version_id and i.config_state='VERIFIED';
  if canonical_count<>5 or (select count(distinct cadence_code) from public.control_cadence_policy_items where organization_id=target_organization_id and policy_version_id=target_policy_version_id)<>5 then
    raise exception 'CONTROL_CADENCE_POLICY_INCOMPLETE';
  end if;
  if exists(
    select 1 from public.control_cadence_policy_items i left join public.organization_users ou on ou.organization_id=i.organization_id and ou.user_id=i.owner_user_id
    where i.organization_id=target_organization_id and i.policy_version_id=target_policy_version_id
      and (ou.user_id is null or not ou.active or ou.role not in ('ennco_admin','ennco_operator','teckel_admin','teckel_operator'))
  ) then raise exception 'CONTROL_CADENCE_OWNER_INVALID'; end if;
  if exists(select 1 from public.control_cadence_policy_items where organization_id=target_organization_id and policy_version_id=target_policy_version_id and cadence_code='ENNCO_TECKEL_WEEKLY_MEETING' and duration_minutes<>45) then
    raise exception 'CONTROL_CADENCE_WEEKLY_MEETING_DURATION_INVALID';
  end if;
  perform set_config('app.control_cadence_rpc_write','on',true);
  update public.control_cadence_policy_versions set state='SUPERSEDED',superseded_at=clock_timestamp()
  where organization_id=target_organization_id and state='ACTIVE';
  update public.control_cadence_policy_versions set state='ACTIVE',activated_by=auth.uid(),activated_at=clock_timestamp(),approval_evidence_sha256=target_approval_evidence_sha256
  where organization_id=target_organization_id and id=target_policy_version_id;
  response:=jsonb_build_object('status','ACTIVE','policy_version_id',target_policy_version_id,'version',policy_record.version,'cadence_count',5,'correlation_id',gen_random_uuid());
  return app.control_cadence_command_finish(target_organization_id,'activate_control_cadence_policy',target_idempotency_key,response);
end $$;

create or replace function app.control_cadence_window(target_cadence_code text,target_day_of_week integer,target_day_of_month integer,target_local_time time,target_due_offset_minutes integer,target_evaluated_at timestamptz)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare local_at timestamp; start_date date; end_date date; schedule_date date; window_key text;
begin
  local_at:=target_evaluated_at at time zone 'America/Mexico_City';
  if target_cadence_code in ('CONTROL_ROOM_DAILY_UPDATE','INTERNAL_DAILY_REVIEW') then
    start_date:=local_at::date; end_date:=start_date+1; schedule_date:=start_date; window_key:=to_char(start_date,'YYYY-MM-DD');
  elsif target_cadence_code in ('STAGING_WEEKLY_DEMO','ENNCO_TECKEL_WEEKLY_MEETING') then
    start_date:=local_at::date-(extract(isodow from local_at)::integer-1); end_date:=start_date+7; schedule_date:=start_date+(target_day_of_week-1); window_key:=to_char(start_date,'IYYY-"W"IW');
  else
    start_date:=date_trunc('month',local_at)::date; end_date:=(start_date+interval '1 month')::date; schedule_date:=start_date+(target_day_of_month-1); window_key:=to_char(start_date,'YYYY-MM');
  end if;
  return jsonb_build_object('window_key',window_key,'window_started_at',start_date at time zone 'America/Mexico_City','window_ended_at',end_date at time zone 'America/Mexico_City',
    'scheduled_at',(schedule_date+target_local_time) at time zone 'America/Mexico_City','due_at',((schedule_date+target_local_time) at time zone 'America/Mexico_City')+make_interval(mins=>target_due_offset_minutes));
end $$;

create or replace function app.record_control_cadence_evidence(
  target_organization_id uuid,target_occurrence_id uuid,target_window_key text,target_evidence_type text,target_completeness text,
  target_evidence_class public.evidence_class,target_evidence_sha256 text,target_recorded_at timestamptz,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; occurrence_record public.control_cadence_occurrences%rowtype; policy_class public.evidence_class; evidence_id uuid; response jsonb;
begin
  perform app.control_cadence_assert_operator(target_organization_id);
  if target_evidence_type not in ('AUTOMATED_SNAPSHOT','CHECKLIST') or target_completeness not in ('COMPLETE','PARTIAL','UNKNOWN') or target_evidence_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'CONTROL_CADENCE_EVIDENCE_INPUT_INVALID'; end if;
  replay:=app.control_cadence_command_begin(target_organization_id,'record_control_cadence_evidence',target_idempotency_key,jsonb_build_object('occurrence_id',target_occurrence_id,'window_key',target_window_key,'evidence_type',target_evidence_type,'completeness',target_completeness,'evidence_class',target_evidence_class,'evidence_sha256',target_evidence_sha256,'recorded_at',target_recorded_at));
  if replay is not null then return replay; end if;
  select o.* into occurrence_record from public.control_cadence_occurrences o where o.organization_id=target_organization_id and o.id=target_occurrence_id for update;
  select p.evidence_class into policy_class from public.control_cadence_policy_versions p where p.organization_id=target_organization_id and p.id=occurrence_record.policy_version_id;
  if not found or occurrence_record.window_key<>target_window_key then raise exception 'CONTROL_CADENCE_OCCURRENCE_WINDOW_MISMATCH'; end if;
  if target_evidence_class<>policy_class then raise exception 'CONTROL_CADENCE_EVIDENCE_CLASS_MISMATCH'; end if;
  if target_recorded_at<occurrence_record.window_started_at or target_recorded_at>clock_timestamp()+interval '5 minutes' then raise exception 'CONTROL_CADENCE_EVIDENCE_TIME_INVALID'; end if;
  perform set_config('app.control_cadence_rpc_write','on',true);
  insert into public.control_cadence_evidence_items(organization_id,occurrence_id,window_key,evidence_type,completeness,evidence_class,evidence_sha256,recorded_by,recorded_at,idempotency_key)
  values(target_organization_id,target_occurrence_id,target_window_key,target_evidence_type,target_completeness,target_evidence_class,target_evidence_sha256,auth.uid(),target_recorded_at,target_idempotency_key) returning id into evidence_id;
  response:=jsonb_build_object('status','RECORDED','evidence_id',evidence_id,'occurrence_id',target_occurrence_id,'window_key',target_window_key,'correlation_id',gen_random_uuid());
  return app.control_cadence_command_finish(target_organization_id,'record_control_cadence_evidence',target_idempotency_key,response);
end $$;

create or replace function app.record_control_cadence_session(
  target_organization_id uuid,target_occurrence_id uuid,target_window_key text,target_session_status text,target_started_at timestamptz,target_ended_at timestamptz,
  target_evidence_class public.evidence_class,target_evidence_sha256 text,target_recorded_at timestamptz,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; occurrence_record public.control_cadence_occurrences%rowtype; policy_class public.evidence_class; session_id uuid; response jsonb;
begin
  perform app.control_cadence_assert_operator(target_organization_id);
  if target_session_status not in ('PLANNED','HELD','CANCELLED','NO_SHOW') or target_evidence_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'CONTROL_CADENCE_SESSION_INPUT_INVALID'; end if;
  replay:=app.control_cadence_command_begin(target_organization_id,'record_control_cadence_session',target_idempotency_key,jsonb_build_object('occurrence_id',target_occurrence_id,'window_key',target_window_key,'session_status',target_session_status,'started_at',target_started_at,'ended_at',target_ended_at,'evidence_class',target_evidence_class,'evidence_sha256',target_evidence_sha256,'recorded_at',target_recorded_at));
  if replay is not null then return replay; end if;
  select o.* into occurrence_record from public.control_cadence_occurrences o where o.organization_id=target_organization_id and o.id=target_occurrence_id for update;
  select p.evidence_class into policy_class from public.control_cadence_policy_versions p where p.organization_id=target_organization_id and p.id=occurrence_record.policy_version_id;
  if not found or occurrence_record.window_key<>target_window_key then raise exception 'CONTROL_CADENCE_OCCURRENCE_WINDOW_MISMATCH'; end if;
  if target_evidence_class<>policy_class then raise exception 'CONTROL_CADENCE_EVIDENCE_CLASS_MISMATCH'; end if;
  if target_session_status='HELD' and (target_started_at<occurrence_record.window_started_at or target_ended_at>occurrence_record.window_ended_at or target_ended_at>target_recorded_at or target_ended_at-target_started_at<>make_interval(mins=>(select duration_minutes from public.control_cadence_policy_items where organization_id=target_organization_id and id=occurrence_record.policy_item_id))) then raise exception 'CONTROL_CADENCE_HELD_SESSION_INVALID'; end if;
  if target_recorded_at<occurrence_record.window_started_at or target_recorded_at>clock_timestamp()+interval '5 minutes' then raise exception 'CONTROL_CADENCE_SESSION_TIME_INVALID'; end if;
  perform set_config('app.control_cadence_rpc_write','on',true);
  insert into public.control_cadence_human_sessions(organization_id,occurrence_id,window_key,session_status,started_at,ended_at,evidence_class,evidence_sha256,recorded_by,recorded_at,idempotency_key)
  values(target_organization_id,target_occurrence_id,target_window_key,target_session_status,target_started_at,target_ended_at,target_evidence_class,target_evidence_sha256,auth.uid(),target_recorded_at,target_idempotency_key) returning id into session_id;
  response:=jsonb_build_object('status','RECORDED','session_id',session_id,'occurrence_id',target_occurrence_id,'window_key',target_window_key,'correlation_id',gen_random_uuid());
  return app.control_cadence_command_finish(target_organization_id,'record_control_cadence_session',target_idempotency_key,response);
end $$;

create or replace function app.record_control_cadence_attendance(
  target_organization_id uuid,target_session_id uuid,target_participant_user_id uuid,target_attendance_status text,target_evidence_sha256 text,
  target_recorded_at timestamptz,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; session_record public.control_cadence_human_sessions%rowtype; participant_role public.user_role; side_value text; attendance_id uuid; response jsonb;
begin
  perform app.control_cadence_assert_operator(target_organization_id);
  if target_attendance_status not in ('ATTENDED','ABSENT') or target_evidence_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'CONTROL_CADENCE_ATTENDANCE_INPUT_INVALID'; end if;
  replay:=app.control_cadence_command_begin(target_organization_id,'record_control_cadence_attendance',target_idempotency_key,jsonb_build_object('session_id',target_session_id,'participant_user_id',target_participant_user_id,'attendance_status',target_attendance_status,'evidence_sha256',target_evidence_sha256,'recorded_at',target_recorded_at));
  if replay is not null then return replay; end if;
  select * into session_record from public.control_cadence_human_sessions where organization_id=target_organization_id and id=target_session_id for update;
  if not found or session_record.session_status<>'HELD' then raise exception 'CONTROL_CADENCE_HELD_SESSION_REQUIRED'; end if;
  select role into participant_role from public.organization_users where organization_id=target_organization_id and user_id=target_participant_user_id and active;
  if participant_role is null or participant_role='auditor_readonly' then raise exception 'CONTROL_CADENCE_PARTICIPANT_INVALID'; end if;
  side_value:=case when participant_role in ('ennco_admin','ennco_operator') then 'ENNCO' else 'TECKEL' end;
  if target_recorded_at<session_record.ended_at or target_recorded_at>clock_timestamp()+interval '5 minutes' then raise exception 'CONTROL_CADENCE_ATTENDANCE_TIME_INVALID'; end if;
  perform set_config('app.control_cadence_rpc_write','on',true);
  insert into public.control_cadence_attendance(organization_id,session_id,participant_user_id,participant_side,attendance_status,evidence_sha256,recorded_by,recorded_at,idempotency_key)
  values(target_organization_id,target_session_id,target_participant_user_id,side_value,target_attendance_status,target_evidence_sha256,auth.uid(),target_recorded_at,target_idempotency_key) returning id into attendance_id;
  response:=jsonb_build_object('status','RECORDED','attendance_id',attendance_id,'session_id',target_session_id,'participant_side',side_value,'correlation_id',gen_random_uuid());
  return app.control_cadence_command_finish(target_organization_id,'record_control_cadence_attendance',target_idempotency_key,response);
end $$;

create or replace function app.record_control_cadence_delivery(
  target_organization_id uuid,target_occurrence_id uuid,target_window_key text,target_channel text,target_evidence_class public.evidence_class,
  target_evidence_sha256 text,target_delivered_at timestamptz,target_source_reference text,target_delivery_acknowledged boolean,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; occurrence_record public.control_cadence_occurrences%rowtype; policy_class public.evidence_class; delivery_id uuid; response jsonb;
begin
  perform app.control_cadence_assert_operator(target_organization_id);
  if target_evidence_sha256 !~ '^[a-f0-9]{64}$' or target_channel !~ '^[A-Z][A-Z0-9_]{1,31}$' or nullif(btrim(coalesce(target_source_reference,'')),'') is null or not target_delivery_acknowledged then raise exception 'CONTROL_CADENCE_DELIVERY_INPUT_INVALID'; end if;
  replay:=app.control_cadence_command_begin(target_organization_id,'record_control_cadence_delivery',target_idempotency_key,jsonb_build_object('occurrence_id',target_occurrence_id,'window_key',target_window_key,'channel',target_channel,'evidence_class',target_evidence_class,'evidence_sha256',target_evidence_sha256,'delivered_at',target_delivered_at,'source_reference',target_source_reference,'delivery_acknowledged',target_delivery_acknowledged));
  if replay is not null then return replay; end if;
  select o.* into occurrence_record from public.control_cadence_occurrences o where o.organization_id=target_organization_id and o.id=target_occurrence_id for update;
  select p.evidence_class into policy_class from public.control_cadence_policy_versions p where p.organization_id=target_organization_id and p.id=occurrence_record.policy_version_id;
  if not found or occurrence_record.window_key<>target_window_key then raise exception 'CONTROL_CADENCE_OCCURRENCE_WINDOW_MISMATCH'; end if;
  if target_evidence_class<>policy_class then raise exception 'CONTROL_CADENCE_EVIDENCE_CLASS_MISMATCH'; end if;
  if target_delivered_at<occurrence_record.window_started_at or target_delivered_at>clock_timestamp()+interval '5 minutes' then raise exception 'CONTROL_CADENCE_DELIVERY_TIME_INVALID'; end if;
  perform set_config('app.control_cadence_rpc_write','on',true);
  update public.control_cadence_delivery_requirements set delivery_status='DELIVERED',evidence_class=target_evidence_class,evidence_sha256=target_evidence_sha256,source_reference=btrim(target_source_reference),delivery_acknowledged=true,delivered_at=target_delivered_at,recorded_by=auth.uid(),idempotency_key=target_idempotency_key,updated_at=clock_timestamp()
  where organization_id=target_organization_id and occurrence_id=target_occurrence_id and channel=target_channel and delivery_status='PENDING' returning id into delivery_id;
  if delivery_id is null then raise exception 'CONTROL_CADENCE_DELIVERY_REQUIREMENT_NOT_PENDING'; end if;
  response:=jsonb_build_object('status','DELIVERED','delivery_requirement_id',delivery_id,'occurrence_id',target_occurrence_id,'channel',target_channel,'correlation_id',gen_random_uuid());
  return app.control_cadence_command_finish(target_organization_id,'record_control_cadence_delivery',target_idempotency_key,response);
end $$;

create or replace function app.mitigate_control_cadence_breach(
  target_organization_id uuid,target_breach_id uuid,target_mitigation_evidence_sha256 text,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; breach_record public.control_cadence_breaches%rowtype; response jsonb;
begin
  perform app.control_cadence_assert_operator(target_organization_id,true);
  if target_mitigation_evidence_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'CONTROL_CADENCE_MITIGATION_EVIDENCE_INVALID'; end if;
  replay:=app.control_cadence_command_begin(target_organization_id,'mitigate_control_cadence_breach',target_idempotency_key,
    jsonb_build_object('breach_id',target_breach_id,'mitigation_evidence_sha256',target_mitigation_evidence_sha256));
  if replay is not null then return replay; end if;
  select * into breach_record from public.control_cadence_breaches where organization_id=target_organization_id and id=target_breach_id for update;
  if not found or breach_record.status<>'OPEN' then raise exception 'CONTROL_CADENCE_OPEN_BREACH_NOT_FOUND'; end if;
  if not exists(select 1 from public.control_cadence_occurrences where organization_id=target_organization_id and id=breach_record.occurrence_id and execution_status='COMPLETED') then raise exception 'CONTROL_CADENCE_OCCURRENCE_NOT_REMEDIATED'; end if;
  if exists(select 1 from public.incidents where organization_id=target_organization_id and id=breach_record.incident_id and status not in ('RESOLVED','REVIEWED')) then raise exception 'CONTROL_CADENCE_INCIDENT_NOT_RESOLVED'; end if;
  perform set_config('app.control_cadence_rpc_write','on',true);
  update public.control_cadence_breaches set status='MITIGATED',mitigated_at=clock_timestamp(),mitigated_by=auth.uid(),mitigation_evidence_sha256=target_mitigation_evidence_sha256 where id=target_breach_id;
  response:=jsonb_build_object('status','MITIGATED','breach_id',target_breach_id,'occurrence_id',breach_record.occurrence_id,'correlation_id',gen_random_uuid());
  return app.control_cadence_command_finish(target_organization_id,'mitigate_control_cadence_breach',target_idempotency_key,response);
end $$;

create or replace function app.run_control_cadence_reconciler(target_organization_id uuid,target_evaluated_at timestamptz,target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; policy_record public.control_cadence_policy_versions%rowtype; policy_count integer; item_count integer; item public.control_cadence_policy_items%rowtype;
  window_data jsonb; occurrence_record public.control_cadence_occurrences%rowtype; response jsonb; input_sha text; output_sha text; run_state text:='HEALTHY'; reason text;
  occurrence_count integer:=0; breach_count integer:=0; incident_count integer:=0; execution_complete boolean; evidence_complete boolean; attendance_complete boolean; delivery_complete boolean;
  completion_time timestamptz; breach_kind_value text; incident_id uuid; outbox_id uuid; existing_breach uuid; anchor_at timestamptz;
begin
  if current_user<>'service_role' and not pg_has_role(current_user,'pg_database_owner','USAGE') then raise exception 'CONTROL_CADENCE_SERVICE_ROLE_REQUIRED'; end if;
  if target_evaluated_at>clock_timestamp()+interval '5 minutes' or target_evaluated_at<clock_timestamp()-interval '1 day' then raise exception 'CONTROL_CADENCE_CLOCK_INVALID'; end if;
  replay:=app.control_cadence_command_begin(target_organization_id,'run_control_cadence_reconciler',target_idempotency_key,jsonb_build_object('evaluated_at',target_evaluated_at));
  if replay is not null then return replay; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':control-cadence-reconcile',0));
  select count(*) into policy_count from public.control_cadence_policy_versions where organization_id=target_organization_id and state='ACTIVE';
  select * into policy_record from public.control_cadence_policy_versions where organization_id=target_organization_id and state='ACTIVE';
  select count(*) into item_count from public.control_cadence_policy_items i join public.organization_users ou on ou.organization_id=i.organization_id and ou.user_id=i.owner_user_id
  where i.organization_id=target_organization_id and i.policy_version_id=policy_record.id and i.config_state='VERIFIED' and ou.active and ou.role in ('ennco_admin','ennco_operator','teckel_admin','teckel_operator');
  input_sha:=encode(digest(jsonb_build_object(
    'organization_id',target_organization_id,'evaluated_at',target_evaluated_at,'policy_id',policy_record.id,'policy_sha256',policy_record.policy_sha256,
    'items',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'code',i.cadence_code,'config_state',i.config_state,'owner',i.owner_user_id,'local_time',i.local_time,'day_of_week',i.day_of_week,'day_of_month',i.day_of_month,'duration',i.duration_minutes,'due_offset',i.due_offset_minutes,'checklist',i.requires_checklist,'delivery',i.requires_delivery,'channels',i.delivery_channels,'config_sha',i.config_evidence_sha256) order by i.cadence_code),'[]') from public.control_cadence_policy_items i where i.organization_id=target_organization_id and i.policy_version_id=policy_record.id),
    'occurrences',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'item',o.policy_item_id,'window',o.window_key,'start',o.window_started_at,'end',o.window_ended_at,'scheduled',o.scheduled_at,'due',o.due_at,'execution',o.execution_status,'compliance',o.compliance_status,'completed',o.completed_at) order by o.policy_item_id,o.window_key),'[]') from public.control_cadence_occurrences o where o.organization_id=target_organization_id),
    'evidence',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'occurrence',e.occurrence_id,'window',e.window_key,'type',e.evidence_type,'completeness',e.completeness,'class',e.evidence_class,'sha',e.evidence_sha256,'recorded_at',e.recorded_at) order by e.id),'[]') from public.control_cadence_evidence_items e where e.organization_id=target_organization_id),
    'sessions',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'occurrence',s.occurrence_id,'window',s.window_key,'status',s.session_status,'started',s.started_at,'ended',s.ended_at,'class',s.evidence_class,'sha',s.evidence_sha256,'recorded_at',s.recorded_at) order by s.id),'[]') from public.control_cadence_human_sessions s where s.organization_id=target_organization_id),
    'attendance',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'session',a.session_id,'participant',a.participant_user_id,'side',a.participant_side,'status',a.attendance_status,'sha',a.evidence_sha256,'recorded_at',a.recorded_at) order by a.id),'[]') from public.control_cadence_attendance a where a.organization_id=target_organization_id),
    'delivery_requirements',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'occurrence',d.occurrence_id,'channel',d.channel,'status',d.delivery_status,'class',d.evidence_class,'sha',d.evidence_sha256,'delivered_at',d.delivered_at,'recorded_at',d.updated_at) order by d.id),'[]') from public.control_cadence_delivery_requirements d where d.organization_id=target_organization_id),
    'breaches',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'occurrence',b.occurrence_id,'kind',b.breach_kind,'severity',b.severity,'status',b.status,'detected_at',b.detected_at,'mitigated_at',b.mitigated_at,'mitigation_sha',b.mitigation_evidence_sha256) order by b.id),'[]') from public.control_cadence_breaches b where b.organization_id=target_organization_id)
  )::text,'sha256'),'hex');
  if policy_count<>1 or policy_record.id is null or item_count<>5 or (select count(distinct cadence_code) from public.control_cadence_policy_items where organization_id=target_organization_id and policy_version_id=policy_record.id)<>5 then
    run_state:='UNKNOWN'; reason:='POLICY_INCOMPLETE';
  elsif policy_record.heartbeat_stale_after_minutes is null then run_state:='UNKNOWN'; reason:='HEARTBEAT_POLICY_UNKNOWN';
  else
    perform set_config('app.control_cadence_rpc_write','on',true);
    for item in select * from public.control_cadence_policy_items where organization_id=target_organization_id and policy_version_id=policy_record.id order by cadence_code loop
      for anchor_at in
        select x from generate_series(
          case item.frequency
            when 'DAILY' then ((policy_record.activated_at at time zone 'America/Mexico_City')::date at time zone 'America/Mexico_City')
            when 'WEEKLY' then (date_trunc('week',policy_record.activated_at at time zone 'America/Mexico_City') at time zone 'America/Mexico_City')
            else (date_trunc('month',policy_record.activated_at at time zone 'America/Mexico_City') at time zone 'America/Mexico_City')
          end,
          case item.frequency
            when 'DAILY' then ((target_evaluated_at at time zone 'America/Mexico_City')::date at time zone 'America/Mexico_City')
            when 'WEEKLY' then (date_trunc('week',target_evaluated_at at time zone 'America/Mexico_City') at time zone 'America/Mexico_City')
            else (date_trunc('month',target_evaluated_at at time zone 'America/Mexico_City') at time zone 'America/Mexico_City')
          end,
          case item.frequency when 'DAILY' then interval '1 day' when 'WEEKLY' then interval '1 week' else interval '1 month' end
        ) x
      loop
      window_data:=app.control_cadence_window(item.cadence_code,item.day_of_week,item.day_of_month,item.local_time,item.due_offset_minutes,anchor_at);
      if (window_data->>'scheduled_at')::timestamptz<policy_record.activated_at then continue; end if;
      insert into public.control_cadence_occurrences(organization_id,policy_version_id,policy_item_id,cadence_code,window_key,window_started_at,window_ended_at,scheduled_at,due_at,execution_status,compliance_status)
      values(target_organization_id,policy_record.id,item.id,item.cadence_code,window_data->>'window_key',(window_data->>'window_started_at')::timestamptz,(window_data->>'window_ended_at')::timestamptz,(window_data->>'scheduled_at')::timestamptz,(window_data->>'due_at')::timestamptz,
        case when target_evaluated_at>=(window_data->>'scheduled_at')::timestamptz then 'OPEN' else 'SCHEDULED' end,'PENDING')
      on conflict (organization_id,policy_item_id,window_key) do nothing;
      select * into occurrence_record from public.control_cadence_occurrences where organization_id=target_organization_id and policy_item_id=item.id and window_key=window_data->>'window_key' for update;
      occurrence_count:=occurrence_count+1;
      insert into public.control_cadence_delivery_requirements(organization_id,occurrence_id,channel)
      select target_organization_id,occurrence_record.id,c from unnest(item.delivery_channels) c on conflict do nothing;
      if occurrence_record.execution_status='SCHEDULED' and target_evaluated_at>=occurrence_record.scheduled_at then
        update public.control_cadence_occurrences set execution_status='OPEN',updated_at=target_evaluated_at where id=occurrence_record.id;
        occurrence_record.execution_status:='OPEN';
      end if;
      if item.execution_mode='AUTOMATED' then
        select exists(select 1 from public.control_cadence_evidence_items e where e.organization_id=target_organization_id and e.occurrence_id=occurrence_record.id and e.evidence_type='AUTOMATED_SNAPSHOT' and e.completeness='COMPLETE' and e.evidence_class=policy_record.evidence_class and e.recorded_at<=target_evaluated_at),max(recorded_at)
        into execution_complete,completion_time from public.control_cadence_evidence_items e where e.organization_id=target_organization_id and e.occurrence_id=occurrence_record.id and e.evidence_type='AUTOMATED_SNAPSHOT' and e.completeness='COMPLETE' and e.evidence_class=policy_record.evidence_class and e.recorded_at<=target_evaluated_at;
      else
        select exists(select 1 from public.control_cadence_human_sessions s where s.organization_id=target_organization_id and s.occurrence_id=occurrence_record.id and s.session_status='HELD' and s.evidence_class=policy_record.evidence_class and s.recorded_at<=target_evaluated_at),max(recorded_at)
        into execution_complete,completion_time from public.control_cadence_human_sessions s where s.organization_id=target_organization_id and s.occurrence_id=occurrence_record.id and s.session_status='HELD' and s.evidence_class=policy_record.evidence_class and s.recorded_at<=target_evaluated_at;
      end if;
      evidence_complete:=not item.requires_checklist or exists(select 1 from public.control_cadence_evidence_items e where e.organization_id=target_organization_id and e.occurrence_id=occurrence_record.id and e.evidence_type='CHECKLIST' and e.completeness='COMPLETE' and e.evidence_class=policy_record.evidence_class and e.recorded_at<=target_evaluated_at);
      attendance_complete:=item.cadence_code<>'ENNCO_TECKEL_WEEKLY_MEETING' or exists(
        select 1 from public.control_cadence_human_sessions s join public.control_cadence_attendance a on a.organization_id=s.organization_id and a.session_id=s.id
        where s.organization_id=target_organization_id and s.occurrence_id=occurrence_record.id and s.session_status='HELD'
          and a.attendance_status='ATTENDED' and a.recorded_at<=target_evaluated_at
        group by s.id having count(distinct a.participant_side)=2
      );
      delivery_complete:=not item.requires_delivery or (
        exists(select 1 from public.control_cadence_delivery_requirements d where d.organization_id=target_organization_id and d.occurrence_id=occurrence_record.id)
        and not exists(select 1 from public.control_cadence_delivery_requirements d where d.organization_id=target_organization_id and d.occurrence_id=occurrence_record.id and (d.delivery_status<>'DELIVERED' or d.evidence_class<>policy_record.evidence_class or d.delivered_at>target_evaluated_at or d.updated_at>target_evaluated_at))
      );
      if occurrence_record.execution_status='COMPLETED' then
        execution_complete:=true; evidence_complete:=true; attendance_complete:=true; delivery_complete:=true; completion_time:=occurrence_record.completed_at;
      end if;
      if execution_complete and evidence_complete and attendance_complete and delivery_complete then
        if occurrence_record.execution_status<>'COMPLETED' then select greatest(completion_time,
          coalesce((select max(e.recorded_at) from public.control_cadence_evidence_items e where e.organization_id=target_organization_id and e.occurrence_id=occurrence_record.id and e.recorded_at<=target_evaluated_at),completion_time),
          coalesce((select max(a.recorded_at) from public.control_cadence_attendance a join public.control_cadence_human_sessions s on s.organization_id=a.organization_id and s.id=a.session_id where s.organization_id=target_organization_id and s.occurrence_id=occurrence_record.id and a.recorded_at<=target_evaluated_at),completion_time),
          coalesce((select max(greatest(d.delivered_at,d.updated_at)) from public.control_cadence_delivery_requirements d where d.organization_id=target_organization_id and d.occurrence_id=occurrence_record.id and d.delivered_at<=target_evaluated_at and d.updated_at<=target_evaluated_at),completion_time)) into completion_time;
        end if;
        update public.control_cadence_occurrences set execution_status='COMPLETED',completed_at=coalesce(completed_at,completion_time),
          compliance_status=case when compliance_status='BREACHED' or completion_time>due_at then 'BREACHED' else 'MET' end,updated_at=target_evaluated_at where id=occurrence_record.id;
        if completion_time>occurrence_record.due_at then
          breach_kind_value:='EXECUTION_OVERDUE';
          select b.id into existing_breach from public.control_cadence_breaches b where b.organization_id=target_organization_id and b.occurrence_id=occurrence_record.id and b.breach_kind=breach_kind_value;
          if existing_breach is null then
            incident_id:=app.open_operational_incident(target_organization_id,'cadence:'||occurrence_record.id||':'||breach_kind_value,'P1','Cadencia operativa terminada tarde: '||item.cadence_code,occurrence_record.id);
            insert into public.event_outbox(organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json)
            values(target_organization_id,'control_cadence_occurrence',occurrence_record.id,'control_cadence.breached','cadence-breach:'||occurrence_record.id||':'||breach_kind_value,
              jsonb_build_object('occurrence_id',occurrence_record.id,'cadence_code',item.cadence_code,'breach_kind',breach_kind_value,'severity','P1')) on conflict do nothing returning id into outbox_id;
            insert into public.control_cadence_breaches(organization_id,occurrence_id,breach_kind,severity,detected_at,incident_id,outbox_event_id)
            values(target_organization_id,occurrence_record.id,breach_kind_value,'P1',target_evaluated_at,incident_id,outbox_id);
            breach_count:=breach_count+1; incident_count:=incident_count+1;
          end if;
        end if;
      elsif target_evaluated_at>occurrence_record.due_at then
        breach_kind_value:=case when not execution_complete then 'EXECUTION_OVERDUE' when not evidence_complete then 'EVIDENCE_INCOMPLETE' when not attendance_complete then 'ATTENDANCE_INCOMPLETE' else 'DELIVERY_INCOMPLETE' end;
        update public.control_cadence_occurrences set compliance_status='BREACHED',updated_at=target_evaluated_at where id=occurrence_record.id;
        select b.id into existing_breach from public.control_cadence_breaches b where b.organization_id=target_organization_id and b.occurrence_id=occurrence_record.id and b.breach_kind=breach_kind_value;
        if existing_breach is null then
          incident_id:=app.open_operational_incident(target_organization_id,'cadence:'||occurrence_record.id||':'||breach_kind_value,'P1','Cadencia operativa vencida: '||item.cadence_code,occurrence_record.id);
          insert into public.event_outbox(organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json)
          values(target_organization_id,'control_cadence_occurrence',occurrence_record.id,'control_cadence.breached','cadence-breach:'||occurrence_record.id||':'||breach_kind_value,
            jsonb_build_object('occurrence_id',occurrence_record.id,'cadence_code',item.cadence_code,'breach_kind',breach_kind_value,'severity','P1')) on conflict do nothing returning id into outbox_id;
          insert into public.control_cadence_breaches(organization_id,occurrence_id,breach_kind,severity,detected_at,incident_id,outbox_event_id)
          values(target_organization_id,occurrence_record.id,breach_kind_value,'P1',target_evaluated_at,incident_id,outbox_id);
          breach_count:=breach_count+1; incident_count:=incident_count+1;
        end if;
      end if;
      end loop;
    end loop;
    if exists(select 1 from public.control_cadence_breaches where organization_id=target_organization_id and status='OPEN' and severity in ('P0','P1')) then run_state:='DEGRADED'; reason:='P0_P1_CADENCE_BREACH'; end if;
  end if;
  if run_state='UNKNOWN' then
    insert into public.event_outbox(organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json)
    values(target_organization_id,'organization',target_organization_id,'control_cadence.unknown','cadence-unknown:'||target_idempotency_key,jsonb_build_object('reason_code',reason,'evaluated_at',target_evaluated_at)) on conflict do nothing;
  end if;
  response:=jsonb_build_object('status','RECONCILED','state',run_state,'reason_code',reason,'organization_id',target_organization_id,'evaluated_at',target_evaluated_at,'policy_version_id',policy_record.id,'occurrence_count',occurrence_count,'breach_count',breach_count,'incident_count',incident_count,'correlation_id',gen_random_uuid());
  output_sha:=encode(digest(response::text,'sha256'),'hex');
  perform set_config('app.control_cadence_rpc_write','on',true);
  insert into public.control_cadence_reconciliation_runs(organization_id,policy_version_id,evaluated_at,heartbeat_at,state,reason_code,input_sha256,output_sha256,occurrence_count,breach_count,incident_count,idempotency_key)
  values(target_organization_id,policy_record.id,target_evaluated_at,target_evaluated_at,run_state,reason,input_sha,output_sha,occurrence_count,breach_count,incident_count,target_idempotency_key);
  return app.control_cadence_command_finish(target_organization_id,'run_control_cadence_reconciler',target_idempotency_key,response);
end $$;

create or replace function app.run_control_cadence_heartbeat_watchdog(target_organization_id uuid,target_evaluated_at timestamptz,target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; policy_record public.control_cadence_policy_versions%rowtype; latest_at timestamptz; incident_id uuid; outbox_id uuid; state_value text; response jsonb;
begin
  if current_user<>'service_role' and not pg_has_role(current_user,'pg_database_owner','USAGE') then raise exception 'CONTROL_CADENCE_SERVICE_ROLE_REQUIRED'; end if;
  if target_evaluated_at>clock_timestamp()+interval '5 minutes' or target_evaluated_at<clock_timestamp()-interval '1 day' then raise exception 'CONTROL_CADENCE_CLOCK_INVALID'; end if;
  replay:=app.control_cadence_command_begin(target_organization_id,'run_control_cadence_heartbeat_watchdog',target_idempotency_key,jsonb_build_object('evaluated_at',target_evaluated_at));
  if replay is not null then return replay; end if;
  select v.* into policy_record from public.control_cadence_policy_versions v where v.organization_id=target_organization_id and v.state='ACTIVE';
  select max(heartbeat_at) into latest_at from public.control_cadence_reconciliation_runs where organization_id=target_organization_id and policy_version_id=policy_record.id;
  if policy_record.id is null or policy_record.heartbeat_stale_after_minutes is null or latest_at is null or latest_at<target_evaluated_at-make_interval(mins=>policy_record.heartbeat_stale_after_minutes) then
    state_value:='UNKNOWN';
    incident_id:=app.open_operational_incident(target_organization_id,'cadence-heartbeat-stale','P1','Heartbeat de cadencia vencido',target_organization_id);
    insert into public.event_outbox(organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json)
    values(target_organization_id,'organization',target_organization_id,'control_cadence.heartbeat_stale','cadence-heartbeat-stale:'||coalesce(policy_record.id::text,'no-active-policy'),
      jsonb_build_object('policy_version_id',policy_record.id,'last_heartbeat_at',latest_at,'evaluated_at',target_evaluated_at,'severity','P1'))
    on conflict do nothing returning id into outbox_id;
  else state_value:='HEALTHY'; end if;
  response:=jsonb_build_object('status','WATCHDOG_EVALUATED','state',state_value,'organization_id',target_organization_id,'evaluated_at',target_evaluated_at,
    'policy_version_id',policy_record.id,'last_heartbeat_at',latest_at,'incident_id',incident_id,'outbox_event_id',outbox_id,'correlation_id',gen_random_uuid());
  return app.control_cadence_command_finish(target_organization_id,'run_control_cadence_heartbeat_watchdog',target_idempotency_key,response);
end $$;

create or replace function app.evaluate_control_cadence_health(target_organization_id uuid,target_evaluated_at timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
declare policy_record public.control_cadence_policy_versions%rowtype; latest public.control_cadence_reconciliation_runs%rowtype; item_count integer:=0; open_count integer:=0; breached_count integer:=0; blocking_breached_count integer:=0; open_p0 integer:=0; open_p1 integer:=0;
  state text:='UNKNOWN'; reason text:='POLICY_NOT_ACTIVE'; heartbeat text:='UNKNOWN'; release_state text:='BLOCKED'; cadences jsonb:='[]'::jsonb;
begin
  if not app.is_member(target_organization_id) then raise exception 'CONTROL_CADENCE_MEMBER_REQUIRED'; end if;
  begin
    select v.* into policy_record from public.control_cadence_policy_versions v where v.organization_id=target_organization_id and v.state='ACTIVE';
    if policy_record.id is not null then
      select count(*) into item_count from public.control_cadence_policy_items i join public.organization_users ou on ou.organization_id=i.organization_id and ou.user_id=i.owner_user_id
      where i.organization_id=target_organization_id and i.policy_version_id=policy_record.id and i.config_state='VERIFIED' and ou.active and ou.role in ('ennco_admin','ennco_operator','teckel_admin','teckel_operator');
      select * into latest from public.control_cadence_reconciliation_runs where organization_id=target_organization_id and policy_version_id=policy_record.id order by evaluated_at desc limit 1;
      select count(*) filter(where execution_status in ('SCHEDULED','OPEN','UNKNOWN')) into open_count from public.control_cadence_occurrences where organization_id=target_organization_id and policy_version_id=policy_record.id;
      select count(distinct b.occurrence_id) into breached_count from public.control_cadence_breaches b where b.organization_id=target_organization_id and b.status='OPEN';
      select count(*) filter(where severity='P0'),count(*) filter(where severity='P1') into open_p0,open_p1 from public.control_cadence_breaches where organization_id=target_organization_id and status='OPEN';
      select count(*) into blocking_breached_count from public.control_cadence_occurrences o where o.organization_id=target_organization_id and o.policy_version_id=policy_record.id and o.compliance_status='BREACHED'
        and (not exists(select 1 from public.control_cadence_breaches b where b.organization_id=o.organization_id and b.occurrence_id=o.id) or exists(select 1 from public.control_cadence_breaches b where b.organization_id=o.organization_id and b.occurrence_id=o.id and b.status='OPEN'));
      if item_count<>5 then state:='UNKNOWN'; reason:='POLICY_INCOMPLETE';
      elsif latest.id is null then state:='UNKNOWN'; reason:='RECONCILER_NEVER_RAN';
      elsif (select count(distinct o.cadence_code) from public.control_cadence_occurrences o where o.organization_id=target_organization_id and o.policy_version_id=policy_record.id)<>5 then state:='UNKNOWN'; reason:='OCCURRENCE_COVERAGE_INCOMPLETE';
      elsif latest.heartbeat_at<target_evaluated_at-make_interval(mins=>policy_record.heartbeat_stale_after_minutes) then state:='UNKNOWN'; reason:='RECONCILER_HEARTBEAT_STALE'; heartbeat:='STALE';
      elsif latest.state='UNKNOWN' then state:='UNKNOWN'; reason:=coalesce(latest.reason_code,'LATEST_RECONCILIATION_UNKNOWN'); heartbeat:='FRESH';
      elsif open_p0>0 or open_p1>0 or blocking_breached_count>0 or latest.state='DEGRADED' then state:='DEGRADED'; reason:='P0_P1_CADENCE_BREACH'; heartbeat:='FRESH';
      elsif policy_record.evidence_class='synthetic_demo' then state:='HEALTHY'; reason:='SYNTHETIC_EVIDENCE_NOT_LIVE'; heartbeat:='FRESH'; release_state:='BLOCKED';
      else state:='HEALTHY'; reason:=null; heartbeat:='FRESH'; release_state:='ALLOWED'; end if;
      select coalesce(jsonb_agg(jsonb_build_object(
        'code',i.cadence_code,'config_state',i.config_state,'owner_user_id',i.owner_user_id,
        'next_occurrence_at',o.scheduled_at,'due_at',o.due_at,'execution_status',coalesce(o.execution_status,'UNKNOWN'),
        'compliance_status',coalesce(o.compliance_status,'UNKNOWN'),
        'evidence_state',case when o.id is null then 'UNKNOWN' when i.execution_mode='AUTOMATED' and exists(select 1 from public.control_cadence_evidence_items e where e.organization_id=i.organization_id and e.occurrence_id=o.id and e.evidence_type='AUTOMATED_SNAPSHOT' and e.completeness='COMPLETE' and e.evidence_class=policy_record.evidence_class) then 'COMPLETE' when i.execution_mode='HUMAN' and exists(select 1 from public.control_cadence_human_sessions s where s.organization_id=i.organization_id and s.occurrence_id=o.id and s.session_status='HELD' and s.evidence_class=policy_record.evidence_class) then 'COMPLETE' else 'INCOMPLETE' end,
        'attendance_state',case when i.cadence_code<>'ENNCO_TECKEL_WEEKLY_MEETING' then 'NOT_REQUIRED' when o.id is null then 'UNKNOWN' when exists(select 1 from public.control_cadence_human_sessions s join public.control_cadence_attendance a on a.organization_id=s.organization_id and a.session_id=s.id where s.occurrence_id=o.id and a.attendance_status='ATTENDED' group by s.id having count(distinct a.participant_side)=2) then 'COMPLETE' else 'INCOMPLETE' end,
        'delivery_state',case when o.id is null then 'UNKNOWN' when not exists(select 1 from public.control_cadence_delivery_requirements d where d.organization_id=i.organization_id and d.occurrence_id=o.id) then 'NOT_REQUIRED' when not exists(select 1 from public.control_cadence_delivery_requirements d where d.organization_id=i.organization_id and d.occurrence_id=o.id and d.delivery_status<>'DELIVERED') then 'COMPLETE' else 'INCOMPLETE' end,
        'breach_severity',(select max(b.severity::text) from public.control_cadence_breaches b where b.organization_id=i.organization_id and b.occurrence_id=o.id and b.status='OPEN'),
        'next_action',case when i.config_state<>'VERIFIED' then 'CONFIGURE' when o.id is null then 'RECONCILE' when exists(select 1 from public.control_cadence_breaches b where b.organization_id=i.organization_id and b.occurrence_id=o.id and b.status='OPEN') then 'MITIGATE_BREACH' when o.execution_status<>'COMPLETED' then 'COMPLETE_OCCURRENCE' else 'NONE' end
      ) order by i.cadence_code),'[]'::jsonb) into cadences
      from public.control_cadence_policy_items i left join lateral (
        select x.* from public.control_cadence_occurrences x where x.organization_id=i.organization_id and x.policy_item_id=i.id order by x.window_started_at desc limit 1
      ) o on true where i.organization_id=target_organization_id and i.policy_version_id=policy_record.id;
    end if;
    return jsonb_build_object('status','READ_ONLY','state',state,'reason_code',reason,'organization_id',target_organization_id,'evaluated_at',target_evaluated_at,
      'policy_version_id',policy_record.id,'policy_version',policy_record.version,'timezone','America/Mexico_City','cadence_count',item_count,'required_cadence_count',5,
      'open_occurrences',open_count,'breached_occurrences',breached_count,'open_p0',open_p0,'open_p1',open_p1,'last_reconciled_at',latest.evaluated_at,
      'heartbeat_state',heartbeat,'outbound_release',release_state,'cadences',cadences);
  exception when others then
    return jsonb_build_object('status','READ_ONLY','state','UNKNOWN','reason_code','READ_MODEL_INCOMPLETE','organization_id',target_organization_id,'evaluated_at',target_evaluated_at,
      'policy_version_id',null,'policy_version',null,'timezone','America/Mexico_City','cadence_count',0,'required_cadence_count',5,'open_occurrences',0,'breached_occurrences',0,'open_p0',0,'open_p1',0,
      'last_reconciled_at',null,'heartbeat_state','UNKNOWN','outbound_release','BLOCKED','cadences','[]'::jsonb);
  end;
end $$;

create or replace function app.enforce_control_cadence_send_health()
returns trigger language plpgsql security definer set search_path=public,app,pg_temp as $$
declare health jsonb;
begin
  if new.direction<>'OUTBOUND' or new.status='DRY_RUN' or (tg_op='UPDATE' and new.status is not distinct from old.status) then return new; end if;
  select app.evaluate_control_cadence_health_as_system(new.organization_id,clock_timestamp()) into health;
  if health->>'state'<>'HEALTHY' or health->>'outbound_release'<>'ALLOWED' then raise exception 'CONTROL_CADENCE_HEALTH_NOT_HEALTHY'; end if;
  return new;
end $$;

create or replace function app.evaluate_control_cadence_health_as_system(target_organization_id uuid,target_evaluated_at timestamptz)
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
declare policy_record public.control_cadence_policy_versions%rowtype; latest public.control_cadence_reconciliation_runs%rowtype; item_count integer; open_p0 integer; open_p1 integer; blocking_breached_occurrences integer;
begin
  select * into policy_record from public.control_cadence_policy_versions where organization_id=target_organization_id and state='ACTIVE';
  if policy_record.id is null then return jsonb_build_object('state','UNKNOWN','outbound_release','BLOCKED'); end if;
  select count(*) into item_count from public.control_cadence_policy_items i join public.organization_users ou on ou.organization_id=i.organization_id and ou.user_id=i.owner_user_id
  where i.organization_id=target_organization_id and i.policy_version_id=policy_record.id and i.config_state='VERIFIED' and ou.active and ou.role in ('ennco_admin','ennco_operator','teckel_admin','teckel_operator');
  select * into latest from public.control_cadence_reconciliation_runs where organization_id=target_organization_id and policy_version_id=policy_record.id order by evaluated_at desc limit 1;
  select count(*) filter(where severity='P0'),count(*) filter(where severity='P1') into open_p0,open_p1 from public.control_cadence_breaches where organization_id=target_organization_id and status='OPEN';
  select count(*) into blocking_breached_occurrences from public.control_cadence_occurrences o where o.organization_id=target_organization_id and o.policy_version_id=policy_record.id and o.compliance_status='BREACHED'
    and (not exists(select 1 from public.control_cadence_breaches b where b.organization_id=o.organization_id and b.occurrence_id=o.id) or exists(select 1 from public.control_cadence_breaches b where b.organization_id=o.organization_id and b.occurrence_id=o.id and b.status='OPEN'));
  if item_count<>5 or (select count(distinct o.cadence_code) from public.control_cadence_occurrences o where o.organization_id=target_organization_id and o.policy_version_id=policy_record.id)<>5
    or latest.id is null or latest.heartbeat_at<target_evaluated_at-make_interval(mins=>policy_record.heartbeat_stale_after_minutes) or latest.state<>'HEALTHY' or open_p0>0 or open_p1>0 or blocking_breached_occurrences>0 then
    return jsonb_build_object('state',case when open_p0>0 or open_p1>0 or blocking_breached_occurrences>0 then 'DEGRADED' else 'UNKNOWN' end,'outbound_release','BLOCKED');
  end if;
  if policy_record.evidence_class<>'live' then return jsonb_build_object('state','HEALTHY','reason_code','SYNTHETIC_EVIDENCE_NOT_LIVE','outbound_release','BLOCKED'); end if;
  return jsonb_build_object('state','HEALTHY','outbound_release','ALLOWED');
exception when others then return jsonb_build_object('state','UNKNOWN','outbound_release','BLOCKED'); end $$;

drop trigger if exists messages_control_cadence_send_health on public.messages;
create trigger messages_control_cadence_send_health before insert or update of status on public.messages for each row execute function app.enforce_control_cadence_send_health();

do $$ declare table_name text; begin
  foreach table_name in array array[
    'control_cadence_policy_versions','control_cadence_policy_items','control_cadence_occurrences','control_cadence_human_sessions','control_cadence_attendance',
    'control_cadence_evidence_items','control_cadence_delivery_requirements','control_cadence_breaches','control_cadence_reconciliation_runs','control_cadence_command_ledger'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('drop policy if exists %I_member_read on public.%I',table_name,table_name);
    execute format('create policy %I_member_read on public.%I for select using (app.is_member(organization_id))',table_name,table_name);
    execute format('drop trigger if exists %I_rpc_guard on public.%I',table_name,table_name);
    execute format('create trigger %I_rpc_guard before insert or update or delete on public.%I for each row execute function app.prevent_control_cadence_direct_write()',table_name,table_name);
    execute format('drop trigger if exists %I_audit on public.%I',table_name,table_name);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.capture_control_cadence_audit()',table_name,table_name);
    execute format('revoke insert,update,delete,truncate on public.%I from authenticated',table_name);
    execute format('revoke insert,update,delete,truncate on public.%I from service_role',table_name);
  end loop;
end $$;

grant select on public.control_cadence_policy_versions,public.control_cadence_policy_items,public.control_cadence_occurrences,public.control_cadence_human_sessions,
  public.control_cadence_attendance,public.control_cadence_evidence_items,public.control_cadence_delivery_requirements,public.control_cadence_breaches,public.control_cadence_reconciliation_runs to authenticated;

create or replace function public.create_control_cadence_policy(uuid,integer,public.evidence_class,integer,jsonb,text) returns jsonb language sql security definer set search_path=app,public,pg_temp as $$ select app.create_control_cadence_policy($1,$2,$3,$4,$5,$6) $$;
create or replace function public.activate_control_cadence_policy(uuid,uuid,text,text) returns jsonb language sql security definer set search_path=app,public,pg_temp as $$ select app.activate_control_cadence_policy($1,$2,$3,$4) $$;
create or replace function public.record_control_cadence_evidence(uuid,uuid,text,text,text,public.evidence_class,text,text) returns jsonb language sql security definer set search_path=app,public,pg_temp as $$ select app.record_control_cadence_evidence($1,$2,$3,$4,$5,$6,$7,clock_timestamp(),$8) $$;
create or replace function public.record_control_cadence_session(uuid,uuid,text,text,timestamptz,timestamptz,public.evidence_class,text,text) returns jsonb language sql security definer set search_path=app,public,pg_temp as $$ select app.record_control_cadence_session($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp(),$9) $$;
create or replace function public.record_control_cadence_attendance(uuid,uuid,uuid,text,text,text) returns jsonb language sql security definer set search_path=app,public,pg_temp as $$ select app.record_control_cadence_attendance($1,$2,$3,$4,$5,clock_timestamp(),$6) $$;
create or replace function public.record_control_cadence_delivery(uuid,uuid,text,text,public.evidence_class,text,timestamptz,text,boolean,text) returns jsonb language sql security definer set search_path=app,public,pg_temp as $$ select app.record_control_cadence_delivery($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) $$;
create or replace function public.mitigate_control_cadence_breach(uuid,uuid,text,text) returns jsonb language sql security definer set search_path=app,public,pg_temp as $$ select app.mitigate_control_cadence_breach($1,$2,$3,$4) $$;
create or replace function public.evaluate_control_cadence_health(uuid,timestamptz) returns jsonb language sql security definer set search_path=app,public,pg_temp as $$ select app.evaluate_control_cadence_health($1,$2) $$;

revoke all on function app.control_cadence_internal_executor() from public,authenticated,service_role;
revoke all on function app.prevent_control_cadence_direct_write() from public,authenticated,service_role;
revoke all on function app.control_cadence_audit_snapshot(text,jsonb) from public,authenticated,service_role;
revoke all on function app.capture_control_cadence_audit() from public,authenticated,service_role;
revoke all on function app.control_cadence_assert_operator(uuid,boolean) from public,authenticated,service_role;
revoke all on function app.control_cadence_command_begin(uuid,text,text,jsonb) from public,authenticated,service_role;
revoke all on function app.control_cadence_command_finish(uuid,text,text,jsonb) from public,authenticated,service_role;
revoke all on function app.create_control_cadence_policy(uuid,integer,public.evidence_class,integer,jsonb,text) from public,authenticated,service_role;
revoke all on function app.activate_control_cadence_policy(uuid,uuid,text,text) from public,authenticated,service_role;
revoke all on function app.control_cadence_window(text,integer,integer,time,integer,timestamptz) from public,authenticated,service_role;
revoke all on function app.record_control_cadence_evidence(uuid,uuid,text,text,text,public.evidence_class,text,timestamptz,text) from public,authenticated,service_role;
revoke all on function app.record_control_cadence_session(uuid,uuid,text,text,timestamptz,timestamptz,public.evidence_class,text,timestamptz,text) from public,authenticated,service_role;
revoke all on function app.record_control_cadence_attendance(uuid,uuid,uuid,text,text,timestamptz,text) from public,authenticated,service_role;
revoke all on function app.record_control_cadence_delivery(uuid,uuid,text,text,public.evidence_class,text,timestamptz,text,boolean,text) from public,authenticated,service_role;
revoke all on function app.mitigate_control_cadence_breach(uuid,uuid,text,text) from public,authenticated,service_role;
revoke all on function app.run_control_cadence_reconciler(uuid,timestamptz,text) from public,authenticated;
revoke all on function app.run_control_cadence_heartbeat_watchdog(uuid,timestamptz,text) from public,authenticated;
revoke all on function app.evaluate_control_cadence_health(uuid,timestamptz) from public,authenticated,service_role;
revoke all on function app.evaluate_control_cadence_health_as_system(uuid,timestamptz) from public,authenticated,service_role;
revoke all on function app.enforce_control_cadence_send_health() from public,authenticated,service_role;

revoke all on function public.create_control_cadence_policy(uuid,integer,public.evidence_class,integer,jsonb,text) from public;
revoke all on function public.activate_control_cadence_policy(uuid,uuid,text,text) from public;
revoke all on function public.record_control_cadence_evidence(uuid,uuid,text,text,text,public.evidence_class,text,text) from public;
revoke all on function public.record_control_cadence_session(uuid,uuid,text,text,timestamptz,timestamptz,public.evidence_class,text,text) from public;
revoke all on function public.record_control_cadence_attendance(uuid,uuid,uuid,text,text,text) from public;
revoke all on function public.record_control_cadence_delivery(uuid,uuid,text,text,public.evidence_class,text,timestamptz,text,boolean,text) from public;
revoke all on function public.mitigate_control_cadence_breach(uuid,uuid,text,text) from public;
revoke all on function public.evaluate_control_cadence_health(uuid,timestamptz) from public;
grant execute on function public.create_control_cadence_policy(uuid,integer,public.evidence_class,integer,jsonb,text) to authenticated;
grant execute on function public.activate_control_cadence_policy(uuid,uuid,text,text) to authenticated;
grant execute on function public.record_control_cadence_evidence(uuid,uuid,text,text,text,public.evidence_class,text,text) to authenticated;
grant execute on function public.record_control_cadence_session(uuid,uuid,text,text,timestamptz,timestamptz,public.evidence_class,text,text) to authenticated;
grant execute on function public.record_control_cadence_attendance(uuid,uuid,uuid,text,text,text) to authenticated;
grant execute on function public.record_control_cadence_delivery(uuid,uuid,text,text,public.evidence_class,text,timestamptz,text,boolean,text) to authenticated;
grant execute on function public.mitigate_control_cadence_breach(uuid,uuid,text,text) to authenticated;
grant execute on function public.evaluate_control_cadence_health(uuid,timestamptz) to authenticated;
grant execute on function app.run_control_cadence_reconciler(uuid,timestamptz,text) to service_role;
grant execute on function app.run_control_cadence_heartbeat_watchdog(uuid,timestamptz,text) to service_role;

commit;
