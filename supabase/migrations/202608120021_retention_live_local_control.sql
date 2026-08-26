begin;

create or replace function app.digest(target_value text, target_algorithm text)
returns bytea
language sql
immutable
set search_path = extensions, public, pg_catalog
as $$
  select digest(target_value, target_algorithm)
$$;
revoke all on function app.digest(text, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function app.digest(text, text) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function app.digest(text, text) to service_role;
  end if;
end;
$$;

drop trigger if exists retention_m021_rollback_fail_closed on public.deletion_batches;
drop trigger if exists legal_holds_m021_rollback_fail_closed on public.legal_holds;
drop trigger if exists deletion_items_m021_rollback_fail_closed on public.deletion_items;
drop trigger if exists deletion_tombstones_m021_rollback_fail_closed on public.deletion_tombstones;
drop function if exists app.m021_retention_rollback_fail_closed();

do $$ begin
  if not exists (select 1 from pg_type where typnamespace='public'::regnamespace and typname='retention_policy_status') then
    create type public.retention_policy_status as enum ('DRAFT','ACTIVE','RETIRED');
  end if;
  if not exists (select 1 from pg_type where typnamespace='public'::regnamespace and typname='retention_rule_state') then
    create type public.retention_rule_state as enum ('VERIFIED','UNKNOWN','BLOCKED_EXTERNAL');
  end if;
  if not exists (select 1 from pg_type where typnamespace='public'::regnamespace and typname='retention_reconciliation_status') then
    create type public.retention_reconciliation_status as enum ('HEALTHY','DEGRADED','UNKNOWN');
  end if;
  if not exists (select 1 from pg_type where typnamespace='public'::regnamespace and typname='retention_propagation_status') then
    create type public.retention_propagation_status as enum ('UNKNOWN','PENDING','ACKNOWLEDGED','FAILED','NOT_APPLICABLE');
  end if;
end $$;

create unique index if not exists legal_holds_organization_id_id_unique
on public.legal_holds (organization_id,id);
create unique index if not exists deletion_tombstones_organization_id_id_unique
on public.deletion_tombstones (organization_id,id);

alter table public.legal_holds add column if not exists release_evidence_sha256 text;
alter table public.legal_holds drop constraint if exists legal_holds_release_evidence_check;
alter table public.legal_holds add constraint legal_holds_release_evidence_check check (
  (status='ACTIVE' and release_evidence_sha256 is null)
  or (status='RELEASED' and release_evidence_sha256 ~ '^[a-f0-9]{64}$')
);

create table if not exists public.retention_policy_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null check (version>0),
  status public.retention_policy_status not null default 'DRAFT',
  scope text not null default 'SYNTHETIC_LOCAL' check (scope in ('SYNTHETIC_LOCAL','LIVE')),
  timezone text not null default 'America/Mexico_City' check (timezone='America/Mexico_City'),
  effective_from timestamptz not null,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  created_by uuid not null,
  activated_by uuid,
  activated_at timestamptz,
  approval_evidence_sha256 text check (approval_evidence_sha256 is null or approval_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  retired_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  unique (organization_id,version),
  check (
    (status='DRAFT' and activated_by is null and activated_at is null and approval_evidence_sha256 is null and retired_at is null)
    or (status='ACTIVE' and activated_by is not null and activated_at is not null and approval_evidence_sha256 ~ '^[a-f0-9]{64}$' and retired_at is null)
    or (status='RETIRED' and activated_by is not null and activated_at is not null and approval_evidence_sha256 ~ '^[a-f0-9]{64}$' and retired_at is not null)
  ),
  check (activated_by is null or activated_by<>created_by)
);
create unique index if not exists retention_policy_one_active_per_org
on public.retention_policy_versions (organization_id) where status='ACTIVE';

alter table public.retention_policy_versions add column if not exists approval_evidence_sha256 text;
alter table public.retention_policy_versions drop constraint if exists retention_policy_approval_evidence_check;
alter table public.retention_policy_versions add constraint retention_policy_approval_evidence_check check (
  (status='DRAFT' and approval_evidence_sha256 is null)
  or (status in ('ACTIVE','RETIRED') and approval_evidence_sha256 ~ '^[a-f0-9]{64}$')
);

create table if not exists public.retention_policy_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_id uuid not null,
  category text not null check (category in ('CONTACT_OUTREACH','SYNTHETIC_CONTACT','PREQUOTE_DOCUMENT','MESSAGE_CONTENT')),
  subject_type text not null check (subject_type in ('CONTACT','PREQUOTE_DOCUMENT','MESSAGE')),
  evidence_class public.evidence_class not null,
  anchor_event text not null default 'LAST_SUBSTANTIVE_ACTIVITY' check (anchor_event='LAST_SUBSTANTIVE_ACTIVITY'),
  retention_days integer not null check (retention_days between 1 and 3650),
  action text not null default 'ANONYMIZE' check (action='ANONYMIZE'),
  rule_state public.retention_rule_state not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id,policy_id) references public.retention_policy_versions(organization_id,id) on delete cascade,
  unique (organization_id,id),
  unique (organization_id,policy_id,category),
  check (
    (category in ('CONTACT_OUTREACH','SYNTHETIC_CONTACT') and subject_type='CONTACT')
    or (category='PREQUOTE_DOCUMENT' and subject_type='PREQUOTE_DOCUMENT')
    or (category='MESSAGE_CONTENT' and subject_type='MESSAGE')
  )
);

create table if not exists public.retention_subject_clocks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subject_type text not null default 'CONTACT' check (subject_type='CONTACT'),
  subject_id uuid not null,
  category text not null check (category in ('CONTACT_OUTREACH','SYNTHETIC_CONTACT')),
  anchor_at timestamptz not null,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  recorded_by uuid not null,
  superseded_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id,subject_id) references public.contacts(organization_id,id),
  unique (organization_id,id)
);
create unique index if not exists retention_subject_clock_current_unique
on public.retention_subject_clocks(organization_id,subject_type,subject_id,category)
where superseded_at is null;

create unique index if not exists retention_open_deletion_item_per_subject
on public.deletion_items(organization_id,subject_id)
where status in ('PENDING','ELIGIBLE','INELIGIBLE_RETENTION','BLOCKED_HOLD');

create table if not exists public.retention_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_id uuid,
  evaluated_at timestamptz not null,
  heartbeat_at timestamptz not null,
  status public.retention_reconciliation_status not null,
  candidate_count integer not null default 0 check (candidate_count>=0),
  held_count integer not null default 0 check (held_count>=0),
  unknown_count integer not null default 0 check (unknown_count>=0),
  item_count integer not null default 0 check (item_count>=0),
  batch_id uuid,
  manifest_sha256 text check (manifest_sha256 is null or manifest_sha256 ~ '^[a-f0-9]{64}$'),
  reason_code text check (reason_code is null or reason_code ~ '^[A-Z0-9_]{3,80}$'),
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id,policy_id) references public.retention_policy_versions(organization_id,id),
  foreign key (organization_id,batch_id) references public.deletion_batches(organization_id,id),
  unique (organization_id,id),
  unique (organization_id,idempotency_key)
);

create table if not exists public.retention_command_ledger (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  command_name text not null check (command_name ~ '^[a-z0-9_]{3,80}$'),
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  response_json jsonb,
  actor_user_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  primary key (organization_id,command_name,idempotency_key),
  check ((response_json is null)=(completed_at is null))
);

create table if not exists public.retention_provider_propagations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tombstone_id uuid not null,
  provider_code text not null check (provider_code in ('GMAIL','RESEND','SENTRY','CHECKLY','SUPABASE_BACKUP','STORAGE_BACKUP')),
  required boolean not null default true check (required),
  applicability_state text not null default 'REQUIRED' check (applicability_state='REQUIRED'),
  applicability_version text not null default 'M021_LOCAL_ALL_REQUIRED_V1' check (applicability_version='M021_LOCAL_ALL_REQUIRED_V1'),
  applicability_evidence_sha256 text not null default encode(digest('M021_LOCAL_ALL_REQUIRED_V1','sha256'),'hex') check (applicability_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  status public.retention_propagation_status not null default 'UNKNOWN',
  request_key text not null check (request_key ~ '^[a-f0-9]{64}$'),
  requested_at timestamptz,
  acknowledged_at timestamptz,
  evidence_sha256 text check (evidence_sha256 is null or evidence_sha256 ~ '^[a-f0-9]{64}$'),
  failure_code text check (failure_code is null or failure_code ~ '^[A-Z0-9_]{3,80}$'),
  updated_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id,tombstone_id) references public.deletion_tombstones(organization_id,id),
  unique (organization_id,id),
  unique (organization_id,tombstone_id,provider_code),
  unique (organization_id,request_key),
  check (
    (status in ('UNKNOWN','PENDING') and acknowledged_at is null and evidence_sha256 is null)
    or (status in ('ACKNOWLEDGED','NOT_APPLICABLE') and acknowledged_at is not null and evidence_sha256 is not null and failure_code is null)
    or (status='FAILED' and acknowledged_at is null and failure_code is not null)
  )
);

alter table public.retention_provider_propagations add column if not exists required boolean not null default true;
alter table public.retention_provider_propagations add column if not exists applicability_state text not null default 'REQUIRED';
alter table public.retention_provider_propagations add column if not exists applicability_version text not null default 'M021_LOCAL_ALL_REQUIRED_V1';
alter table public.retention_provider_propagations add column if not exists applicability_evidence_sha256 text not null default encode(digest('M021_LOCAL_ALL_REQUIRED_V1','sha256'),'hex');
alter table public.retention_provider_propagations drop constraint if exists retention_provider_required_snapshot_check;
alter table public.retention_provider_propagations add constraint retention_provider_required_snapshot_check check (
  required and applicability_state='REQUIRED' and applicability_version='M021_LOCAL_ALL_REQUIRED_V1'
  and applicability_evidence_sha256=encode(digest(applicability_version,'sha256'),'hex')
);

create table if not exists public.retention_restore_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_manifest_sha256 text not null check (source_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  status public.retention_reconciliation_status not null,
  evaluated_at timestamptz not null,
  entry_count integer not null check (entry_count>=0),
  reapplied_count integer not null check (reapplied_count>=0),
  already_applied_count integer not null check (already_applied_count>=0),
  unknown_count integer not null check (unknown_count>=0),
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  unique (organization_id,idempotency_key)
);

create table if not exists public.retention_restore_tombstone_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reconciliation_run_id uuid not null,
  subject_type text not null default 'CONTACT' check (subject_type='CONTACT'),
  subject_hash text not null check (subject_hash ~ '^[a-f0-9]{64}$'),
  deletion_evidence_sha256 text not null check (deletion_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  deleted_at timestamptz not null,
  result text not null check (result in ('REAPPLIED','ALREADY_APPLIED','UNKNOWN')),
  matched_subject_id uuid,
  reason_code text check (reason_code is null or reason_code ~ '^[A-Z0-9_]{3,80}$'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id,reconciliation_run_id) references public.retention_restore_reconciliation_runs(organization_id,id) on delete cascade,
  unique (organization_id,id),
  unique (organization_id,reconciliation_run_id,subject_hash)
);

alter table public.deletion_batches add column if not exists retention_policy_id uuid;
alter table public.deletion_batches add column if not exists reconciliation_run_id uuid;
alter table public.deletion_batches drop constraint if exists deletion_batches_retention_policy_tenant_fkey;
alter table public.deletion_batches add constraint deletion_batches_retention_policy_tenant_fkey
foreign key (organization_id,retention_policy_id) references public.retention_policy_versions(organization_id,id);

alter table public.qualification_evidence_links drop constraint if exists qualification_evidence_source_tenant_fkey;
alter table public.qualification_evidence_links add constraint qualification_evidence_source_tenant_fkey
foreign key (organization_id,source_evidence_id) references public.source_evidence(organization_id,id) on delete cascade;

create or replace function app.enforce_qualification_evidence_retention()
returns trigger language plpgsql set search_path=public,app,pg_temp as $$
begin
  if tg_op='UPDATE' then raise exception 'COMMERCIAL_INTEGRITY_APPEND_ONLY'; end if;
  if tg_op='DELETE' and (
    exists(select 1 from public.deletion_items di join public.deletion_batches db on db.organization_id=di.organization_id and db.id=di.batch_id
      join public.leads l on l.organization_id=old.organization_id and l.id=old.lead_id
      where di.organization_id=old.organization_id and di.subject_id=l.contact_id and di.status='ELIGIBLE' and db.status in ('APPROVED','IN_PROGRESS'))
    or (app.retention_internal_executor() and exists(select 1 from public.deletion_tombstones dt join public.leads l on l.organization_id=old.organization_id and l.id=old.lead_id
      where dt.organization_id=old.organization_id and dt.subject_hash=encode(digest(old.organization_id::text||':CONTACT:'||l.contact_id::text,'sha256'),'hex')))
  ) then return old; end if;
  raise exception 'COMMERCIAL_INTEGRITY_APPEND_ONLY';
end $$;
drop trigger if exists qualification_evidence_links_append_only on public.qualification_evidence_links;
create trigger qualification_evidence_links_append_only before update or delete on public.qualification_evidence_links
for each row execute function app.enforce_qualification_evidence_retention();

create or replace function app.retention_invoker_role()
returns text language sql stable set search_path=pg_catalog as $$
  select coalesce(nullif(current_setting('role',true),'none'),session_user)
$$;

create or replace function app.retention_now()
returns timestamptz language plpgsql volatile set search_path=pg_catalog as $$
declare injected text;
begin
  injected:=nullif(current_setting('app.retention_test_clock',true),'');
  if injected is not null
    and current_database() like '%retention_live_gate%'
    and app.retention_invoker_role() in ('service_role','supabase_admin')
  then return injected::timestamptz; end if;
  return clock_timestamp();
exception when others then return clock_timestamp();
end $$;

create or replace function app.retention_assert_admin(target_organization_id uuid)
returns void language plpgsql stable security definer set search_path=public,app,pg_temp as $$
begin
  if not app.has_role(target_organization_id,array['ennco_admin'::public.user_role,'teckel_admin'::public.user_role])
  then raise exception 'RETENTION_ADMIN_AAL2_REQUIRED'; end if;
end $$;

create or replace function app.retention_assert_service()
returns void language plpgsql stable security definer set search_path=pg_catalog,app as $$
begin
  if app.retention_invoker_role() not in ('service_role','supabase_admin')
  then raise exception 'RETENTION_SERVICE_ROLE_REQUIRED'; end if;
end $$;

create or replace function app.retention_internal_executor()
returns boolean language sql stable set search_path=pg_catalog as $$
  select current_user not in ('anon','authenticated','service_role')
    and pg_has_role(current_user,'pg_database_owner','USAGE')
$$;

create or replace function app.retention_request_sha(target_request jsonb)
returns text language sql immutable set search_path=app,extensions,public,pg_temp as $$
  select encode(digest(target_request::text,'sha256'),'hex')
$$;

create or replace function app.retention_command_begin(
  target_organization_id uuid,target_command_name text,target_idempotency_key text,target_request jsonb
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare wanted_sha text; stored public.retention_command_ledger%rowtype;
begin
  if target_idempotency_key !~ '^[a-f0-9]{64}$' then raise exception 'RETENTION_IDEMPOTENCY_KEY_INVALID'; end if;
  wanted_sha:=app.retention_request_sha(target_request);
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':retention-command:'||target_command_name||':'||target_idempotency_key,0));
  select * into stored from public.retention_command_ledger where organization_id=target_organization_id
    and command_name=target_command_name and idempotency_key=target_idempotency_key for update;
  if found then
    if stored.request_sha256<>wanted_sha then raise exception 'RETENTION_IDEMPOTENCY_DRIFT'; end if;
    if stored.response_json is null then raise exception 'RETENTION_COMMAND_IN_PROGRESS'; end if;
    return stored.response_json||jsonb_build_object('replayed',true);
  end if;
  insert into public.retention_command_ledger(organization_id,command_name,idempotency_key,request_sha256,actor_user_id)
  values(target_organization_id,target_command_name,target_idempotency_key,wanted_sha,auth.uid());
  return null;
end $$;

create or replace function app.retention_command_finish(
  target_organization_id uuid,target_command_name text,target_idempotency_key text,target_response jsonb
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
begin
  update public.retention_command_ledger set response_json=target_response,completed_at=app.retention_now()
  where organization_id=target_organization_id and command_name=target_command_name
    and idempotency_key=target_idempotency_key and response_json is null;
  if not found then raise exception 'RETENTION_COMMAND_FINISH_FAILED'; end if;
  return target_response||jsonb_build_object('replayed',false);
end $$;

create or replace function app.prevent_retention_direct_write()
returns trigger language plpgsql set search_path=public,app,pg_temp as $$
begin
  if not app.retention_internal_executor()
  then raise exception 'RETENTION_INTERNAL_EXECUTOR_REQUIRED'; end if;
  return coalesce(new,old);
end $$;

create or replace function app.retention_live_audit_snapshot(target_table text,snapshot jsonb)
returns jsonb language sql immutable set search_path=pg_catalog as $$
  select case
    when snapshot is null then null
    when target_table='retention_policy_versions' then jsonb_build_object('id',snapshot->'id','organization_id',snapshot->'organization_id','version',snapshot->'version','status',snapshot->'status','scope',snapshot->'scope','source_sha256',snapshot->'source_sha256','created_by',snapshot->'created_by','activated_by',snapshot->'activated_by','activated_at',snapshot->'activated_at','approval_evidence_sha256',snapshot->'approval_evidence_sha256')
    when target_table='retention_policy_rules' then jsonb_build_object('id',snapshot->'id','organization_id',snapshot->'organization_id','policy_id',snapshot->'policy_id','category',snapshot->'category','evidence_class',snapshot->'evidence_class','retention_days',snapshot->'retention_days','rule_state',snapshot->'rule_state')
    when target_table='retention_subject_clocks' then jsonb_build_object('id',snapshot->'id','organization_id',snapshot->'organization_id','subject_type',snapshot->'subject_type','subject_id',snapshot->'subject_id','category',snapshot->'category','anchor_at',snapshot->'anchor_at','evidence_sha256',snapshot->'evidence_sha256','recorded_by',snapshot->'recorded_by','superseded_at',snapshot->'superseded_at')
    when target_table='retention_reconciliation_runs' then jsonb_build_object('id',snapshot->'id','organization_id',snapshot->'organization_id','policy_id',snapshot->'policy_id','evaluated_at',snapshot->'evaluated_at','heartbeat_at',snapshot->'heartbeat_at','status',snapshot->'status','candidate_count',snapshot->'candidate_count','held_count',snapshot->'held_count','unknown_count',snapshot->'unknown_count','item_count',snapshot->'item_count','batch_id',snapshot->'batch_id','manifest_sha256',snapshot->'manifest_sha256','reason_code',snapshot->'reason_code')
    when target_table='retention_provider_propagations' then jsonb_build_object('id',snapshot->'id','organization_id',snapshot->'organization_id','tombstone_id',snapshot->'tombstone_id','provider_code',snapshot->'provider_code','required',snapshot->'required','applicability_state',snapshot->'applicability_state','applicability_version',snapshot->'applicability_version','applicability_evidence_sha256',snapshot->'applicability_evidence_sha256','status',snapshot->'status','request_key',snapshot->'request_key','requested_at',snapshot->'requested_at','acknowledged_at',snapshot->'acknowledged_at','evidence_sha256',snapshot->'evidence_sha256','failure_code',snapshot->'failure_code')
    when target_table='retention_restore_reconciliation_runs' then jsonb_build_object('id',snapshot->'id','organization_id',snapshot->'organization_id','source_manifest_sha256',snapshot->'source_manifest_sha256','status',snapshot->'status','evaluated_at',snapshot->'evaluated_at','entry_count',snapshot->'entry_count','reapplied_count',snapshot->'reapplied_count','already_applied_count',snapshot->'already_applied_count','unknown_count',snapshot->'unknown_count')
    when target_table='retention_restore_tombstone_entries' then jsonb_build_object('id',snapshot->'id','organization_id',snapshot->'organization_id','reconciliation_run_id',snapshot->'reconciliation_run_id','subject_type',snapshot->'subject_type','subject_hash',snapshot->'subject_hash','deletion_evidence_sha256',snapshot->'deletion_evidence_sha256','deleted_at',snapshot->'deleted_at','result',snapshot->'result','matched_subject_id',snapshot->'matched_subject_id','reason_code',snapshot->'reason_code')
    else jsonb_build_object('redaction','NO_RETENTION_LIVE_ALLOWLIST') end
$$;

create or replace function app.capture_retention_live_audit()
returns trigger language plpgsql security definer set search_path=public,app,pg_temp as $$
declare snapshot jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_log(organization_id,actor_user_id,action,record_type,record_id,old_data,new_data)
  values(nullif(snapshot->>'organization_id','')::uuid,auth.uid(),tg_op,tg_table_name,nullif(snapshot->>'id','')::uuid,
    case when tg_op in ('UPDATE','DELETE') then app.retention_live_audit_snapshot(tg_table_name,to_jsonb(old)) end,
    case when tg_op in ('INSERT','UPDATE') then app.retention_live_audit_snapshot(tg_table_name,to_jsonb(new)) end);
  return coalesce(new,old);
end $$;

create or replace function app.create_retention_policy(
  target_organization_id uuid,target_version integer,target_scope text,target_effective_from timestamptz,
  target_source_sha256 text,target_rules jsonb,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; policy_id uuid; rule jsonb; response jsonb;
begin
  perform app.retention_assert_admin(target_organization_id);
  if target_version<=0 or target_scope not in ('SYNTHETIC_LOCAL','LIVE') or target_source_sha256 !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(target_rules)<>'array' or jsonb_array_length(target_rules)=0 or jsonb_array_length(target_rules)>10
  then raise exception 'RETENTION_POLICY_INPUT_INVALID'; end if;
  replay:=app.retention_command_begin(target_organization_id,'create_retention_policy',target_idempotency_key,
    jsonb_build_object('version',target_version,'scope',target_scope,'effective_from',target_effective_from,'source_sha256',target_source_sha256,'rules',target_rules));
  if replay is not null then return replay; end if;
  insert into public.retention_policy_versions(organization_id,version,scope,effective_from,source_sha256,created_by)
  values(target_organization_id,target_version,target_scope,target_effective_from,target_source_sha256,auth.uid()) returning id into policy_id;
  for rule in select value from jsonb_array_elements(target_rules) loop
    if (rule->>'category') not in ('CONTACT_OUTREACH','SYNTHETIC_CONTACT','PREQUOTE_DOCUMENT','MESSAGE_CONTENT')
      or (rule->>'evidence_class') not in ('live','synthetic_demo')
      or (rule->>'rule_state') not in ('VERIFIED','UNKNOWN','BLOCKED_EXTERNAL')
      or coalesce((rule->>'retention_days')::integer,0) not between 1 and 3650
      or (rule->>'category'='SYNTHETIC_CONTACT' and ((rule->>'evidence_class')<>'synthetic_demo' or (rule->>'retention_days')::integer>30))
    then raise exception 'RETENTION_POLICY_RULE_INVALID'; end if;
    insert into public.retention_policy_rules(organization_id,policy_id,category,subject_type,evidence_class,retention_days,rule_state)
    values(target_organization_id,policy_id,rule->>'category',case rule->>'category' when 'PREQUOTE_DOCUMENT' then 'PREQUOTE_DOCUMENT' when 'MESSAGE_CONTENT' then 'MESSAGE' else 'CONTACT' end,(rule->>'evidence_class')::public.evidence_class,
      (rule->>'retention_days')::integer,(rule->>'rule_state')::public.retention_rule_state);
  end loop;
  response:=jsonb_build_object('status','DRAFT','policy_id',policy_id,'version',target_version,'scope',target_scope);
  return app.retention_command_finish(target_organization_id,'create_retention_policy',target_idempotency_key,response);
end $$;

create or replace function app.activate_retention_policy(
  target_organization_id uuid,target_policy_id uuid,target_approval_evidence_sha256 text,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; policy public.retention_policy_versions%rowtype; response jsonb;
begin
  perform app.retention_assert_admin(target_organization_id);
  if target_approval_evidence_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'RETENTION_POLICY_APPROVAL_EVIDENCE_INVALID'; end if;
  replay:=app.retention_command_begin(target_organization_id,'activate_retention_policy',target_idempotency_key,
    jsonb_build_object('policy_id',target_policy_id,'approval_evidence_sha256',target_approval_evidence_sha256));
  if replay is not null then return replay; end if;
  select * into policy from public.retention_policy_versions where organization_id=target_organization_id and id=target_policy_id for update;
  if not found or policy.status<>'DRAFT' then raise exception 'RETENTION_POLICY_NOT_DRAFT'; end if;
  if policy.created_by=auth.uid() then raise exception 'RETENTION_POLICY_FOUR_EYES_REQUIRED'; end if;
  if policy.scope<>'SYNTHETIC_LOCAL'
    or (select count(*) from public.retention_policy_rules where organization_id=target_organization_id and policy_id=policy.id)<>1
    or not exists(select 1 from public.retention_policy_rules where organization_id=target_organization_id and policy_id=policy.id and category='SYNTHETIC_CONTACT' and evidence_class='synthetic_demo' and retention_days<=30 and rule_state='VERIFIED')
    or exists(select 1 from public.retention_policy_rules where organization_id=target_organization_id and policy_id=policy.id and (category<>'SYNTHETIC_CONTACT' or rule_state<>'VERIFIED'))
  then
    response:=jsonb_build_object('status','UNKNOWN','policy_id',policy.id,'reason_code','LIVE_OR_INCOMPLETE_POLICY_BLOCKED_EXTERNAL');
    return app.retention_command_finish(target_organization_id,'activate_retention_policy',target_idempotency_key,response);
  end if;
  update public.retention_policy_versions set status='RETIRED',retired_at=app.retention_now()
  where organization_id=target_organization_id and status='ACTIVE';
  update public.retention_policy_versions set status='ACTIVE',activated_by=auth.uid(),activated_at=app.retention_now(),
    approval_evidence_sha256=target_approval_evidence_sha256
  where organization_id=target_organization_id and id=policy.id;
  insert into public.event_outbox(organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json)
  values(target_organization_id,'retention_policy',policy.id,'retention.policy.activated','retention-policy-activated:'||policy.id,
    jsonb_build_object('policy_id',policy.id,'version',policy.version,'scope',policy.scope,'approval_evidence_sha256',target_approval_evidence_sha256)) on conflict do nothing;
  response:=jsonb_build_object('status','ACTIVE','policy_id',policy.id,'version',policy.version,'scope',policy.scope,'approval_evidence_sha256',target_approval_evidence_sha256);
  return app.retention_command_finish(target_organization_id,'activate_retention_policy',target_idempotency_key,response);
end $$;

create or replace function app.create_retention_legal_hold(
  target_organization_id uuid,target_contact_id uuid,target_reason public.legal_hold_reason_code,
  target_evidence_sha256 text,target_review_due_at timestamptz,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; hold_id uuid; response jsonb;
begin
  perform app.retention_assert_admin(target_organization_id);
  if target_evidence_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'RETENTION_HOLD_EVIDENCE_INVALID'; end if;
  if target_review_due_at is null or target_review_due_at<=app.retention_now() or target_review_due_at>app.retention_now()+interval '90 days'
  then raise exception 'RETENTION_HOLD_REVIEW_DUE_INVALID'; end if;
  replay:=app.retention_command_begin(target_organization_id,'create_retention_legal_hold',target_idempotency_key,
    jsonb_build_object('contact_id',target_contact_id,'reason',target_reason,'evidence_sha256',target_evidence_sha256,'review_due_at',target_review_due_at));
  if replay is not null then return replay; end if;
  insert into public.legal_holds(organization_id,subject_id,reason_code,evidence_sha256,effective_at,review_due_at,created_by)
  values(target_organization_id,target_contact_id,target_reason,target_evidence_sha256,app.retention_now(),target_review_due_at,auth.uid()) returning id into hold_id;
  response:=jsonb_build_object('status','ACTIVE','hold_id',hold_id,'contact_id',target_contact_id);
  return app.retention_command_finish(target_organization_id,'create_retention_legal_hold',target_idempotency_key,response);
end $$;

create or replace function app.release_retention_legal_hold(
  target_organization_id uuid,target_hold_id uuid,target_release_evidence_sha256 text,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; hold public.legal_holds%rowtype; response jsonb;
begin
  perform app.retention_assert_admin(target_organization_id);
  if target_release_evidence_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'RETENTION_HOLD_RELEASE_EVIDENCE_INVALID'; end if;
  replay:=app.retention_command_begin(target_organization_id,'release_retention_legal_hold',target_idempotency_key,
    jsonb_build_object('hold_id',target_hold_id,'release_evidence_sha256',target_release_evidence_sha256));
  if replay is not null then return replay; end if;
  select * into hold from public.legal_holds where organization_id=target_organization_id and id=target_hold_id for update;
  if not found or hold.status<>'ACTIVE' then raise exception 'RETENTION_HOLD_NOT_ACTIVE'; end if;
  if hold.created_by=auth.uid() then raise exception 'RETENTION_HOLD_RELEASE_FOUR_EYES_REQUIRED'; end if;
  update public.legal_holds set status='RELEASED',released_by=auth.uid(),released_at=app.retention_now(),release_evidence_sha256=target_release_evidence_sha256
  where organization_id=target_organization_id and id=target_hold_id;
  response:=jsonb_build_object('status','RELEASED','hold_id',target_hold_id);
  return app.retention_command_finish(target_organization_id,'release_retention_legal_hold',target_idempotency_key,response);
end $$;

create or replace function app.record_retention_subject_clock(
  target_organization_id uuid,target_contact_id uuid,target_category text,target_anchor_at timestamptz,
  target_evidence_sha256 text,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; clock_id uuid; response jsonb; now_value timestamptz:=app.retention_now(); current_clock public.retention_subject_clocks%rowtype;
begin
  perform app.retention_assert_service();
  if target_category not in ('CONTACT_OUTREACH','SYNTHETIC_CONTACT') or target_evidence_sha256 !~ '^[a-f0-9]{64}$'
    or target_anchor_at>now_value+interval '5 minutes' then raise exception 'RETENTION_CLOCK_INPUT_INVALID'; end if;
  if not exists(select 1 from public.contacts where organization_id=target_organization_id and id=target_contact_id and not is_deleted)
  then raise exception 'RETENTION_CLOCK_CONTACT_NOT_FOUND'; end if;
  replay:=app.retention_command_begin(target_organization_id,'record_retention_subject_clock',target_idempotency_key,
    jsonb_build_object('contact_id',target_contact_id,'category',target_category,'anchor_at',target_anchor_at,'evidence_sha256',target_evidence_sha256));
  if replay is not null then return replay; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':retention-clock:'||target_contact_id::text||':'||target_category,0));
  select * into current_clock from public.retention_subject_clocks
  where organization_id=target_organization_id and subject_id=target_contact_id and category=target_category and superseded_at is null for update;
  if found then
    if target_anchor_at<current_clock.anchor_at then raise exception 'RETENTION_CLOCK_REGRESSION'; end if;
    if target_anchor_at=current_clock.anchor_at then
      if target_evidence_sha256<>current_clock.evidence_sha256 then raise exception 'RETENTION_CLOCK_EVIDENCE_DRIFT'; end if;
      response:=jsonb_build_object('status','UNCHANGED','clock_id',current_clock.id,'contact_id',target_contact_id,'anchor_at',current_clock.anchor_at);
      return app.retention_command_finish(target_organization_id,'record_retention_subject_clock',target_idempotency_key,response);
    end if;
  end if;
  update public.retention_subject_clocks set superseded_at=now_value where organization_id=target_organization_id and subject_id=target_contact_id and category=target_category and superseded_at is null;
  insert into public.retention_subject_clocks(organization_id,subject_id,category,anchor_at,evidence_sha256,recorded_by)
  values(target_organization_id,target_contact_id,target_category,target_anchor_at,target_evidence_sha256,coalesce(auth.uid(),'00000000-0000-0000-0000-000000000000')) returning id into clock_id;
  response:=jsonb_build_object('status','RECORDED','clock_id',clock_id,'contact_id',target_contact_id,'anchor_at',target_anchor_at);
  return app.retention_command_finish(target_organization_id,'record_retention_subject_clock',target_idempotency_key,response);
end $$;

create or replace function app.run_retention_reconciler(target_organization_id uuid,target_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; policy public.retention_policy_versions%rowtype; run_id uuid:=gen_random_uuid(); batch_id uuid; now_value timestamptz:=app.retention_now();
  candidates uuid[]:='{}'; candidate_hashes text[]:='{}'; contact_id uuid; rule_record record; candidate_count integer:=0; held_count integer:=0; unknown_count integer:=0; item_count integer:=0;
  manifest_sha text; response jsonb; requester uuid; run_status public.retention_reconciliation_status:='HEALTHY';
begin
  perform app.retention_assert_service();
  replay:=app.retention_command_begin(target_organization_id,'run_retention_reconciler',target_idempotency_key,jsonb_build_object('clock','CANONICAL'));
  if replay is not null then return replay; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':retention-reconciler',0));
  select * into policy from public.retention_policy_versions where organization_id=target_organization_id and status='ACTIVE' and effective_from<=now_value for update;
  if not found or policy.scope<>'SYNTHETIC_LOCAL' then
    run_status:='UNKNOWN'; unknown_count:=1;
    insert into public.retention_reconciliation_runs(id,organization_id,evaluated_at,heartbeat_at,status,unknown_count,reason_code,idempotency_key)
    values(run_id,target_organization_id,now_value,now_value,run_status,unknown_count,'ACTIVE_LOCAL_POLICY_MISSING',target_idempotency_key);
    response:=jsonb_build_object('status','UNKNOWN','run_id',run_id,'batch_id',null,'candidate_count',0,'held_count',0,'unknown_count',1,'item_count',0,'reason_code','ACTIVE_LOCAL_POLICY_MISSING','heartbeat_at',now_value);
    return app.retention_command_finish(target_organization_id,'run_retention_reconciler',target_idempotency_key,response);
  end if;
  if exists(select 1 from public.retention_policy_rules where organization_id=target_organization_id and policy_id=policy.id and rule_state<>'VERIFIED') then
    insert into public.retention_reconciliation_runs(id,organization_id,policy_id,evaluated_at,heartbeat_at,status,unknown_count,reason_code,idempotency_key)
    values(run_id,target_organization_id,policy.id,now_value,now_value,'UNKNOWN',1,'POLICY_RULE_UNKNOWN',target_idempotency_key);
    response:=jsonb_build_object('status','UNKNOWN','run_id',run_id,'batch_id',null,'policy_id',policy.id,'candidate_count',0,'held_count',0,'unknown_count',1,'item_count',0,'reason_code','POLICY_RULE_UNKNOWN','heartbeat_at',now_value);
    return app.retention_command_finish(target_organization_id,'run_retention_reconciler',target_idempotency_key,response);
  end if;
  for rule_record in select * from public.retention_policy_rules where organization_id=target_organization_id and policy_id=policy.id and rule_state='VERIFIED' and category='SYNTHETIC_CONTACT' and subject_type='CONTACT' loop
    for contact_id in
      select c.id from public.contacts c join public.accounts a on a.organization_id=c.organization_id and a.id=c.account_id
      join public.retention_subject_clocks sc on sc.organization_id=c.organization_id and sc.subject_id=c.id and sc.subject_type='CONTACT' and sc.category=rule_record.category and sc.superseded_at is null
      where c.organization_id=target_organization_id and a.evidence_class=rule_record.evidence_class and not c.is_deleted
        and sc.anchor_at+(rule_record.retention_days||' days')::interval<=now_value
        and not exists(select 1 from public.deletion_tombstones dt where dt.organization_id=c.organization_id and dt.subject_hash=encode(digest(c.organization_id::text||':CONTACT:'||c.id::text,'sha256'),'hex'))
        and not exists(select 1 from public.deletion_items di where di.organization_id=c.organization_id and di.subject_id=c.id and di.status in ('PENDING','ELIGIBLE','INELIGIBLE_RETENTION','BLOCKED_HOLD'))
      order by c.id for update of c
    loop
      candidate_count:=candidate_count+1;
      perform pg_advisory_xact_lock(hashtextextended('legal-hold:'||target_organization_id::text||':'||contact_id::text,0));
      if app.is_contact_under_legal_hold(target_organization_id,contact_id) then held_count:=held_count+1; continue; end if;
      candidates:=array_append(candidates,contact_id);
      candidate_hashes:=array_append(candidate_hashes,encode(digest(target_organization_id::text||':CONTACT:'||contact_id::text,'sha256'),'hex'));
    end loop;
  end loop;
  select coalesce((select user_id from public.organization_users where organization_id=target_organization_id and active and role in ('teckel_admin','ennco_admin') order by case role when 'teckel_admin' then 0 else 1 end,user_id limit 1),policy.created_by) into requester;
  if cardinality(candidates)>0 then
    select encode(digest(string_agg(x,E'\n' order by x),'sha256'),'hex') into manifest_sha from unnest(candidate_hashes) x;
    insert into public.deletion_batches(organization_id,status,reason_code,evidence_class,input_manifest_sha256,requested_by,retention_policy_id,reconciliation_run_id)
    values(target_organization_id,'DRAFT','RETENTION_EXPIRED','synthetic_demo',manifest_sha,requester,policy.id,run_id) returning id into batch_id;
    foreach contact_id in array candidates loop
      perform app.create_contact_deletion_item(batch_id,contact_id,(select sc.anchor_at+(r.retention_days||' days')::interval from public.retention_subject_clocks sc join public.retention_policy_rules r on r.organization_id=sc.organization_id and r.policy_id=policy.id and r.category=sc.category where sc.organization_id=target_organization_id and sc.subject_id=contact_id and sc.superseded_at is null limit 1));
      item_count:=item_count+1;
    end loop;
  end if;
  if unknown_count>0 then run_status:='UNKNOWN'; elsif held_count>0 then run_status:='DEGRADED'; end if;
  insert into public.retention_reconciliation_runs(id,organization_id,policy_id,evaluated_at,heartbeat_at,status,candidate_count,held_count,unknown_count,item_count,batch_id,manifest_sha256,reason_code,idempotency_key)
  values(run_id,target_organization_id,policy.id,now_value,now_value,run_status,candidate_count,held_count,unknown_count,item_count,batch_id,manifest_sha,case when unknown_count>0 then 'POLICY_RULE_UNKNOWN' when held_count>0 then 'LEGAL_HOLD_BLOCKED' end,target_idempotency_key);
  if batch_id is not null then
    insert into public.event_outbox(organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json)
    values(target_organization_id,'deletion_batch',batch_id,'retention.batch.approval_required','retention-batch-approval:'||batch_id,
      jsonb_build_object('batch_id',batch_id,'policy_id',policy.id,'item_count',item_count,'manifest_sha256',manifest_sha)) on conflict do nothing;
  end if;
  response:=jsonb_build_object('status',run_status,'run_id',run_id,'batch_id',batch_id,'policy_id',policy.id,'candidate_count',candidate_count,'held_count',held_count,'unknown_count',unknown_count,'item_count',item_count,'manifest_sha256',manifest_sha,'heartbeat_at',now_value);
  return app.retention_command_finish(target_organization_id,'run_retention_reconciler',target_idempotency_key,response);
end $$;

create or replace function app.approve_retention_batch(
  target_organization_id uuid,target_batch_id uuid,target_manifest_sha256 text,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; batch public.deletion_batches%rowtype; response jsonb; item_count integer; item_manifest text;
begin
  perform app.retention_assert_admin(target_organization_id);
  if target_manifest_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'RETENTION_BATCH_MANIFEST_INVALID'; end if;
  replay:=app.retention_command_begin(target_organization_id,'approve_retention_batch',target_idempotency_key,
    jsonb_build_object('batch_id',target_batch_id,'manifest_sha256',target_manifest_sha256)); if replay is not null then return replay; end if;
  select * into batch from public.deletion_batches where organization_id=target_organization_id and id=target_batch_id for update;
  if not found or batch.status<>'DRAFT' then raise exception 'RETENTION_BATCH_NOT_DRAFT'; end if;
  if batch.input_manifest_sha256<>target_manifest_sha256 then raise exception 'RETENTION_BATCH_MANIFEST_MISMATCH'; end if;
  if batch.requested_by=auth.uid() then raise exception 'RETENTION_BATCH_FOUR_EYES_REQUIRED'; end if;
  select count(*),encode(digest(coalesce(string_agg(
    di.subject_hash||':'||extract(epoch from di.retention_due_at)::numeric(20,6)::text,
    E'\n' order by di.subject_hash,di.retention_due_at,di.id),''),'sha256'),'hex')
  into item_count,item_manifest from public.deletion_items di
  where di.organization_id=target_organization_id and di.batch_id=batch.id;
  if item_count<1 then raise exception 'DELETION_BATCH_ITEMS_REQUIRED_BEFORE_APPROVAL'; end if;
  update public.deletion_batches set status='APPROVED',approved_by=auth.uid(),approved_at=app.retention_now(),
    approved_item_count=item_count,approved_items_sha256=item_manifest where id=batch.id;
  response:=jsonb_build_object('status','APPROVED','batch_id',batch.id,'manifest_sha256',batch.input_manifest_sha256);
  return app.retention_command_finish(target_organization_id,'approve_retention_batch',target_idempotency_key,response);
end $$;

create or replace function app.execute_retention_batch(
  target_organization_id uuid,target_batch_id uuid,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; batch public.deletion_batches%rowtype; item record; executed_count integer:=0; held_count integer:=0; failed_count integer:=0; assessed public.deletion_item_status; response jsonb;
begin
  perform app.retention_assert_service();
  replay:=app.retention_command_begin(target_organization_id,'execute_retention_batch',target_idempotency_key,jsonb_build_object('batch_id',target_batch_id)); if replay is not null then return replay; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':retention-batch-execute:'||target_batch_id::text,0));
  select * into batch from public.deletion_batches where organization_id=target_organization_id and id=target_batch_id for update;
  if not found or batch.status not in ('APPROVED','IN_PROGRESS') then raise exception 'RETENTION_BATCH_NOT_APPROVED'; end if;
  perform set_config('app.research_rpc_write','true',true);
  for item in select id from public.deletion_items where organization_id=target_organization_id and batch_id=batch.id and status in ('PENDING','INELIGIBLE_RETENTION','BLOCKED_HOLD') order by id for update skip locked loop
    assessed:=app.assess_contact_deletion(item.id);
    if assessed='ELIGIBLE' then
      if app.execute_contact_deletion(item.id) then executed_count:=executed_count+1;
      elsif (select status from public.deletion_items where id=item.id)='FAILED' then failed_count:=failed_count+1;
      else held_count:=held_count+1; end if;
    elsif assessed='BLOCKED_HOLD' then held_count:=held_count+1;
    elsif assessed='INELIGIBLE_RETENTION' then failed_count:=failed_count+1; end if;
  end loop;
  response:=jsonb_build_object('status',case when failed_count>0 then 'UNKNOWN' when held_count>0 then 'DEGRADED' else 'PROPAGATION_PENDING' end,
    'batch_id',batch.id,'executed_count',executed_count,'held_count',held_count,'failed_count',failed_count,
    'completion_state','HOLD','reason_code',case when failed_count>0 then 'RETENTION_EXECUTION_UNKNOWN' else 'REQUIRED_PROPAGATION_UNCONFIRMED' end);
  return app.retention_command_finish(target_organization_id,'execute_retention_batch',target_idempotency_key,response);
end $$;

create or replace function app.enforce_retention_batch_completion()
returns trigger language plpgsql security definer set search_path=public,app,pg_temp as $$
begin
  if new.status='COMPLETED' and old.status is distinct from new.status and (
    exists(select 1 from public.deletion_items i where i.organization_id=new.organization_id and i.batch_id=new.id and i.status<>'EXECUTED')
    or exists(
      select 1 from public.deletion_items i
      left join public.deletion_tombstones t on t.organization_id=i.organization_id and t.deletion_item_id=i.id
      where i.organization_id=new.organization_id and i.batch_id=new.id and (t.id is null
        or (select count(*) from public.retention_provider_propagations p where p.organization_id=t.organization_id and p.tombstone_id=t.id)<>6
        or not exists(select 1 from public.retention_provider_propagations p where p.organization_id=t.organization_id and p.tombstone_id=t.id and p.provider_code='STORAGE_BACKUP' and p.status='ACKNOWLEDGED')
        or exists(select 1 from public.retention_provider_propagations p where p.organization_id=t.organization_id and p.tombstone_id=t.id and (not p.required or p.applicability_state<>'REQUIRED' or p.status<>'ACKNOWLEDGED')))
    )
  ) then
    new.status:='IN_PROGRESS';
    new.completed_at:=null;
  end if;
  return new;
end $$;
drop trigger if exists deletion_batches_zz_retention_completion_gate on public.deletion_batches;
create trigger deletion_batches_zz_retention_completion_gate before update of status on public.deletion_batches
for each row execute function app.enforce_retention_batch_completion();

create or replace function app.finalize_retention_batch(
  target_organization_id uuid,target_batch_id uuid,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; batch public.deletion_batches%rowtype; response jsonb; pending integer;
begin
  perform app.retention_assert_service();
  replay:=app.retention_command_begin(target_organization_id,'finalize_retention_batch',target_idempotency_key,jsonb_build_object('batch_id',target_batch_id));
  if replay is not null then return replay; end if;
  select * into batch from public.deletion_batches where organization_id=target_organization_id and id=target_batch_id for update;
  if not found or batch.status not in ('IN_PROGRESS','APPROVED') then raise exception 'RETENTION_BATCH_NOT_FINALIZABLE'; end if;
  select count(*) into pending from public.deletion_items i
  left join public.deletion_tombstones t on t.organization_id=i.organization_id and t.deletion_item_id=i.id
  where i.organization_id=target_organization_id and i.batch_id=target_batch_id and (i.status<>'EXECUTED' or t.id is null
    or (select count(*) from public.retention_provider_propagations p where p.organization_id=t.organization_id and p.tombstone_id=t.id)<>6
    or not exists(select 1 from public.retention_provider_propagations p where p.organization_id=t.organization_id and p.tombstone_id=t.id and p.provider_code='STORAGE_BACKUP' and p.status='ACKNOWLEDGED')
    or exists(select 1 from public.retention_provider_propagations p where p.organization_id=t.organization_id and p.tombstone_id=t.id and (not p.required or p.applicability_state<>'REQUIRED' or p.status<>'ACKNOWLEDGED')));
  if pending>0 then
    response:=jsonb_build_object('status','HOLD','batch_id',target_batch_id,'pending_items',pending,'reason_code','REQUIRED_PROPAGATION_UNCONFIRMED');
    return app.retention_command_finish(target_organization_id,'finalize_retention_batch',target_idempotency_key,response);
  end if;
  update public.deletion_batches set status='COMPLETED',completed_at=app.retention_now() where organization_id=target_organization_id and id=target_batch_id;
  if (select status from public.deletion_batches where organization_id=target_organization_id and id=target_batch_id)<>'COMPLETED' then raise exception 'RETENTION_BATCH_COMPLETION_FAIL_CLOSED'; end if;
  insert into public.event_outbox(organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json)
  values(target_organization_id,'deletion_batch',target_batch_id,'retention.batch.completed','retention-batch-completed:'||target_batch_id,jsonb_build_object('batch_id',target_batch_id,'required_propagations','CONFIRMED')) on conflict do nothing;
  response:=jsonb_build_object('status','COMPLETED','batch_id',target_batch_id,'pending_items',0);
  return app.retention_command_finish(target_organization_id,'finalize_retention_batch',target_idempotency_key,response);
end $$;

create or replace function app.create_retention_provider_ledger()
returns trigger language plpgsql security definer set search_path=public,app,pg_temp as $$
declare provider text;
begin
  foreach provider in array array['GMAIL','RESEND','SENTRY','CHECKLY','SUPABASE_BACKUP','STORAGE_BACKUP'] loop
    insert into public.retention_provider_propagations(organization_id,tombstone_id,provider_code,required,applicability_state,applicability_version,applicability_evidence_sha256,status,request_key)
    values(new.organization_id,new.id,provider,true,'REQUIRED','M021_LOCAL_ALL_REQUIRED_V1',encode(digest('M021_LOCAL_ALL_REQUIRED_V1','sha256'),'hex'),'UNKNOWN',encode(digest(new.organization_id::text||':'||new.id::text||':'||provider,'sha256'),'hex')) on conflict do nothing;
  end loop;
  insert into public.event_outbox(organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json)
  values(new.organization_id,'deletion_tombstone',new.id,'retention.propagation.unknown','retention-propagation-unknown:'||new.id,
    jsonb_build_object('tombstone_id',new.id,'required_provider_count',6,'provider_state','UNKNOWN')) on conflict do nothing;
  return new;
end $$;
drop trigger if exists deletion_tombstones_provider_ledger on public.deletion_tombstones;
create trigger deletion_tombstones_provider_ledger after insert on public.deletion_tombstones for each row execute function app.create_retention_provider_ledger();

create or replace function app.record_retention_provider_propagation(
  target_organization_id uuid,target_propagation_id uuid,target_status text,target_evidence_sha256 text,target_failure_code text,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; row_record public.retention_provider_propagations%rowtype; response jsonb;
begin
  perform app.retention_assert_service();
  if target_status not in ('ACKNOWLEDGED','FAILED')
    or (target_status='ACKNOWLEDGED' and target_evidence_sha256 !~ '^[a-f0-9]{64}$')
    or (target_status='FAILED' and coalesce(target_failure_code,'') !~ '^[A-Z0-9_]{3,80}$')
  then raise exception 'RETENTION_PROPAGATION_INPUT_INVALID'; end if;
  replay:=app.retention_command_begin(target_organization_id,'record_retention_provider_propagation',target_idempotency_key,
    jsonb_build_object('propagation_id',target_propagation_id,'status',target_status,'evidence_sha256',target_evidence_sha256,'failure_code',target_failure_code)); if replay is not null then return replay; end if;
  select * into row_record from public.retention_provider_propagations where organization_id=target_organization_id and id=target_propagation_id for update;
  if not found then raise exception 'RETENTION_PROPAGATION_NOT_FOUND'; end if;
  if not row_record.required or row_record.applicability_state<>'REQUIRED'
    or row_record.applicability_evidence_sha256<>encode(digest(row_record.applicability_version,'sha256'),'hex')
  then raise exception 'RETENTION_PROPAGATION_APPLICABILITY_UNKNOWN'; end if;
  if row_record.status='ACKNOWLEDGED' then raise exception 'RETENTION_PROPAGATION_TERMINAL'; end if;
  update public.retention_provider_propagations set status=target_status::public.retention_propagation_status,
    requested_at=coalesce(requested_at,app.retention_now()),acknowledged_at=case when target_status='ACKNOWLEDGED' then app.retention_now() end,
    evidence_sha256=case when target_status='ACKNOWLEDGED' then target_evidence_sha256 end,
    failure_code=case when target_status='FAILED' then target_failure_code end,updated_at=app.retention_now()
  where organization_id=target_organization_id and id=target_propagation_id;
  response:=jsonb_build_object('status',target_status,'propagation_id',target_propagation_id,'provider_code',row_record.provider_code);
  return app.retention_command_finish(target_organization_id,'record_retention_provider_propagation',target_idempotency_key,response);
end $$;

create or replace function app.enforce_source_evidence_append_only()
returns trigger language plpgsql set search_path=public,app,pg_temp as $$
declare resolved_contact_id uuid;
begin
  if tg_op='UPDATE' and app.retention_internal_executor()
    and (to_jsonb(new)-array['source_url','source_name','value_json','checksum'])=(to_jsonb(old)-array['source_url','source_name','value_json','checksum'])
    and new.source_url='https://retention.invalid/redacted' and new.source_name='RETENTION_REDACTED' and lower(new.field_name)='first_payment_mxn'
    and new.value_json=jsonb_build_object('amount_mxn',old.value_json->'amount_mxn','paid_at',old.value_json->'paid_at')
    and exists(select 1 from public.payments p join public.opportunities o on o.organization_id=p.organization_id and o.id=p.opportunity_id
      join public.leads l on l.organization_id=o.organization_id and l.id=o.lead_id join public.deletion_tombstones dt on dt.organization_id=l.organization_id
        and dt.subject_hash=encode(digest(l.organization_id::text||':CONTACT:'||l.contact_id::text,'sha256'),'hex')
      where p.organization_id=old.organization_id and p.evidence_record_id=old.id)
  then return new; end if;
  if tg_op='UPDATE' then raise exception 'SOURCE_EVIDENCE_APPEND_ONLY'; end if;
  if tg_op='DELETE' and app.retention_internal_executor() then
    if lower(old.subject_type)='contact' then resolved_contact_id:=old.subject_id;
    elsif lower(old.subject_type)='lead' then select contact_id into resolved_contact_id from public.leads where organization_id=old.organization_id and id=old.subject_id;
    elsif lower(old.subject_type)='message' then select contact_id into resolved_contact_id from public.messages where organization_id=old.organization_id and id=old.subject_id;
    elsif lower(old.subject_type)='prequote' then select contact_id into resolved_contact_id from public.leads where organization_id=old.organization_id and prequote_id=old.subject_id order by id limit 1;
    elsif lower(old.subject_type)='opportunity' then select l.contact_id into resolved_contact_id from public.opportunities o join public.leads l on l.organization_id=o.organization_id and l.id=o.lead_id where o.organization_id=old.organization_id and o.id=old.subject_id;
    end if;
    if resolved_contact_id is not null and exists(select 1 from public.deletion_tombstones dt where dt.organization_id=old.organization_id
      and dt.subject_hash=encode(digest(old.organization_id::text||':CONTACT:'||resolved_contact_id::text,'sha256'),'hex'))
    then return old; end if;
  end if;
  if tg_op='DELETE' and not (
    lower(old.subject_type)='contact' and (
      exists(select 1 from public.deletion_items di join public.deletion_batches db on db.organization_id=di.organization_id and db.id=di.batch_id
        where di.organization_id=old.organization_id and di.subject_id=old.subject_id and di.subject_type='CONTACT'
          and di.status='ELIGIBLE' and db.status in ('APPROVED','IN_PROGRESS'))
      or (app.retention_internal_executor() and exists(select 1 from public.deletion_tombstones dt
        where dt.organization_id=old.organization_id and dt.subject_hash=encode(digest(old.organization_id::text||':CONTACT:'||old.subject_id::text,'sha256'),'hex')))
    )
  ) then raise exception 'SOURCE_EVIDENCE_APPEND_ONLY'; end if;
  return old;
end $$;

create or replace function app.enforce_research_rpc_write()
returns trigger language plpgsql set search_path=public,app,pg_temp as $$
declare org_id uuid:=case when tg_op='DELETE' then old.organization_id else new.organization_id end;
declare candidate_ids uuid[]; contact_id uuid;
begin
  if tg_op='DELETE' and tg_table_name in ('research_contact_candidates','research_evidence_records','research_reviews','research_dedupe_cases','research_dedupe_decisions')
    and app.retention_internal_executor()
  then
    if tg_table_name='research_contact_candidates' then
      candidate_ids:=array[old.id];
    elsif tg_table_name='research_evidence_records' then
      if old.subject_type='CONTACT_CANDIDATE' then candidate_ids:=array[old.subject_id]; else candidate_ids:='{}'::uuid[]; end if;
    elsif tg_table_name='research_reviews' then
      if old.subject_type='CONTACT_CANDIDATE' then candidate_ids:=array[old.subject_id]; else candidate_ids:='{}'::uuid[]; end if;
    elsif tg_table_name='research_dedupe_cases' then
      candidate_ids:=array_remove(array[old.candidate_contact_id,old.matched_candidate_id],null);
    elsif tg_table_name='research_dedupe_decisions' then
      select array_remove(array[dc.candidate_contact_id,dc.matched_candidate_id],null) into candidate_ids
      from public.research_dedupe_cases dc where dc.organization_id=old.organization_id and dc.id=old.dedupe_case_id;
    else candidate_ids:='{}'::uuid[];
    end if;
    if exists(select 1 from public.research_contact_candidates rc join public.deletion_tombstones dt on dt.organization_id=rc.organization_id
      and dt.subject_hash=encode(digest(rc.organization_id::text||':CONTACT:'||rc.promoted_contact_id::text,'sha256'),'hex')
      where rc.organization_id=org_id and rc.id=any(candidate_ids) and rc.promoted_contact_id is not null)
    then return old; end if;
    raise exception 'RESEARCH_RETENTION_TOMBSTONE_REQUIRED';
  end if;
  if current_setting('app.research_rpc_write',true) is distinct from 'true' then raise exception 'RESEARCH_RPC_WRITE_REQUIRED'; end if;
  if tg_argv[0]='APPEND_ONLY' and tg_op<>'INSERT' then raise exception 'RESEARCH_APPEND_ONLY_RECORD'; end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

create or replace function app.prevent_audit_mutation()
returns trigger language plpgsql set search_path=public,app,pg_temp as $$
begin
  if tg_op='UPDATE' and app.retention_internal_executor() then return new; end if;
  raise exception 'AUDIT_LOG_APPEND_ONLY';
end $$;

create or replace function app.enforce_approval_append_only()
returns trigger language plpgsql set search_path=public,app,pg_temp as $$
declare actor_id uuid;
begin
  if tg_op='UPDATE' and app.retention_internal_executor()
    and old.subject_type='opportunity_closed_won'
    and (to_jsonb(new)-'rationale')=(to_jsonb(old)-'rationale')
    and (new.rationale is null or new.rationale='RETENTION_REDACTED')
    and exists(select 1 from public.opportunities o join public.leads l on l.organization_id=o.organization_id and l.id=o.lead_id
      join public.deletion_tombstones dt on dt.organization_id=o.organization_id
        and dt.subject_hash=encode(digest(o.organization_id::text||':CONTACT:'||l.contact_id::text,'sha256'),'hex')
      where o.organization_id=old.organization_id and o.id=old.subject_id)
  then return new; end if;
  if tg_op<>'INSERT' then raise exception 'APPROVAL_APPEND_ONLY'; end if;
  actor_id:=auth.uid();
  if actor_id is not null and new.decided_by<>actor_id then raise exception 'APPROVAL_ACTOR_MISMATCH'; end if;
  if new.subject_type in ('campaign_first_send_release','rollout_wave_release','contractual_monthly_report_issue','recovery_experiment_release') and (
    actor_id is null or not app.has_role(new.organization_id,array['teckel_admin'::public.user_role]))
  then raise exception 'CONTROLLED_RELEASE_APPROVAL_JORGE_ONLY'; end if;
  if new.subject_type='final_handoff_acceptance' and (actor_id is null or not app.has_role(new.organization_id,array['ennco_admin'::public.user_role]))
  then raise exception 'HANDOFF_ACCEPTANCE_ENNCO_ADMIN_REQUIRED'; end if;
  if new.subject_type='opportunity_closed_won' and (actor_id is null or not app.has_role(new.organization_id,array['ennco_admin'::public.user_role,'teckel_admin'::public.user_role])
    or not exists(select 1 from public.opportunities where organization_id=new.organization_id and id=new.subject_id))
  then raise exception 'CLOSED_WON_APPROVAL_ADMIN_REQUIRED'; end if;
  return new;
end $$;

create or replace function app.enforce_first_send_enrollment_integrity()
returns trigger language plpgsql set search_path=public,app,pg_temp as $$
begin
  if tg_op='UPDATE' and app.retention_internal_executor()
    and (to_jsonb(new)-'contact_email_sha256')=(to_jsonb(old)-'contact_email_sha256')
    and new.contact_email_sha256=encode(digest('RETENTION:'||encode(digest(old.organization_id::text||':CONTACT:'||old.contact_id::text,'sha256'),'hex')||':FIRST_SEND:'||old.id::text,'sha256'),'hex')
    and exists(select 1 from public.deletion_tombstones dt where dt.organization_id=old.organization_id
      and dt.subject_hash=encode(digest(old.organization_id::text||':CONTACT:'||old.contact_id::text,'sha256'),'hex'))
  then return new; end if;
  if tg_op<>'INSERT' then raise exception 'FIRST_SEND_RECIPIENT_SET_IMMUTABLE'; end if;
  if not exists(select 1 from public.first_send_batches b join public.campaign_enrollments ce on ce.id=new.enrollment_id and ce.organization_id=new.organization_id
    join public.contacts c on c.id=ce.contact_id and c.organization_id=ce.organization_id join public.sequence_versions sv on sv.id=ce.sequence_version_id and sv.organization_id=ce.organization_id and sv.campaign_id=ce.campaign_id
    where b.id=new.batch_id and b.organization_id=new.organization_id and b.status='DRAFT' and b.campaign_id=ce.campaign_id and ce.account_id=new.account_id
      and ce.contact_id=new.contact_id and ce.mailbox_id=new.mailbox_id and ce.sequence_version_id=new.sequence_version_id
      and encode(digest(c.normalized_email,'sha256'),'hex')=new.contact_email_sha256 and sv.content_sha256=new.sequence_content_sha256)
  then raise exception 'FIRST_SEND_TENANT_OR_REFERENCE_MISMATCH'; end if;
  return new;
end $$;

create or replace function app.enforce_opportunity_transition()
returns trigger language plpgsql set search_path=public,app,pg_temp as $$
declare stage_order integer; old_stage_order integer; lead_record public.leads%rowtype;
begin
  if tg_op='UPDATE' and old.stage in ('CLOSED_WON','CLOSED_LOST')
    and app.retention_internal_executor()
    and (to_jsonb(new)-array['next_action','loss_reason'])=(to_jsonb(old)-array['next_action','loss_reason'])
    and new.next_action is null and new.loss_reason is null
    and exists(
      select 1 from public.leads l
      join public.deletion_tombstones dt
        on dt.organization_id=l.organization_id
       and dt.subject_hash=encode(digest(l.organization_id::text||':CONTACT:'||l.contact_id::text,'sha256'),'hex')
      where l.organization_id=old.organization_id and l.id=old.lead_id
    )
  then return new; end if;
  if tg_op='INSERT' then
    if new.stage not in ('PROSPECTING','CONVERSATION') then raise exception 'OPPORTUNITY_CREATION_STAGE_INVALID'; end if;
  else
    if old.stage in ('CLOSED_WON','CLOSED_LOST') and new is distinct from old then raise exception 'CLOSED_OPPORTUNITY_IMMUTABLE'; end if;
    stage_order:=array_position(array['PROSPECTING','CONVERSATION','MEETING_CONFIRMED','DISCOVERY_HELD','QUALIFIED','TECHNICAL_VISIT','PROPOSAL','DECISION','CLOSED_WON','CLOSED_LOST']::text[],new.stage::text);
    old_stage_order:=array_position(array['PROSPECTING','CONVERSATION','MEETING_CONFIRMED','DISCOVERY_HELD','QUALIFIED','TECHNICAL_VISIT','PROPOSAL','DECISION','CLOSED_WON','CLOSED_LOST']::text[],old.stage::text);
    if old.stage in ('QUALIFIED','TECHNICAL_VISIT','PROPOSAL','DECISION') and new.stage<>'CLOSED_LOST' and stage_order<old_stage_order then raise exception 'OPPORTUNITY_STAGE_REGRESSION_REJECTED'; end if;
    if new.stage not in ('CLOSED_WON','CLOSED_LOST') and stage_order>old_stage_order+1 then raise exception 'OPPORTUNITY_STAGE_SKIP_REJECTED'; end if;
  end if;
  if new.lead_id is not null then
    select * into lead_record from public.leads where organization_id=new.organization_id and id=new.lead_id;
    if not found or lead_record.account_id is distinct from new.account_id then raise exception 'OPPORTUNITY_LEAD_ACCOUNT_MISMATCH'; end if;
  end if;
  if new.stage in ('QUALIFIED','TECHNICAL_VISIT','PROPOSAL','DECISION','CLOSED_WON') then
    if new.lead_id is null or not lead_record.contractual_qualified then raise exception 'QUALIFIED_PIPELINE_REQUIRES_STRICT_LEAD'; end if;
    if not (new.economic_buyer and new.active_pain and new.business_impact and new.timing_under_90_days and coalesce(new.value_mxn,0)>0
      and nullif(btrim(new.next_action),'') is not null and new.next_action_at is not null)
    then raise exception 'QUALIFIED_PIPELINE_EVIDENCE_INCOMPLETE'; end if;
  end if;
  if new.stage='PROPOSAL' and not exists(select 1 from public.proposals p where p.organization_id=new.organization_id and p.opportunity_id=new.id and p.delivered_at is not null)
  then raise exception 'PROPOSAL_STAGE_REQUIRES_DELIVERY_EVIDENCE'; end if;
  if new.stage='CLOSED_WON' and not exists(select 1 from public.approvals a where a.organization_id=new.organization_id and a.subject_type='opportunity_closed_won' and a.subject_id=new.id and a.decision='APPROVED')
  then raise exception 'CLOSED_WON_REQUIRES_APPROVAL_EVIDENCE'; end if;
  return new;
end $$;

create or replace function app.enforce_capacity_schedule_write_path()
returns trigger language plpgsql security definer set search_path=public,app,pg_temp as $$
declare linked_stage public.commercial_stage; linked_config_version integer; linked_effective_month date;
begin
  if tg_op='UPDATE' and app.retention_internal_executor()
    and (to_jsonb(new)-'change_reason')=(to_jsonb(old)-'change_reason')
    and new.change_reason='RETENTION_REDACTED'
    and exists(select 1 from public.opportunities o join public.leads l on l.organization_id=o.organization_id and l.id=o.lead_id
      join public.deletion_tombstones dt on dt.organization_id=l.organization_id
        and dt.subject_hash=encode(digest(l.organization_id::text||':CONTACT:'||l.contact_id::text,'sha256'),'hex')
      where o.organization_id=old.organization_id and o.id=old.opportunity_id)
  then return new; end if;
  if tg_op='DELETE' then raise exception 'OPERATIONAL_CAPACITY_SCHEDULE_DELETE_FORBIDDEN'; end if;
  if current_setting('app.capacity_schedule_rpc',true) is distinct from 'true' then raise exception 'OPERATIONAL_CAPACITY_SCHEDULE_RPC_REQUIRED'; end if;
  if tg_op='UPDATE' and (new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
    or new.opportunity_id is distinct from old.opportunity_id or new.created_at is distinct from old.created_at)
  then raise exception 'OPERATIONAL_CAPACITY_SCHEDULE_IDENTITY_IMMUTABLE'; end if;
  select o.stage into linked_stage from public.opportunities o where o.organization_id=new.organization_id and o.id=new.opportunity_id;
  if not found or linked_stage<>'CLOSED_WON' then raise exception 'CAPACITY_REQUIRES_CLOSED_WON_OPPORTUNITY'; end if;
  select c.version,c.effective_from_month into linked_config_version,linked_effective_month from public.operational_capacity_configs c
    where c.organization_id=new.organization_id and c.id=new.config_id;
  if not found or linked_config_version<>new.config_version or linked_effective_month>new.capacity_month then raise exception 'CAPACITY_CONFIG_REFERENCE_INVALID'; end if;
  return new;
end $$;

create or replace function app.enforce_capacity_command_append_only()
returns trigger language plpgsql set search_path=public,app,pg_temp as $$
begin
  if tg_op='UPDATE' and app.retention_internal_executor()
    and (to_jsonb(new)-'change_reason')=(to_jsonb(old)-'change_reason')
    and new.change_reason='RETENTION_REDACTED'
    and exists(select 1 from public.opportunities o join public.leads l on l.organization_id=o.organization_id and l.id=o.lead_id
      join public.deletion_tombstones dt on dt.organization_id=l.organization_id
        and dt.subject_hash=encode(digest(l.organization_id::text||':CONTACT:'||l.contact_id::text,'sha256'),'hex')
      where o.organization_id=old.organization_id and o.id=old.opportunity_id)
  then return new; end if;
  if tg_op<>'INSERT' then raise exception 'OPERATIONAL_CAPACITY_COMMAND_APPEND_ONLY'; end if;
  if current_setting('app.capacity_schedule_rpc',true) is distinct from 'true' then raise exception 'OPERATIONAL_CAPACITY_SCHEDULE_RPC_REQUIRED'; end if;
  return new;
end $$;

create or replace function app.enforce_rollout_enrollment_integrity()
returns trigger language plpgsql set search_path=public,app,pg_temp as $$
begin
  if tg_op='UPDATE' and app.retention_internal_executor()
    and (to_jsonb(new)-'contact_email_sha256')=(to_jsonb(old)-'contact_email_sha256')
    and new.contact_email_sha256=encode(digest('RETENTION:'||encode(digest(old.organization_id::text||':CONTACT:'||old.contact_id::text,'sha256'),'hex')||':ROLLOUT:'||old.id::text,'sha256'),'hex')
    and exists(select 1 from public.deletion_tombstones dt where dt.organization_id=old.organization_id
      and dt.subject_hash=encode(digest(old.organization_id::text||':CONTACT:'||old.contact_id::text,'sha256'),'hex'))
  then return new; end if;
  if tg_op<>'INSERT' then raise exception 'ROLLOUT_RECIPIENT_SET_IMMUTABLE'; end if;
  if exists(select 1 from public.first_send_batch_enrollments be where be.organization_id=new.organization_id and be.enrollment_id=new.enrollment_id)
  then raise exception 'ENROLLMENT_RELEASE_SOURCE_OVERLAP'; end if;
  if not exists(select 1 from public.rollout_waves w join public.campaign_enrollments ce on ce.id=new.enrollment_id and ce.organization_id=new.organization_id
    join public.contacts c on c.id=ce.contact_id and c.organization_id=ce.organization_id join public.sequence_versions sv on sv.id=ce.sequence_version_id and sv.organization_id=ce.organization_id and sv.campaign_id=ce.campaign_id
    where w.id=new.wave_id and w.organization_id=new.organization_id and w.status='DRAFT' and w.campaign_id=ce.campaign_id and ce.account_id=new.account_id
      and ce.contact_id=new.contact_id and ce.mailbox_id=new.mailbox_id and ce.sequence_version_id=new.sequence_version_id
      and encode(digest(c.normalized_email,'sha256'),'hex')=new.contact_email_sha256 and sv.content_sha256=new.sequence_content_sha256)
  then raise exception 'ROLLOUT_TENANT_OR_REFERENCE_MISMATCH'; end if;
  return new;
end $$;

create or replace function app.retention_payment_evidence_is_canonical(
  target_organization_id uuid,
  target_source_evidence_id uuid
) returns boolean
language sql
stable
security definer
set search_path=public,app,pg_temp
as $$
  select exists (
    select 1
    from public.source_evidence se
    join public.payments p
      on p.organization_id=se.organization_id
     and p.evidence_record_id=se.id
    where se.organization_id=target_organization_id
      and se.id=target_source_evidence_id
      and se.source_url='https://retention.invalid/redacted'
      and se.source_name='RETENTION_REDACTED'
      and lower(se.field_name)='first_payment_mxn'
      and jsonb_typeof(se.value_json)='object'
      and se.value_json ?& array['amount_mxn','paid_at']
      and (select count(*) from jsonb_object_keys(se.value_json))=2
      and se.checksum=encode(digest(
        'RETENTION_FINANCIAL:'||se.id::text||':'||(se.value_json->>'amount_mxn')||':'||(se.value_json->>'paid_at'),
        'sha256'
      ),'hex')
      and app.payment_evidence_is_verified(
        p.organization_id,p.opportunity_id,p.evidence_record_id,p.amount_mxn,p.paid_at
      )
  );
$$;
revoke all on function app.retention_payment_evidence_is_canonical(uuid,uuid) from public,authenticated,service_role;

create or replace function app.reapply_contact_retention_tombstone(
  target_organization_id uuid,target_contact_id uuid,target_subject_hash text
) returns void language plpgsql security definer set search_path=public,app,pg_temp as $$
declare lead_ids uuid[]:='{}'; opportunity_ids uuid[]:='{}'; message_ids uuid[]:='{}'; prequote_ids uuid[]:='{}';
  source_evidence_ids uuid[]:='{}'; outbox_ids uuid[]:='{}'; approval_request_ids uuid[]:='{}'; approval_ids uuid[]:='{}';
  first_send_enrollment_ids uuid[]:='{}'; rollout_enrollment_ids uuid[]:='{}'; capacity_schedule_ids uuid[]:='{}'; capacity_command_ids uuid[]:='{}';
begin
  perform app.retention_assert_service();
  if target_subject_hash<>encode(digest(target_organization_id::text||':CONTACT:'||target_contact_id::text,'sha256'),'hex') then raise exception 'RETENTION_RESTORE_SUBJECT_HASH_MISMATCH'; end if;
  if exists (
    select 1 from public.leads owned
    join public.leads shared
      on shared.organization_id=owned.organization_id
     and shared.prequote_id=owned.prequote_id
     and shared.contact_id<>owned.contact_id
    where owned.organization_id=target_organization_id
      and owned.contact_id=target_contact_id
      and owned.prequote_id is not null
  ) then raise exception 'RETENTION_SHARED_PREQUOTE_OWNERSHIP_UNKNOWN'; end if;
  perform set_config('app.research_rpc_write','true',true);
  perform set_config('app.operations_rpc_write','on',true);
  select coalesce(array_agg(id),'{}') into lead_ids from public.leads where organization_id=target_organization_id and contact_id=target_contact_id;
  select coalesce(array_agg(o.id),'{}') into opportunity_ids from public.opportunities o
    where o.organization_id=target_organization_id and o.lead_id=any(lead_ids);
  select coalesce(array_agg(id),'{}') into message_ids from public.messages where organization_id=target_organization_id and contact_id=target_contact_id;
  select coalesce(array_agg(prequote_id) filter(where prequote_id is not null),'{}') into prequote_ids
    from public.leads where organization_id=target_organization_id and id=any(lead_ids);
  select coalesce(array_agg(id),'{}') into outbox_ids from public.event_outbox
    where organization_id=target_organization_id and aggregate_type='message' and aggregate_id=any(message_ids);
  select coalesce(array_agg(id),'{}') into source_evidence_ids from public.source_evidence
    where organization_id=target_organization_id and (
      (lower(subject_type)='contact' and subject_id=target_contact_id)
      or (lower(subject_type)='lead' and subject_id=any(lead_ids))
      or (lower(subject_type)='message' and subject_id=any(message_ids))
      or (lower(subject_type)='prequote' and subject_id=any(prequote_ids))
      or (lower(subject_type)='opportunity' and subject_id=any(opportunity_ids))
    );
  select coalesce(array_agg(id),'{}') into approval_request_ids from public.approval_requests
    where organization_id=target_organization_id and subject_type='opportunity_closed_won' and subject_id=any(opportunity_ids);
  select coalesce(array_agg(id),'{}') into approval_ids from public.approvals
    where organization_id=target_organization_id and subject_type='opportunity_closed_won' and subject_id=any(opportunity_ids);
  select coalesce(array_agg(id),'{}') into first_send_enrollment_ids from public.first_send_batch_enrollments
    where organization_id=target_organization_id and contact_id=target_contact_id;
  select coalesce(array_agg(id),'{}') into rollout_enrollment_ids from public.rollout_wave_enrollments
    where organization_id=target_organization_id and contact_id=target_contact_id;
  select coalesce(array_agg(id),'{}') into capacity_schedule_ids from public.opportunity_capacity_schedules
    where organization_id=target_organization_id and opportunity_id=any(opportunity_ids);
  select coalesce(array_agg(id),'{}') into capacity_command_ids from public.operational_capacity_commands
    where organization_id=target_organization_id and opportunity_id=any(opportunity_ids);
  update public.provider_events set payload_json='{"redacted":true,"reason_code":"RETENTION_RESTORE_REAPPLY"}'::jsonb
    where organization_id=target_organization_id and message_id=any(message_ids);
  update public.notification_deliveries set provider_id=null,last_error=null
    where organization_id=target_organization_id and outbox_event_id=any(outbox_ids);
  update public.event_outbox eo set payload_json='{"redacted":true,"reason_code":"RETENTION_RESTORE_REAPPLY"}'::jsonb
      ,last_error=null
    where eo.organization_id=target_organization_id and eo.id=any(outbox_ids);
  update public.dead_letters dl set payload_json='{"redacted":true,"reason_code":"RETENTION_RESTORE_REAPPLY"}'::jsonb,
    reason='RETENTION_RESTORE_REAPPLY'
    where dl.organization_id=target_organization_id and dl.source_table='event_outbox' and dl.source_id=any(outbox_ids);
  update public.messages set normalized_to=null,normalized_from=null,subject=null,body_text=null,provider_message_id=null
    where organization_id=target_organization_id and contact_id=target_contact_id;
  delete from storage.objects so using public.prequote_documents pd
    where so.bucket_id=pd.bucket_id and so.name=pd.storage_path and pd.organization_id=target_organization_id
      and pd.prequote_id in(select prequote_id from public.leads where organization_id=target_organization_id and contact_id=target_contact_id and prequote_id is not null);
  delete from public.prequote_documents pd where pd.organization_id=target_organization_id
    and pd.prequote_id in(select prequote_id from public.leads where organization_id=target_organization_id and contact_id=target_contact_id and prequote_id is not null);
  update public.meetings mt set outcome_notes=case when mt.attendance_verified then 'RETENTION_REDACTED' else null end where mt.organization_id=target_organization_id
    and mt.opportunity_id in(select o.id from public.opportunities o join public.leads l on l.id=o.lead_id and l.organization_id=o.organization_id
      where o.organization_id=target_organization_id and l.contact_id=target_contact_id);
  update public.opportunities o set next_action=null,loss_reason=null where o.organization_id=target_organization_id
    and o.id=any(opportunity_ids);
  update public.approval_requests set request_reason='RETENTION_REDACTED',rationale=case when rationale is null then null else 'RETENTION_REDACTED' end
    where organization_id=target_organization_id and id=any(approval_request_ids);
  update public.approvals set rationale=case when rationale is null then null else 'RETENTION_REDACTED' end
    where organization_id=target_organization_id and id=any(approval_ids);
  update public.first_send_batch_enrollments set contact_email_sha256=encode(digest('RETENTION:'||target_subject_hash||':FIRST_SEND:'||id::text,'sha256'),'hex')
    where organization_id=target_organization_id and id=any(first_send_enrollment_ids);
  update public.rollout_wave_enrollments set contact_email_sha256=encode(digest('RETENTION:'||target_subject_hash||':ROLLOUT:'||id::text,'sha256'),'hex')
    where organization_id=target_organization_id and id=any(rollout_enrollment_ids);
  update public.opportunity_capacity_schedules set change_reason='RETENTION_REDACTED'
    where organization_id=target_organization_id and id=any(capacity_schedule_ids);
  update public.operational_capacity_commands set change_reason='RETENTION_REDACTED'
    where organization_id=target_organization_id and id=any(capacity_command_ids);
  delete from public.tasks where organization_id=target_organization_id and contact_id=target_contact_id;
  update public.leads set qualification_reason=null where organization_id=target_organization_id and contact_id=target_contact_id;
  delete from public.research_dedupe_decisions d where d.organization_id=target_organization_id
    and d.dedupe_case_id in(select dc.id from public.research_dedupe_cases dc where dc.organization_id=target_organization_id
      and (dc.candidate_contact_id in(select rc.id from public.research_contact_candidates rc where rc.organization_id=target_organization_id and rc.promoted_contact_id=target_contact_id)
        or dc.matched_candidate_id in(select rc.id from public.research_contact_candidates rc where rc.organization_id=target_organization_id and rc.promoted_contact_id=target_contact_id)));
  delete from public.research_dedupe_cases dc where dc.organization_id=target_organization_id
    and (dc.candidate_contact_id in(select rc.id from public.research_contact_candidates rc where rc.organization_id=target_organization_id and rc.promoted_contact_id=target_contact_id)
      or dc.matched_candidate_id in(select rc.id from public.research_contact_candidates rc where rc.organization_id=target_organization_id and rc.promoted_contact_id=target_contact_id));
  delete from public.research_reviews rr where rr.organization_id=target_organization_id and rr.subject_type='CONTACT_CANDIDATE'
    and rr.subject_id in(select rc.id from public.research_contact_candidates rc where rc.organization_id=target_organization_id and rc.promoted_contact_id=target_contact_id);
  delete from public.research_evidence_records re where re.organization_id=target_organization_id and re.subject_type='CONTACT_CANDIDATE'
    and re.subject_id in(select rc.id from public.research_contact_candidates rc where rc.organization_id=target_organization_id and rc.promoted_contact_id=target_contact_id);
  delete from public.research_contact_candidates rc where rc.organization_id=target_organization_id and rc.promoted_contact_id=target_contact_id;
  delete from public.qualification_evidence_links qel where qel.organization_id=target_organization_id and qel.source_evidence_id=any(source_evidence_ids)
    and not exists(select 1 from public.payments p where p.organization_id=qel.organization_id and p.evidence_record_id=qel.source_evidence_id);
  delete from public.source_evidence se where se.organization_id=target_organization_id and se.id=any(source_evidence_ids)
    and not exists(select 1 from public.payments p where p.organization_id=se.organization_id and p.evidence_record_id=se.id);
  update public.source_evidence se set source_url='https://retention.invalid/redacted',source_name='RETENTION_REDACTED',
    value_json=jsonb_build_object('amount_mxn',se.value_json->'amount_mxn','paid_at',se.value_json->'paid_at'),
    checksum=encode(digest('RETENTION_FINANCIAL:'||se.id::text||':'||(se.value_json->>'amount_mxn')||':'||(se.value_json->>'paid_at'),'sha256'),'hex')
    where se.organization_id=target_organization_id and se.id=any(source_evidence_ids)
      and exists(select 1 from public.payments p where p.organization_id=se.organization_id and p.evidence_record_id=se.id);
  update public.prequotes set contact_name='Deleted subject',contact_role='Deleted',normalized_email='deleted+'||target_subject_hash||'@invalid.local',phone_e164=null
    where organization_id=target_organization_id and id in(select prequote_id from public.leads where organization_id=target_organization_id and contact_id=target_contact_id and prequote_id is not null);
  update public.contacts set full_name='Deleted subject',role_title='Deleted',normalized_email='deleted+'||target_subject_hash||'@invalid.local',phone_e164=null,
    verified=false,verified_at=null,source_confidence='UNVERIFIED',is_deleted=true where organization_id=target_organization_id and id=target_contact_id;
  update public.audit_log set old_data=jsonb_build_object('redacted',true,'reason_code','RETENTION_DELETION'),
    new_data=jsonb_build_object('redacted',true,'reason_code','RETENTION_DELETION')
  where organization_id=target_organization_id and (
    record_id=target_contact_id or record_id=any(lead_ids) or record_id=any(opportunity_ids) or record_id=any(message_ids)
    or record_id=any(prequote_ids) or record_id=any(source_evidence_ids) or record_id=any(approval_request_ids) or record_id=any(approval_ids)
    or record_id=any(first_send_enrollment_ids) or record_id=any(rollout_enrollment_ids)
    or record_id=any(capacity_schedule_ids) or record_id=any(capacity_command_ids)
  );
end $$;

create or replace function app.canonical_retention_tombstone_manifest_sha256(target_tombstones jsonb)
returns text language plpgsql immutable set search_path=app,extensions,public,pg_temp as $$
declare item jsonb; canonical_lines text[]:=array[]::text[]; item_timestamp timestamptz; subject_hash text; evidence_hash text;
begin
  if jsonb_typeof(target_tombstones)<>'array' or jsonb_array_length(target_tombstones) not between 1 and 1000
  then raise exception 'RETENTION_RESTORE_MANIFEST_INVALID'; end if;
  for item in select value from jsonb_array_elements(target_tombstones) loop
    if jsonb_typeof(item)<>'object'
      or (select count(*) from jsonb_object_keys(item))<>3
      or exists(select 1 from jsonb_object_keys(item) k where k not in ('subject_hash','deletion_evidence_sha256','deleted_at'))
      or jsonb_typeof(item->'subject_hash')<>'string'
      or jsonb_typeof(item->'deletion_evidence_sha256')<>'string'
      or jsonb_typeof(item->'deleted_at')<>'string'
      or coalesce(item->>'subject_hash','') !~ '^[a-f0-9]{64}$'
      or coalesce(item->>'deletion_evidence_sha256','') !~ '^[a-f0-9]{64}$'
      or coalesce(item->>'deleted_at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
    then raise exception 'RETENTION_RESTORE_MANIFEST_ENTRY_INVALID'; end if;
    begin item_timestamp:=(item->>'deleted_at')::timestamptz;
    exception when others then raise exception 'RETENTION_RESTORE_MANIFEST_TIMESTAMP_INVALID'; end;
    subject_hash:=item->>'subject_hash'; evidence_hash:=item->>'deletion_evidence_sha256';
    if subject_hash=any(canonical_lines) then raise exception 'RETENTION_RESTORE_MANIFEST_DUPLICATE'; end if;
    canonical_lines:=array_append(canonical_lines,subject_hash);
    canonical_lines:=array_append(canonical_lines,evidence_hash||':'||to_char(item_timestamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  end loop;
  if (select count(*) from unnest(canonical_lines) with ordinality x(value,n) where n%2=1)
    <>(select count(distinct value) from unnest(canonical_lines) with ordinality x(value,n) where n%2=1)
  then raise exception 'RETENTION_RESTORE_MANIFEST_DUPLICATE'; end if;
  return (select encode(digest(string_agg(subject||':'||detail,E'\n' order by subject),'sha256'),'hex')
    from (select canonical_lines[n] subject,canonical_lines[n+1] detail from generate_subscripts(canonical_lines,1) n where n%2=1) s);
end $$;

create or replace function app.reapply_retention_tombstones(
  target_organization_id uuid,target_source_manifest_sha256 text,target_tombstones jsonb,target_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare replay jsonb; now_value timestamptz:=app.retention_now(); run_id uuid:=gen_random_uuid(); item jsonb; contact_subject_id uuid; matches integer; canonical_manifest_sha256 text; expected_manifest jsonb; expected_manifest_sha256 text;
  reapplied integer:=0; already integer:=0; unknowns integer:=0; result_value text; reason text; response jsonb;
begin
  perform app.retention_assert_service();
  if target_source_manifest_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'RETENTION_RESTORE_MANIFEST_INVALID'; end if;
  canonical_manifest_sha256:=app.canonical_retention_tombstone_manifest_sha256(target_tombstones);
  if canonical_manifest_sha256<>target_source_manifest_sha256 then raise exception 'RETENTION_RESTORE_MANIFEST_SHA256_MISMATCH'; end if;
  replay:=app.retention_command_begin(target_organization_id,'reapply_retention_tombstones',target_idempotency_key,
    jsonb_build_object('source_manifest_sha256',target_source_manifest_sha256)); if replay is not null then return replay; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':retention-restore',0));
  select jsonb_agg(jsonb_build_object('subject_hash',dt.subject_hash,'deletion_evidence_sha256',dt.deletion_evidence_sha256,'deleted_at',dt.deleted_at) order by dt.subject_hash)
  into expected_manifest from public.deletion_tombstones dt where dt.organization_id=target_organization_id;
  if expected_manifest is null then
    insert into public.retention_restore_reconciliation_runs(id,organization_id,source_manifest_sha256,status,evaluated_at,entry_count,reapplied_count,already_applied_count,unknown_count,idempotency_key)
    values(run_id,target_organization_id,target_source_manifest_sha256,'UNKNOWN',now_value,jsonb_array_length(target_tombstones),0,0,1,target_idempotency_key);
    insert into public.event_outbox(organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json)
    values(target_organization_id,'retention_restore_reconciliation',run_id,'retention.restore.unknown','retention-restore:'||run_id,
      jsonb_build_object('run_id',run_id,'unknown_count',1,'reason_code','TOMBSTONE_ORIGIN_UNVERIFIED')) on conflict do nothing;
    response:=jsonb_build_object('status','UNKNOWN','run_id',run_id,'entry_count',jsonb_array_length(target_tombstones),'reapplied_count',0,'already_applied_count',0,'unknown_count',1,'reason_code','TOMBSTONE_ORIGIN_UNVERIFIED','evaluated_at',now_value);
    return app.retention_command_finish(target_organization_id,'reapply_retention_tombstones',target_idempotency_key,response);
  end if;
  expected_manifest_sha256:=app.canonical_retention_tombstone_manifest_sha256(expected_manifest);
  if jsonb_array_length(target_tombstones)<>jsonb_array_length(expected_manifest) or target_source_manifest_sha256<>expected_manifest_sha256 then
    insert into public.retention_restore_reconciliation_runs(id,organization_id,source_manifest_sha256,status,evaluated_at,entry_count,reapplied_count,already_applied_count,unknown_count,idempotency_key)
    values(run_id,target_organization_id,target_source_manifest_sha256,'UNKNOWN',now_value,jsonb_array_length(target_tombstones),0,0,1,target_idempotency_key);
    insert into public.event_outbox(organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json)
    values(target_organization_id,'retention_restore_reconciliation',run_id,'retention.restore.unknown','retention-restore:'||run_id,
      jsonb_build_object('run_id',run_id,'unknown_count',1,'reason_code','TOMBSTONE_MANIFEST_INCOMPLETE')) on conflict do nothing;
    response:=jsonb_build_object('status','UNKNOWN','run_id',run_id,'entry_count',jsonb_array_length(target_tombstones),'reapplied_count',0,'already_applied_count',0,'unknown_count',1,'reason_code','TOMBSTONE_MANIFEST_INCOMPLETE','evaluated_at',now_value);
    return app.retention_command_finish(target_organization_id,'reapply_retention_tombstones',target_idempotency_key,response);
  end if;
  insert into public.retention_restore_reconciliation_runs(id,organization_id,source_manifest_sha256,status,evaluated_at,entry_count,reapplied_count,already_applied_count,unknown_count,idempotency_key)
  values(run_id,target_organization_id,target_source_manifest_sha256,'UNKNOWN',now_value,jsonb_array_length(target_tombstones),0,0,0,target_idempotency_key);
  for item in select value from jsonb_array_elements(target_tombstones) loop
    result_value:='UNKNOWN'; reason:=null; contact_subject_id:=null;
    if coalesce(item->>'subject_hash','') !~ '^[a-f0-9]{64}$' or coalesce(item->>'deletion_evidence_sha256','') !~ '^[a-f0-9]{64}$' or nullif(item->>'deleted_at','') is null then
      unknowns:=unknowns+1; reason:='MANIFEST_ENTRY_INVALID';
    elsif not exists(
      select 1 from public.deletion_tombstones dt where dt.organization_id=target_organization_id
        and dt.subject_type='CONTACT' and dt.subject_hash=item->>'subject_hash'
        and dt.deletion_evidence_sha256=item->>'deletion_evidence_sha256'
        and dt.deleted_at=(item->>'deleted_at')::timestamptz
    ) then
      unknowns:=unknowns+1; reason:='TOMBSTONE_ORIGIN_UNVERIFIED';
    else
      select count(*),(array_agg(c.id order by c.id))[1] into matches,contact_subject_id from public.contacts c where c.organization_id=target_organization_id
        and encode(digest(c.organization_id::text||':CONTACT:'||c.id::text,'sha256'),'hex')=item->>'subject_hash';
      if matches<>1 then
        unknowns:=unknowns+1; reason:='SUBJECT_MATCH_UNKNOWN';
      else
        perform pg_advisory_xact_lock(hashtextextended('legal-hold:'||target_organization_id::text||':'||contact_subject_id::text,0));
        if exists(select 1 from public.legal_holds where organization_id=target_organization_id and subject_id=contact_subject_id and status='ACTIVE') then
          unknowns:=unknowns+1; reason:='ACTIVE_LEGAL_HOLD_REQUIRES_REVIEW';
        elsif exists(
          select 1 from public.leads owned
          join public.leads shared
            on shared.organization_id=owned.organization_id
           and shared.prequote_id=owned.prequote_id
           and shared.contact_id<>owned.contact_id
          where owned.organization_id=target_organization_id
            and owned.contact_id=contact_subject_id
            and owned.prequote_id is not null
        ) then
          unknowns:=unknowns+1; reason:='SHARED_PREQUOTE_OWNERSHIP_UNKNOWN';
        else
          if exists(select 1 from public.contacts where organization_id=target_organization_id and id=contact_subject_id and is_deleted and full_name='Deleted subject' and normalized_email='deleted+'||(item->>'subject_hash')||'@invalid.local')
            and not exists(select 1 from public.messages where organization_id=target_organization_id and contact_id=contact_subject_id and num_nonnulls(normalized_to,normalized_from,subject,body_text,provider_message_id)>0)
            and not exists(select 1 from public.source_evidence se where se.organization_id=target_organization_id and (
              (lower(se.subject_type)='contact' and se.subject_id=contact_subject_id)
              or (lower(se.subject_type)='lead' and se.subject_id in(select id from public.leads where organization_id=target_organization_id and contact_id=contact_subject_id))
              or (lower(se.subject_type)='message' and se.subject_id in(select id from public.messages where organization_id=target_organization_id and contact_id=contact_subject_id))
              or (lower(se.subject_type)='prequote' and se.subject_id in(select prequote_id from public.leads where organization_id=target_organization_id and contact_id=contact_subject_id and prequote_id is not null))
              or (lower(se.subject_type)='opportunity' and se.subject_id in(select o.id from public.opportunities o join public.leads l on l.organization_id=o.organization_id and l.id=o.lead_id where o.organization_id=target_organization_id and l.contact_id=contact_subject_id)))
              and not app.retention_payment_evidence_is_canonical(se.organization_id,se.id))
            and not exists(select 1 from public.meetings mt where mt.organization_id=target_organization_id
              and mt.opportunity_id in(select o.id from public.opportunities o join public.leads l on l.id=o.lead_id and l.organization_id=o.organization_id where o.organization_id=target_organization_id and l.contact_id=contact_subject_id)
              and not (
                (mt.attendance_verified and mt.held_at is not null and mt.outcome_notes='RETENTION_REDACTED')
                or (not mt.attendance_verified and mt.held_at is null and mt.outcome_notes is null)
              ))
            and not exists(select 1 from public.research_contact_candidates where organization_id=target_organization_id and promoted_contact_id=contact_subject_id)
            and not exists(select 1 from public.opportunity_capacity_schedules s where s.organization_id=target_organization_id
              and s.opportunity_id in(select o.id from public.opportunities o join public.leads l on l.organization_id=o.organization_id and l.id=o.lead_id where o.organization_id=target_organization_id and l.contact_id=contact_subject_id)
              and s.change_reason<>'RETENTION_REDACTED')
            and not exists(select 1 from public.operational_capacity_commands c where c.organization_id=target_organization_id
              and c.opportunity_id in(select o.id from public.opportunities o join public.leads l on l.organization_id=o.organization_id and l.id=o.lead_id where o.organization_id=target_organization_id and l.contact_id=contact_subject_id)
              and c.change_reason<>'RETENTION_REDACTED')
          then result_value:='ALREADY_APPLIED'; else result_value:='REAPPLIED'; end if;
          perform app.reapply_contact_retention_tombstone(target_organization_id,contact_subject_id,item->>'subject_hash');
        if exists(select 1 from public.provider_events where organization_id=target_organization_id and message_id in(select id from public.messages where organization_id=target_organization_id and contact_id=contact_subject_id) and payload_json::text !~ '"redacted"\s*:\s*true')
          or exists(select 1 from public.event_outbox where organization_id=target_organization_id and aggregate_type='message' and aggregate_id in(select id from public.messages where organization_id=target_organization_id and contact_id=contact_subject_id) and payload_json::text !~ '"redacted"\s*:\s*true')
          or exists(select 1 from public.dead_letters where organization_id=target_organization_id and source_table='event_outbox' and source_id in(select id from public.event_outbox where organization_id=target_organization_id and aggregate_type='message' and aggregate_id in(select id from public.messages where organization_id=target_organization_id and contact_id=contact_subject_id)) and payload_json::text !~ '"redacted"\s*:\s*true')
          or exists(select 1 from public.messages where organization_id=target_organization_id and contact_id=contact_subject_id and num_nonnulls(normalized_to,normalized_from,subject,body_text,provider_message_id)>0)
          or exists(select 1 from public.prequote_documents where organization_id=target_organization_id and prequote_id in(select prequote_id from public.leads where organization_id=target_organization_id and contact_id=contact_subject_id and prequote_id is not null))
          or exists(select 1 from public.meetings mt where mt.organization_id=target_organization_id
            and mt.opportunity_id in(select o.id from public.opportunities o join public.leads l on l.id=o.lead_id and l.organization_id=o.organization_id where o.organization_id=target_organization_id and l.contact_id=contact_subject_id)
            and not (
              (mt.attendance_verified and mt.held_at is not null and mt.outcome_notes='RETENTION_REDACTED')
              or (not mt.attendance_verified and mt.held_at is null and mt.outcome_notes is null)
            ))
          or exists(select 1 from public.opportunities o where o.organization_id=target_organization_id and (o.next_action is not null or o.loss_reason is not null) and o.lead_id in(select id from public.leads where organization_id=target_organization_id and contact_id=contact_subject_id))
          or exists(select 1 from public.leads where organization_id=target_organization_id and contact_id=contact_subject_id and qualification_reason is not null)
          or exists(select 1 from public.source_evidence se where se.organization_id=target_organization_id and (
            (lower(se.subject_type)='contact' and se.subject_id=contact_subject_id)
            or (lower(se.subject_type)='lead' and se.subject_id in(select id from public.leads where organization_id=target_organization_id and contact_id=contact_subject_id))
            or (lower(se.subject_type)='message' and se.subject_id in(select id from public.messages where organization_id=target_organization_id and contact_id=contact_subject_id))
            or (lower(se.subject_type)='prequote' and se.subject_id in(select prequote_id from public.leads where organization_id=target_organization_id and contact_id=contact_subject_id and prequote_id is not null))
            or (lower(se.subject_type)='opportunity' and se.subject_id in(select o.id from public.opportunities o join public.leads l on l.organization_id=o.organization_id and l.id=o.lead_id where o.organization_id=target_organization_id and l.contact_id=contact_subject_id)))
            and not app.retention_payment_evidence_is_canonical(se.organization_id,se.id))
          or exists(select 1 from public.event_outbox eo where eo.organization_id=target_organization_id and eo.aggregate_type='message' and eo.aggregate_id in(select id from public.messages where organization_id=target_organization_id and contact_id=contact_subject_id) and eo.last_error is not null)
          or exists(select 1 from public.notification_deliveries nd where nd.organization_id=target_organization_id and nd.outbox_event_id in(select eo.id from public.event_outbox eo where eo.organization_id=target_organization_id and eo.aggregate_type='message' and eo.aggregate_id in(select id from public.messages where organization_id=target_organization_id and contact_id=contact_subject_id)) and num_nonnulls(nd.provider_id,nd.last_error)>0)
          or exists(select 1 from public.approval_requests ar where ar.organization_id=target_organization_id and ar.subject_type='opportunity_closed_won' and ar.subject_id in(select o.id from public.opportunities o join public.leads l on l.organization_id=o.organization_id and l.id=o.lead_id where o.organization_id=target_organization_id and l.contact_id=contact_subject_id) and (ar.request_reason<>'RETENTION_REDACTED' or ar.rationale is not null and ar.rationale<>'RETENTION_REDACTED'))
          or exists(select 1 from public.approvals a where a.organization_id=target_organization_id and a.subject_type='opportunity_closed_won' and a.subject_id in(select o.id from public.opportunities o join public.leads l on l.organization_id=o.organization_id and l.id=o.lead_id where o.organization_id=target_organization_id and l.contact_id=contact_subject_id) and a.rationale is not null and a.rationale<>'RETENTION_REDACTED')
          or exists(select 1 from public.first_send_batch_enrollments f where f.organization_id=target_organization_id and f.contact_id=contact_subject_id and f.contact_email_sha256<>encode(digest('RETENTION:'||(item->>'subject_hash')||':FIRST_SEND:'||f.id::text,'sha256'),'hex'))
          or exists(select 1 from public.rollout_wave_enrollments w where w.organization_id=target_organization_id and w.contact_id=contact_subject_id and w.contact_email_sha256<>encode(digest('RETENTION:'||(item->>'subject_hash')||':ROLLOUT:'||w.id::text,'sha256'),'hex'))
          or exists(select 1 from public.opportunity_capacity_schedules s where s.organization_id=target_organization_id
            and s.opportunity_id in(select o.id from public.opportunities o join public.leads l on l.organization_id=o.organization_id and l.id=o.lead_id where o.organization_id=target_organization_id and l.contact_id=contact_subject_id)
            and s.change_reason<>'RETENTION_REDACTED')
          or exists(select 1 from public.operational_capacity_commands c where c.organization_id=target_organization_id
            and c.opportunity_id in(select o.id from public.opportunities o join public.leads l on l.organization_id=o.organization_id and l.id=o.lead_id where o.organization_id=target_organization_id and l.contact_id=contact_subject_id)
            and c.change_reason<>'RETENTION_REDACTED')
          or exists(select 1 from public.tasks where organization_id=target_organization_id and contact_id=contact_subject_id)
          or exists(select 1 from public.research_contact_candidates where organization_id=target_organization_id and promoted_contact_id=contact_subject_id)
          or exists(select 1 from public.contacts where organization_id=target_organization_id and id=contact_subject_id and (not is_deleted or full_name<>'Deleted subject' or normalized_email<>'deleted+'||(item->>'subject_hash')||'@invalid.local'))
          then unknowns:=unknowns+1; result_value:='UNKNOWN'; reason:='RETENTION_GRAPH_RESIDUE';
          elsif result_value='ALREADY_APPLIED' then already:=already+1;
          else reapplied:=reapplied+1; end if;
        end if;
      end if;
    end if;
    insert into public.retention_restore_tombstone_entries(organization_id,reconciliation_run_id,subject_hash,deletion_evidence_sha256,deleted_at,result,matched_subject_id,reason_code)
    values(target_organization_id,run_id,coalesce(nullif(item->>'subject_hash',''),repeat('0',64)),coalesce(nullif(item->>'deletion_evidence_sha256',''),repeat('0',64)),
      coalesce(nullif(item->>'deleted_at','')::timestamptz,now_value),result_value,contact_subject_id,reason);
  end loop;
  update public.retention_restore_reconciliation_runs set status=case when unknowns>0 then 'UNKNOWN'::public.retention_reconciliation_status else 'HEALTHY' end,
    reapplied_count=reapplied,already_applied_count=already,unknown_count=unknowns where id=run_id;
  insert into public.event_outbox(organization_id,aggregate_type,aggregate_id,event_type,idempotency_key,payload_json)
  values(target_organization_id,'retention_restore_reconciliation',run_id,case when unknowns>0 then 'retention.restore.unknown' else 'retention.restore.reconciled' end,
    'retention-restore:'||run_id,jsonb_build_object('run_id',run_id,'reapplied_count',reapplied,'already_applied_count',already,'unknown_count',unknowns)) on conflict do nothing;
  response:=jsonb_build_object('status',case when unknowns>0 then 'UNKNOWN' else 'HEALTHY' end,'run_id',run_id,'entry_count',jsonb_array_length(target_tombstones),'reapplied_count',reapplied,'already_applied_count',already,'unknown_count',unknowns,'evaluated_at',now_value);
  return app.retention_command_finish(target_organization_id,'reapply_retention_tombstones',target_idempotency_key,response);
end $$;

create or replace function app.evaluate_retention_health(target_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
declare latest public.retention_reconciliation_runs%rowtype; latest_restore public.retention_restore_reconciliation_runs%rowtype; now_value timestamptz:=app.retention_now(); state text; reason text; provider_unknown integer; active_policy integer; invalid_active_rule_count integer; restore_unknown_count integer; overdue_hold_count integer;
begin
  if not app.is_member(target_organization_id) then raise exception 'RETENTION_MEMBER_AAL2_REQUIRED'; end if;
  select * into latest from public.retention_reconciliation_runs where organization_id=target_organization_id order by heartbeat_at desc limit 1;
  select * into latest_restore from public.retention_restore_reconciliation_runs where organization_id=target_organization_id order by evaluated_at desc,created_at desc limit 1;
  select count(*) into restore_unknown_count from public.retention_restore_tombstone_entries
  where organization_id=target_organization_id and reconciliation_run_id=latest_restore.id and result='UNKNOWN';
  select count(*) into overdue_hold_count from public.legal_holds where organization_id=target_organization_id and status='ACTIVE' and review_due_at<=now_value;
  select count(*) into provider_unknown from public.retention_provider_propagations where organization_id=target_organization_id and status in ('UNKNOWN','PENDING','FAILED');
  select count(*) into active_policy from public.retention_policy_versions where organization_id=target_organization_id and status='ACTIVE' and scope='SYNTHETIC_LOCAL';
  select count(*) into invalid_active_rule_count from public.retention_policy_rules r
  join public.retention_policy_versions p on p.organization_id=r.organization_id and p.id=r.policy_id
  where r.organization_id=target_organization_id and p.status='ACTIVE'
    and (r.rule_state<>'VERIFIED' or r.category<>'SYNTHETIC_CONTACT' or r.subject_type<>'CONTACT' or r.evidence_class<>'synthetic_demo');
  if active_policy<>1 then state:='UNKNOWN';reason:='ACTIVE_LOCAL_POLICY_MISSING';
  elsif invalid_active_rule_count>0 then state:='UNKNOWN';reason:='ACTIVE_POLICY_RULE_UNKNOWN';
  elsif overdue_hold_count>0 then state:='UNKNOWN';reason:='LEGAL_HOLD_REVIEW_OVERDUE';
  elsif latest_restore.id is not null and (latest_restore.status='UNKNOWN' or latest_restore.unknown_count>0 or restore_unknown_count>0) then state:='UNKNOWN';reason:='RESTORE_RECONCILIATION_UNKNOWN';
  elsif latest.id is null then state:='UNKNOWN';reason:='RECONCILER_NEVER_RAN';
  elsif latest.heartbeat_at<now_value-interval '26 hours' then state:='UNKNOWN';reason:='RECONCILER_HEARTBEAT_STALE';
  elsif latest.status='UNKNOWN' then state:='UNKNOWN';reason:=coalesce(latest.reason_code,'RECONCILIATION_UNKNOWN');
  elsif provider_unknown>0 then state:='UNKNOWN';reason:='PROVIDER_PROPAGATION_UNVERIFIED';
  elsif latest.status='DEGRADED' then state:='DEGRADED';reason:=latest.reason_code;
  else state:='HEALTHY';reason:=null; end if;
  return jsonb_build_object('status','READ_ONLY','state',state,'reason_code',reason,'evaluated_at',now_value,'last_heartbeat_at',latest.heartbeat_at,
    'active_policy_count',active_policy,'invalid_active_rule_count',invalid_active_rule_count,'provider_unknown_count',provider_unknown,'restore_unknown_count',restore_unknown_count,'overdue_hold_count',overdue_hold_count,'production_retention_state','BLOCKED_EXTERNAL','scheduler_state','UNKNOWN','live_provider_calls',0,
    'coverage',jsonb_build_object('SYNTHETIC_CONTACT','SUPPORTED_LOCAL','CONTACT_OUTREACH','HOLD_BLOCKED_EXTERNAL','PREQUOTE_DOCUMENT','HOLD_BLOCKED_EXTERNAL','MESSAGE_CONTENT','HOLD_BLOCKED_EXTERNAL'));
end $$;

create or replace function app.enforce_deletion_batch_actor()
returns trigger language plpgsql set search_path=public,app,pg_temp as $$
declare actor_id uuid:=auth.uid(); internal_write boolean:=app.retention_internal_executor();
begin
  if internal_write then
    if tg_op='INSERT' and (new.status<>'DRAFT' or new.requested_by is null) then raise exception 'DELETION_BATCH_MUST_START_DRAFT'; end if;
    if tg_op='UPDATE' and old.status='DRAFT' and new.status in ('APPROVED','CANCELLED') and (new.approved_by is null or new.approved_by=old.requested_by) then raise exception 'DELETION_BATCH_FOUR_EYES_REQUIRED'; end if;
    return new;
  end if;
  raise exception 'RETENTION_RPC_WRITE_REQUIRED';
end $$;

create or replace function app.enforce_legal_hold_actor()
returns trigger language plpgsql set search_path=public,app,pg_temp as $$
declare actor_id uuid:=auth.uid();
begin
  if not app.retention_internal_executor() then raise exception 'RETENTION_INTERNAL_EXECUTOR_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('legal-hold:'||new.organization_id::text||':'||new.subject_id::text,0));
  if tg_op='INSERT' and (actor_id is null or new.created_by is distinct from actor_id) then raise exception 'LEGAL_HOLD_CREATED_BY_MISMATCH'; end if;
  if tg_op='UPDATE' and old.status='ACTIVE' and new.status='RELEASED' and (actor_id is null or new.released_by is distinct from actor_id or new.released_by=old.created_by) then raise exception 'LEGAL_HOLD_RELEASE_FOUR_EYES_REQUIRED'; end if;
  return new;
end $$;

do $$ declare table_name text; begin
  foreach table_name in array array['retention_policy_versions','retention_policy_rules','retention_subject_clocks','retention_reconciliation_runs','retention_command_ledger','retention_provider_propagations','retention_restore_reconciliation_runs','retention_restore_tombstone_entries'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('drop policy if exists %I_privileged_read on public.%I',table_name,table_name);
    if table_name<>'retention_command_ledger' then
      execute format('create policy %I_privileged_read on public.%I for select using (app.has_role(organization_id,array[''ennco_admin''::public.user_role,''teckel_admin''::public.user_role,''auditor_readonly''::public.user_role]))',table_name,table_name);
    end if;
    execute format('drop trigger if exists %I_rpc_guard on public.%I',table_name,table_name);
    execute format('create trigger %I_rpc_guard before insert or update or delete on public.%I for each row execute function app.prevent_retention_direct_write()',table_name,table_name);
    if table_name<>'retention_command_ledger' then
      execute format('drop trigger if exists %I_retention_live_audit on public.%I',table_name,table_name);
      execute format('create trigger %I_retention_live_audit after insert or update or delete on public.%I for each row execute function app.capture_retention_live_audit()',table_name,table_name);
    end if;
  end loop;
end $$;

drop policy if exists legal_holds_admin_insert on public.legal_holds;
drop policy if exists legal_holds_admin_update on public.legal_holds;
drop policy if exists deletion_batches_teckel_insert on public.deletion_batches;
drop policy if exists deletion_batches_admin_update on public.deletion_batches;
revoke insert,update,delete,truncate on public.legal_holds,public.deletion_batches,public.deletion_items,public.deletion_tombstones from authenticated;
revoke insert,update,delete,truncate on public.retention_policy_versions,public.retention_policy_rules,public.retention_subject_clocks,public.retention_reconciliation_runs,public.retention_command_ledger,public.retention_provider_propagations,public.retention_restore_reconciliation_runs,public.retention_restore_tombstone_entries from authenticated,service_role;
grant select on public.retention_policy_versions,public.retention_policy_rules,public.retention_subject_clocks,public.retention_reconciliation_runs,public.retention_provider_propagations,public.retention_restore_reconciliation_runs,public.retention_restore_tombstone_entries to authenticated;

create or replace function public.create_retention_policy(uuid,integer,text,timestamptz,text,jsonb,text) returns jsonb language sql security definer set search_path=app,public,pg_temp as $$select app.create_retention_policy($1,$2,$3,$4,$5,$6,$7)$$;
create or replace function public.activate_retention_policy(uuid,uuid,text,text) returns jsonb language sql security definer set search_path=app,public,pg_temp as $$select app.activate_retention_policy($1,$2,$3,$4)$$;
create or replace function public.create_retention_legal_hold(uuid,uuid,public.legal_hold_reason_code,text,timestamptz,text) returns jsonb language sql security definer set search_path=app,public,pg_temp as $$select app.create_retention_legal_hold($1,$2,$3,$4,$5,$6)$$;
create or replace function public.release_retention_legal_hold(uuid,uuid,text,text) returns jsonb language sql security definer set search_path=app,public,pg_temp as $$select app.release_retention_legal_hold($1,$2,$3,$4)$$;
create or replace function public.approve_retention_batch(uuid,uuid,text,text) returns jsonb language sql security definer set search_path=app,public,pg_temp as $$select app.approve_retention_batch($1,$2,$3,$4)$$;
create or replace function public.evaluate_retention_health(target_organization_id uuid) returns jsonb language sql security definer set search_path=app,public,pg_temp as $$select app.evaluate_retention_health($1)$$;

do $$ begin
  revoke all on function public.create_retention_policy(uuid,integer,text,timestamptz,text,jsonb,text) from public;
  revoke all on function public.activate_retention_policy(uuid,uuid,text,text) from public;
  revoke all on function public.create_retention_legal_hold(uuid,uuid,public.legal_hold_reason_code,text,timestamptz,text) from public;
  revoke all on function public.release_retention_legal_hold(uuid,uuid,text,text) from public;
  revoke all on function public.approve_retention_batch(uuid,uuid,text,text) from public;
  revoke all on function public.evaluate_retention_health(uuid) from public;
  grant execute on function public.create_retention_policy(uuid,integer,text,timestamptz,text,jsonb,text) to authenticated;
  grant execute on function public.activate_retention_policy(uuid,uuid,text,text) to authenticated;
  grant execute on function public.create_retention_legal_hold(uuid,uuid,public.legal_hold_reason_code,text,timestamptz,text) to authenticated;
  grant execute on function public.release_retention_legal_hold(uuid,uuid,text,text) to authenticated;
  grant execute on function public.approve_retention_batch(uuid,uuid,text,text) to authenticated;
  grant execute on function public.evaluate_retention_health(uuid) to authenticated;
  if exists(select 1 from pg_roles where rolname='service_role') then
    revoke all on function app.create_contact_deletion_item(uuid,uuid,timestamptz) from service_role;
    revoke all on function app.assess_contact_deletion(uuid) from service_role;
    revoke all on function app.execute_contact_deletion(uuid) from service_role;
    grant execute on function app.record_retention_subject_clock(uuid,uuid,text,timestamptz,text,text) to service_role;
    grant execute on function app.run_retention_reconciler(uuid,text) to service_role;
    grant execute on function app.execute_retention_batch(uuid,uuid,text) to service_role;
    grant execute on function app.finalize_retention_batch(uuid,uuid,text) to service_role;
    grant execute on function app.record_retention_provider_propagation(uuid,uuid,text,text,text,text) to service_role;
    grant execute on function app.canonical_retention_tombstone_manifest_sha256(jsonb) to service_role;
    grant execute on function app.reapply_retention_tombstones(uuid,text,jsonb,text) to service_role;
    grant select on public.retention_command_ledger,public.retention_reconciliation_runs,public.retention_provider_propagations,public.retention_restore_reconciliation_runs,public.retention_restore_tombstone_entries to service_role;
  end if;
end $$;

revoke all on function app.retention_invoker_role() from public,authenticated;
revoke all on function app.retention_now() from public,authenticated;
revoke all on function app.retention_assert_admin(uuid) from public,authenticated;
revoke all on function app.retention_assert_service() from public,authenticated;
revoke all on function app.retention_internal_executor() from public,authenticated,service_role;
revoke all on function app.retention_request_sha(jsonb) from public,authenticated;
revoke all on function app.retention_command_begin(uuid,text,text,jsonb) from public,authenticated;
revoke all on function app.retention_command_finish(uuid,text,text,jsonb) from public,authenticated;
revoke all on function app.prevent_retention_direct_write() from public,authenticated;
revoke all on function app.retention_live_audit_snapshot(text,jsonb) from public,authenticated;
revoke all on function app.capture_retention_live_audit() from public,authenticated;
revoke all on function app.create_retention_policy(uuid,integer,text,timestamptz,text,jsonb,text) from public,authenticated;
revoke all on function app.activate_retention_policy(uuid,uuid,text,text) from public,authenticated;
revoke all on function app.create_retention_legal_hold(uuid,uuid,public.legal_hold_reason_code,text,timestamptz,text) from public,authenticated;
revoke all on function app.release_retention_legal_hold(uuid,uuid,text,text) from public,authenticated;
revoke all on function app.record_retention_subject_clock(uuid,uuid,text,timestamptz,text,text) from public,authenticated;
revoke all on function app.run_retention_reconciler(uuid,text) from public,authenticated;
revoke all on function app.approve_retention_batch(uuid,uuid,text,text) from public,authenticated;
revoke all on function app.execute_retention_batch(uuid,uuid,text) from public,authenticated;
revoke all on function app.enforce_retention_batch_completion() from public,authenticated;
revoke all on function app.finalize_retention_batch(uuid,uuid,text) from public,authenticated;
revoke all on function app.create_retention_provider_ledger() from public,authenticated;
revoke all on function app.record_retention_provider_propagation(uuid,uuid,text,text,text,text) from public,authenticated;
revoke all on function app.reapply_contact_retention_tombstone(uuid,uuid,text) from public,authenticated;
revoke all on function app.canonical_retention_tombstone_manifest_sha256(jsonb) from public,authenticated;
revoke all on function app.reapply_retention_tombstones(uuid,text,jsonb,text) from public,authenticated;
revoke all on function app.evaluate_retention_health(uuid) from public,authenticated;

commit;
