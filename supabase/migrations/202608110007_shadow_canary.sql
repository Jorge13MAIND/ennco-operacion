begin;

create type public.shadow_canary_status as enum ('PLANNED', 'RUNNING', 'COMPLETED', 'CANCELLED');
create type public.canary_observation_outcome as enum ('PASS', 'FAIL', 'UNKNOWN');

alter table public.campaigns
  add constraint campaigns_organization_id_id_unique unique (organization_id, id);

create table public.shadow_canary_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  evidence_class public.evidence_class not null,
  environment text not null check (environment in ('local', 'staging')),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  status public.shadow_canary_status not null default 'PLANNED',
  started_on date not null,
  ended_on date,
  decision public.gate_decision,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id)
    on delete cascade,
  unique (organization_id, id),
  check (ended_on is null or ended_on >= started_on),
  check ((status = 'COMPLETED') = (ended_on is not null)),
  check ((decision is null) = (decided_at is null)),
  check (evidence_class = 'live' or decision is distinct from 'PASS'),
  check ((evidence_class = 'synthetic_demo' and environment = 'local') or evidence_class = 'live')
);

create table public.shadow_canary_days (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null,
  observed_on date not null,
  scenario_count integer not null check (scenario_count > 0),
  passed_count integer not null check (passed_count >= 0),
  failed_count integer not null check (failed_count >= 0),
  unknown_count integer not null check (unknown_count >= 0),
  p0_count integer not null default 0 check (p0_count >= 0),
  p1_count integer not null default 0 check (p1_count >= 0),
  external_side_effect_count integer not null default 0 check (external_side_effect_count >= 0),
  reconciliation_ok boolean not null default false,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (organization_id, run_id)
    references public.shadow_canary_runs (organization_id, id)
    on delete cascade,
  unique (organization_id, run_id, observed_on),
  check (passed_count + failed_count + unknown_count = scenario_count)
);

create table public.shadow_canary_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null,
  canary_day_id uuid not null references public.shadow_canary_days(id) on delete cascade,
  scenario_key text not null check (scenario_key ~ '^[A-Z0-9_]{3,80}$'),
  category text not null check (category in ('GOLDEN_PATH', 'SAFETY', 'RELIABILITY', 'RECOVERY', 'LOAD', 'SECURITY')),
  outcome public.canary_observation_outcome not null,
  failure_injected boolean not null default false,
  assertion_sha256 text not null check (assertion_sha256 ~ '^[a-f0-9]{64}$'),
  correlation_id uuid not null,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, run_id)
    references public.shadow_canary_runs (organization_id, id)
    on delete cascade,
  unique (organization_id, run_id, canary_day_id, scenario_key)
);

create index shadow_canary_days_run_idx
on public.shadow_canary_days (organization_id, run_id, observed_on);

create index shadow_canary_observations_run_idx
on public.shadow_canary_observations (organization_id, run_id, observed_at);

create trigger shadow_canary_runs_updated_at
before update on public.shadow_canary_runs
for each row execute function app.set_updated_at();

create or replace function app.enforce_shadow_observation_tenant()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.shadow_canary_days d
    where d.id = new.canary_day_id
      and d.organization_id = new.organization_id
      and d.run_id = new.run_id
  ) then
    raise exception 'TENANT_REFERENCE_MISMATCH:shadow_canary_observations';
  end if;
  return new;
end;
$$;

create trigger shadow_canary_observations_tenant_integrity
before insert or update of organization_id, run_id, canary_day_id
on public.shadow_canary_observations
for each row execute function app.enforce_shadow_observation_tenant();

create or replace function app.capture_shadow_canary_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  raw_data jsonb;
  safe_old jsonb;
  safe_new jsonb;
  org_id uuid;
  row_id uuid;
  correlation_id_value uuid;
begin
  raw_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  org_id := nullif(raw_data ->> 'organization_id', '')::uuid;
  row_id := nullif(raw_data ->> 'id', '')::uuid;
  correlation_id_value := case
    when tg_table_name = 'shadow_canary_observations'
      then nullif(raw_data ->> 'correlation_id', '')::uuid
    else null
  end;

  if tg_op in ('UPDATE', 'DELETE') then
    safe_old := case
      when tg_table_name = 'shadow_canary_runs' then jsonb_strip_nulls(jsonb_build_object(
        'id', to_jsonb(old) -> 'id',
        'organization_id', to_jsonb(old) -> 'organization_id',
        'campaign_id', to_jsonb(old) -> 'campaign_id',
        'evidence_class', to_jsonb(old) -> 'evidence_class',
        'environment', to_jsonb(old) -> 'environment',
        'manifest_sha256', to_jsonb(old) -> 'manifest_sha256',
        'status', to_jsonb(old) -> 'status',
        'started_on', to_jsonb(old) -> 'started_on',
        'ended_on', to_jsonb(old) -> 'ended_on',
        'decision', to_jsonb(old) -> 'decision',
        'decided_at', to_jsonb(old) -> 'decided_at'
      ))
      when tg_table_name = 'shadow_canary_days' then jsonb_strip_nulls(jsonb_build_object(
        'id', to_jsonb(old) -> 'id',
        'organization_id', to_jsonb(old) -> 'organization_id',
        'run_id', to_jsonb(old) -> 'run_id',
        'observed_on', to_jsonb(old) -> 'observed_on',
        'scenario_count', to_jsonb(old) -> 'scenario_count',
        'passed_count', to_jsonb(old) -> 'passed_count',
        'failed_count', to_jsonb(old) -> 'failed_count',
        'unknown_count', to_jsonb(old) -> 'unknown_count',
        'p0_count', to_jsonb(old) -> 'p0_count',
        'p1_count', to_jsonb(old) -> 'p1_count',
        'external_side_effect_count', to_jsonb(old) -> 'external_side_effect_count',
        'reconciliation_ok', to_jsonb(old) -> 'reconciliation_ok',
        'evidence_sha256', to_jsonb(old) -> 'evidence_sha256'
      ))
      else jsonb_strip_nulls(jsonb_build_object(
        'id', to_jsonb(old) -> 'id',
        'organization_id', to_jsonb(old) -> 'organization_id',
        'run_id', to_jsonb(old) -> 'run_id',
        'canary_day_id', to_jsonb(old) -> 'canary_day_id',
        'scenario_key', to_jsonb(old) -> 'scenario_key',
        'category', to_jsonb(old) -> 'category',
        'outcome', to_jsonb(old) -> 'outcome',
        'failure_injected', to_jsonb(old) -> 'failure_injected',
        'assertion_sha256', to_jsonb(old) -> 'assertion_sha256',
        'correlation_id', to_jsonb(old) -> 'correlation_id',
        'observed_at', to_jsonb(old) -> 'observed_at'
      ))
    end;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    safe_new := case
      when tg_table_name = 'shadow_canary_runs' then jsonb_strip_nulls(jsonb_build_object(
        'id', to_jsonb(new) -> 'id',
        'organization_id', to_jsonb(new) -> 'organization_id',
        'campaign_id', to_jsonb(new) -> 'campaign_id',
        'evidence_class', to_jsonb(new) -> 'evidence_class',
        'environment', to_jsonb(new) -> 'environment',
        'manifest_sha256', to_jsonb(new) -> 'manifest_sha256',
        'status', to_jsonb(new) -> 'status',
        'started_on', to_jsonb(new) -> 'started_on',
        'ended_on', to_jsonb(new) -> 'ended_on',
        'decision', to_jsonb(new) -> 'decision',
        'decided_at', to_jsonb(new) -> 'decided_at'
      ))
      when tg_table_name = 'shadow_canary_days' then jsonb_strip_nulls(jsonb_build_object(
        'id', to_jsonb(new) -> 'id',
        'organization_id', to_jsonb(new) -> 'organization_id',
        'run_id', to_jsonb(new) -> 'run_id',
        'observed_on', to_jsonb(new) -> 'observed_on',
        'scenario_count', to_jsonb(new) -> 'scenario_count',
        'passed_count', to_jsonb(new) -> 'passed_count',
        'failed_count', to_jsonb(new) -> 'failed_count',
        'unknown_count', to_jsonb(new) -> 'unknown_count',
        'p0_count', to_jsonb(new) -> 'p0_count',
        'p1_count', to_jsonb(new) -> 'p1_count',
        'external_side_effect_count', to_jsonb(new) -> 'external_side_effect_count',
        'reconciliation_ok', to_jsonb(new) -> 'reconciliation_ok',
        'evidence_sha256', to_jsonb(new) -> 'evidence_sha256'
      ))
      else jsonb_strip_nulls(jsonb_build_object(
        'id', to_jsonb(new) -> 'id',
        'organization_id', to_jsonb(new) -> 'organization_id',
        'run_id', to_jsonb(new) -> 'run_id',
        'canary_day_id', to_jsonb(new) -> 'canary_day_id',
        'scenario_key', to_jsonb(new) -> 'scenario_key',
        'category', to_jsonb(new) -> 'category',
        'outcome', to_jsonb(new) -> 'outcome',
        'failure_injected', to_jsonb(new) -> 'failure_injected',
        'assertion_sha256', to_jsonb(new) -> 'assertion_sha256',
        'correlation_id', to_jsonb(new) -> 'correlation_id',
        'observed_at', to_jsonb(new) -> 'observed_at'
      ))
    end;
  end if;

  insert into public.audit_log (
    organization_id, actor_user_id, action, record_type, record_id, correlation_id, old_data, new_data
  ) values (
    org_id, auth.uid(), tg_op, tg_table_name, row_id, correlation_id_value, safe_old, safe_new
  );
  return coalesce(new, old);
end;
$$;

create trigger shadow_canary_runs_audit
after insert or update or delete on public.shadow_canary_runs
for each row execute function app.capture_shadow_canary_audit();

create trigger shadow_canary_days_audit
after insert or update or delete on public.shadow_canary_days
for each row execute function app.capture_shadow_canary_audit();

create trigger shadow_canary_observations_audit
after insert or update or delete on public.shadow_canary_observations
for each row execute function app.capture_shadow_canary_audit();

create or replace function app.assess_shadow_canary(target_run_id uuid)
returns public.gate_decision
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  run_record public.shadow_canary_runs%rowtype;
  campaign_manifest_sha256 text;
  day_count integer;
  min_day date;
  max_day date;
  scenario_total integer;
  observation_total integer;
  failed_total integer;
  unknown_total integer;
  p0_total integer;
  p1_total integer;
  external_total integer;
  reconciliation_failures integer;
begin
  select * into run_record
  from public.shadow_canary_runs
  where id = target_run_id;
  if not found then raise exception 'SHADOW_CANARY_RUN_NOT_FOUND'; end if;

  select manifest_sha256 into campaign_manifest_sha256
  from public.campaigns
  where id = run_record.campaign_id
    and organization_id = run_record.organization_id;
  if campaign_manifest_sha256 is null then raise exception 'SHADOW_CANARY_CAMPAIGN_NOT_FOUND'; end if;

  if run_record.evidence_class = 'synthetic_demo' then return 'EXTEND'; end if;
  if run_record.environment <> 'staging' then return 'EXTEND'; end if;
  if run_record.manifest_sha256 <> campaign_manifest_sha256 then return 'KILL'; end if;
  if run_record.status <> 'COMPLETED' or run_record.ended_on is null then return 'EXTEND'; end if;
  if run_record.ended_on - run_record.started_on <> 13 then return 'EXTEND'; end if;

  select
    count(*), min(observed_on), max(observed_on),
    coalesce(sum(scenario_count), 0), coalesce(sum(failed_count), 0),
    coalesce(sum(unknown_count), 0), coalesce(sum(p0_count), 0),
    coalesce(sum(p1_count), 0), coalesce(sum(external_side_effect_count), 0),
    count(*) filter (where not reconciliation_ok)
  into
    day_count, min_day, max_day, scenario_total, failed_total,
    unknown_total, p0_total, p1_total, external_total, reconciliation_failures
  from public.shadow_canary_days
  where run_id = run_record.id
    and organization_id = run_record.organization_id;

  if day_count <> 14 or min_day <> run_record.started_on or max_day <> run_record.ended_on then return 'EXTEND'; end if;

  select count(*) into observation_total
  from public.shadow_canary_observations
  where run_id = run_record.id
    and organization_id = run_record.organization_id;

  if external_total > 0 or p0_total > 0 then return 'KILL'; end if;
  if failed_total > 0 or unknown_total > 0 or p1_total > 0 or reconciliation_failures > 0 then return 'EXTEND'; end if;
  if scenario_total <> observation_total then return 'EXTEND'; end if;
  if exists (
    select 1
    from public.shadow_canary_observations
    where run_id = run_record.id
      and organization_id = run_record.organization_id
      and outcome <> 'PASS'
  ) then return 'EXTEND'; end if;

  return 'PASS';
end;
$$;

create or replace function app.finalize_shadow_canary(target_run_id uuid)
returns public.gate_decision
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  run_record public.shadow_canary_runs%rowtype;
  assessed public.gate_decision;
begin
  if coalesce(nullif(current_setting('role', true), 'none'), session_user) not in ('service_role', 'supabase_admin') then
    raise exception 'SHADOW_CANARY_SERVICE_ONLY';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('shadow-canary:' || target_run_id::text, 0));
  select * into run_record
  from public.shadow_canary_runs
  where id = target_run_id
  for update;
  if not found then raise exception 'SHADOW_CANARY_RUN_NOT_FOUND'; end if;

  assessed := app.assess_shadow_canary(target_run_id);
  update public.shadow_canary_runs
  set decision = assessed, decided_at = now()
  where id = target_run_id;

  if run_record.evidence_class = 'live' then
    update public.campaigns
    set shadow_canary_decision = assessed
    where id = run_record.campaign_id
      and organization_id = run_record.organization_id;
  end if;

  return assessed;
end;
$$;

alter table public.shadow_canary_runs enable row level security;
alter table public.shadow_canary_days enable row level security;
alter table public.shadow_canary_observations enable row level security;

create policy shadow_canary_runs_member_read on public.shadow_canary_runs
for select using (app.is_member(organization_id));

create policy shadow_canary_days_member_read on public.shadow_canary_days
for select using (app.is_member(organization_id));

create policy shadow_canary_observations_member_read on public.shadow_canary_observations
for select using (app.is_member(organization_id));

revoke all on table public.shadow_canary_runs from public;
revoke all on table public.shadow_canary_days from public;
revoke all on table public.shadow_canary_observations from public;
revoke all on function app.assess_shadow_canary(uuid) from public;
revoke all on function app.finalize_shadow_canary(uuid) from public;
revoke all on function app.enforce_shadow_observation_tenant() from public;
revoke all on function app.capture_shadow_canary_audit() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on public.shadow_canary_runs, public.shadow_canary_days, public.shadow_canary_observations to authenticated;
    revoke insert, update, delete, truncate on public.shadow_canary_runs, public.shadow_canary_days, public.shadow_canary_observations from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.shadow_canary_runs, public.shadow_canary_days, public.shadow_canary_observations to service_role;
    grant execute on function app.assess_shadow_canary(uuid) to service_role;
    grant execute on function app.finalize_shadow_canary(uuid) to service_role;
  end if;
end;
$$;

commit;
