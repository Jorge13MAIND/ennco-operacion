begin;

create type public.handoff_package_status as enum (
  'DRAFT', 'EVIDENCE_READY', 'READY_FOR_ACCEPTANCE', 'ACCEPTED', 'REJECTED'
);
create type public.handoff_check_status as enum ('UNKNOWN', 'PASS', 'EXTEND', 'KILL');
create type public.handoff_training_status as enum ('SCHEDULED', 'HELD', 'CANCELLED');
create type public.handoff_check_code as enum (
  'SOURCE_PACKAGE_LOCAL',
  'EXPORT_REIMPORT_LOCAL',
  'SECOND_RESTORE_LOCAL',
  'SECURITY_REGRESSION_LOCAL',
  'RUNBOOK_INDEX_LOCAL',
  'TRAINING_SCRIPT_LOCAL',
  'SOURCE_CONTROL_OWNERSHIP',
  'PRODUCTION_ACCESS_TRANSFER',
  'PROVIDER_INVENTORY_ACCEPTED',
  'SECOND_RESTORE_LIVE',
  'SECURITY_AUDIT_LIVE',
  'UAT_CLIENT',
  'TRAINING_OPERATOR_LIVE',
  'EXPORT_REIMPORT_LIVE',
  'RUNBOOK_WALKTHROUGH',
  'ZERO_P0_P1'
);

create table public.handoff_packages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_commit_sha text not null check (source_commit_sha ~ '^[a-f0-9]{40}$'),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_class public.evidence_class not null,
  status public.handoff_package_status not null default 'DRAFT',
  created_by uuid not null,
  created_at timestamptz not null default now(),
  sealed_at timestamptz,
  accepted_at timestamptz,
  unique (organization_id, id),
  unique (organization_id, manifest_sha256),
  check (
    (status = 'DRAFT' and sealed_at is null and accepted_at is null)
    or (status in ('EVIDENCE_READY', 'READY_FOR_ACCEPTANCE') and sealed_at is not null and accepted_at is null)
    or (status = 'ACCEPTED' and sealed_at is not null and accepted_at is not null)
    or (status = 'REJECTED' and accepted_at is null)
  )
);

create table public.handoff_artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  package_id uuid not null,
  artifact_key text not null check (artifact_key ~ '^[A-Z0-9_]{3,80}$'),
  location text not null check (length(location) between 1 and 500),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  required boolean not null default true,
  evidence_class public.evidence_class not null,
  verified_by uuid not null,
  verified_at timestamptz not null default now(),
  foreign key (organization_id, package_id)
    references public.handoff_packages(organization_id, id) on delete cascade,
  unique (organization_id, package_id, artifact_key),
  unique (organization_id, id)
);

create table public.handoff_readiness_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  package_id uuid not null,
  check_code public.handoff_check_code not null,
  status public.handoff_check_status not null,
  evidence_class public.evidence_class not null,
  evidence_sha256 text check (evidence_sha256 is null or evidence_sha256 ~ '^[a-f0-9]{64}$'),
  detail_code text not null check (detail_code ~ '^[A-Z0-9_]{3,100}$'),
  checked_by uuid not null,
  observed_at timestamptz not null default now(),
  foreign key (organization_id, package_id)
    references public.handoff_packages(organization_id, id) on delete cascade,
  unique (organization_id, package_id, check_code),
  unique (organization_id, id),
  check ((status = 'PASS') = (evidence_sha256 is not null))
);

create table public.handoff_training_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  package_id uuid not null,
  audience_role public.user_role not null,
  status public.handoff_training_status not null,
  evidence_class public.evidence_class not null,
  evidence_sha256 text check (evidence_sha256 is null or evidence_sha256 ~ '^[a-f0-9]{64}$'),
  trainer_user_id uuid not null,
  participant_user_id uuid,
  scheduled_at timestamptz not null,
  held_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, package_id)
    references public.handoff_packages(organization_id, id) on delete cascade,
  unique (organization_id, id),
  check (
    (status = 'SCHEDULED' and held_at is null and evidence_sha256 is null)
    or (status = 'HELD' and held_at is not null and evidence_sha256 is not null)
    or (status = 'CANCELLED' and held_at is null)
  ),
  check (evidence_class = 'live' or participant_user_id is null)
);

create table public.final_acceptances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  package_id uuid not null,
  package_manifest_sha256 text not null check (package_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  acceptance_statement_sha256 text not null check (acceptance_statement_sha256 ~ '^[a-f0-9]{64}$'),
  approval_id uuid not null,
  accepted_by uuid not null,
  accepted_at timestamptz not null default now(),
  foreign key (organization_id, package_id)
    references public.handoff_packages(organization_id, id),
  foreign key (organization_id, approval_id)
    references public.approvals(organization_id, id),
  unique (organization_id, package_id),
  unique (organization_id, id)
);

create or replace function app.prevent_handoff_evidence_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'HANDOFF_EVIDENCE_APPEND_ONLY';
end;
$$;

create trigger handoff_artifacts_append_only
before update or delete on public.handoff_artifacts
for each row execute function app.prevent_handoff_evidence_mutation();
create trigger handoff_readiness_checks_append_only
before update or delete on public.handoff_readiness_checks
for each row execute function app.prevent_handoff_evidence_mutation();
create trigger handoff_training_records_append_only
before update or delete on public.handoff_training_records
for each row execute function app.prevent_handoff_evidence_mutation();
create trigger final_acceptances_append_only
before update or delete on public.final_acceptances
for each row execute function app.prevent_handoff_evidence_mutation();

create or replace function app.enforce_approval_append_only()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  actor_id uuid;
begin
  if tg_op <> 'INSERT' then raise exception 'APPROVAL_APPEND_ONLY'; end if;
  actor_id := auth.uid();
  if actor_id is not null and new.decided_by <> actor_id then raise exception 'APPROVAL_ACTOR_MISMATCH'; end if;
  if new.subject_type in (
    'campaign_first_send_release', 'rollout_wave_release',
    'contractual_monthly_report_issue', 'recovery_experiment_release'
  ) and (
    actor_id is null
    or not app.has_role(new.organization_id, array['teckel_admin'::public.user_role])
  ) then raise exception 'CONTROLLED_RELEASE_APPROVAL_JORGE_ONLY'; end if;
  if new.subject_type = 'final_handoff_acceptance' and (
    actor_id is null
    or not app.has_role(new.organization_id, array['ennco_admin'::public.user_role])
  ) then raise exception 'HANDOFF_ACCEPTANCE_ENNCO_ADMIN_REQUIRED'; end if;
  return new;
end;
$$;

create trigger handoff_packages_audit
after insert or update or delete on public.handoff_packages
for each row execute function app.capture_audit_event();
create trigger handoff_artifacts_audit
after insert or update or delete on public.handoff_artifacts
for each row execute function app.capture_audit_event();
create trigger handoff_readiness_checks_audit
after insert or update or delete on public.handoff_readiness_checks
for each row execute function app.capture_audit_event();
create trigger handoff_training_records_audit
after insert or update or delete on public.handoff_training_records
for each row execute function app.capture_audit_event();
create trigger final_acceptances_audit
after insert or update or delete on public.final_acceptances
for each row execute function app.capture_audit_event();

create or replace function app.create_handoff_package(
  target_organization_id uuid,
  target_source_commit_sha text,
  target_manifest_sha256 text,
  target_evidence_class public.evidence_class,
  target_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  package_id uuid;
begin
  if target_source_commit_sha !~ '^[a-f0-9]{40}$' then raise exception 'HANDOFF_COMMIT_SHA_INVALID'; end if;
  if target_manifest_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'HANDOFF_MANIFEST_SHA_INVALID'; end if;
  if not exists (
    select 1 from public.organization_users
    where organization_id = target_organization_id and user_id = target_created_by and active
      and role in ('teckel_admin', 'teckel_operator')
  ) then raise exception 'HANDOFF_CREATOR_INVALID'; end if;

  insert into public.handoff_packages (
    organization_id, source_commit_sha, manifest_sha256, evidence_class, created_by
  ) values (
    target_organization_id, target_source_commit_sha, target_manifest_sha256,
    target_evidence_class, target_created_by
  ) on conflict (organization_id, manifest_sha256) do nothing
  returning id into package_id;

  if package_id is null then
    select id into package_id from public.handoff_packages
    where organization_id = target_organization_id and manifest_sha256 = target_manifest_sha256;
    if not exists (
      select 1 from public.handoff_packages
      where id = package_id
        and source_commit_sha = target_source_commit_sha
        and evidence_class = target_evidence_class
        and created_by = target_created_by
    ) then raise exception 'HANDOFF_IDEMPOTENCY_DRIFT'; end if;
  end if;
  return package_id;
end;
$$;

create or replace function app.add_handoff_artifact(
  target_package_id uuid,
  target_artifact_key text,
  target_location text,
  target_sha256 text,
  target_required boolean,
  target_evidence_class public.evidence_class,
  target_verified_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  package_record public.handoff_packages%rowtype;
  artifact_id uuid;
begin
  select * into package_record from public.handoff_packages where id = target_package_id for update;
  if not found then raise exception 'HANDOFF_PACKAGE_NOT_FOUND'; end if;
  if package_record.status <> 'DRAFT' then raise exception 'HANDOFF_PACKAGE_ALREADY_SEALED'; end if;
  if package_record.evidence_class <> target_evidence_class then raise exception 'HANDOFF_EVIDENCE_CLASS_MISMATCH'; end if;
  if not exists (
    select 1 from public.organization_users
    where organization_id = package_record.organization_id and user_id = target_verified_by and active
      and role in ('teckel_admin', 'teckel_operator', 'auditor_readonly')
  ) then raise exception 'HANDOFF_VERIFIER_INVALID'; end if;

  insert into public.handoff_artifacts (
    organization_id, package_id, artifact_key, location, sha256,
    required, evidence_class, verified_by
  ) values (
    package_record.organization_id, package_record.id, target_artifact_key, target_location,
    target_sha256, target_required, target_evidence_class, target_verified_by
  ) returning id into artifact_id;
  return artifact_id;
end;
$$;

create or replace function app.record_handoff_check(
  target_package_id uuid,
  target_check_code public.handoff_check_code,
  target_status public.handoff_check_status,
  target_evidence_class public.evidence_class,
  target_evidence_sha256 text,
  target_detail_code text,
  target_checked_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  package_record public.handoff_packages%rowtype;
  check_id uuid;
begin
  select * into package_record from public.handoff_packages where id = target_package_id for update;
  if not found then raise exception 'HANDOFF_PACKAGE_NOT_FOUND'; end if;
  if package_record.status <> 'DRAFT' then raise exception 'HANDOFF_PACKAGE_ALREADY_SEALED'; end if;
  if package_record.evidence_class <> target_evidence_class then raise exception 'HANDOFF_EVIDENCE_CLASS_MISMATCH'; end if;
  if (target_status = 'PASS') <> (target_evidence_sha256 is not null) then raise exception 'HANDOFF_PASS_EVIDENCE_REQUIRED'; end if;
  if not exists (
    select 1 from public.organization_users
    where organization_id = package_record.organization_id and user_id = target_checked_by and active
      and role in ('teckel_admin', 'teckel_operator', 'auditor_readonly')
  ) then raise exception 'HANDOFF_CHECKER_INVALID'; end if;

  insert into public.handoff_readiness_checks (
    organization_id, package_id, check_code, status, evidence_class,
    evidence_sha256, detail_code, checked_by
  ) values (
    package_record.organization_id, package_record.id, target_check_code, target_status,
    target_evidence_class, target_evidence_sha256, target_detail_code, target_checked_by
  ) returning id into check_id;
  return check_id;
end;
$$;

create or replace function app.record_handoff_training(
  target_package_id uuid,
  target_audience_role public.user_role,
  target_status public.handoff_training_status,
  target_evidence_class public.evidence_class,
  target_evidence_sha256 text,
  target_trainer_user_id uuid,
  target_participant_user_id uuid,
  target_scheduled_at timestamptz,
  target_held_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  package_record public.handoff_packages%rowtype;
  training_id uuid;
begin
  select * into package_record from public.handoff_packages where id = target_package_id for update;
  if not found then raise exception 'HANDOFF_PACKAGE_NOT_FOUND'; end if;
  if package_record.status <> 'DRAFT' then raise exception 'HANDOFF_PACKAGE_ALREADY_SEALED'; end if;
  if package_record.evidence_class <> target_evidence_class then raise exception 'HANDOFF_EVIDENCE_CLASS_MISMATCH'; end if;
  if not exists (
    select 1 from public.organization_users
    where organization_id = package_record.organization_id and user_id = target_trainer_user_id and active
      and role in ('teckel_admin', 'teckel_operator')
  ) then raise exception 'HANDOFF_TRAINER_INVALID'; end if;
  if target_evidence_class = 'live' and (
    target_participant_user_id is null or not exists (
      select 1 from public.organization_users
      where organization_id = package_record.organization_id and user_id = target_participant_user_id and active
        and role in ('ennco_admin', 'ennco_operator')
    )
  ) then raise exception 'HANDOFF_PARTICIPANT_INVALID'; end if;

  insert into public.handoff_training_records (
    organization_id, package_id, audience_role, status, evidence_class, evidence_sha256,
    trainer_user_id, participant_user_id, scheduled_at, held_at
  ) values (
    package_record.organization_id, package_record.id, target_audience_role, target_status,
    target_evidence_class, target_evidence_sha256, target_trainer_user_id,
    target_participant_user_id, target_scheduled_at, target_held_at
  ) returning id into training_id;
  return training_id;
end;
$$;

create or replace function app.seal_handoff_package(target_package_id uuid)
returns public.handoff_package_status
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  package_record public.handoff_packages%rowtype;
  passed_count integer;
  required_count integer;
  live_codes public.handoff_check_code[] := array[
    'SOURCE_CONTROL_OWNERSHIP', 'PRODUCTION_ACCESS_TRANSFER', 'PROVIDER_INVENTORY_ACCEPTED',
    'SECOND_RESTORE_LIVE', 'SECURITY_AUDIT_LIVE', 'UAT_CLIENT', 'TRAINING_OPERATOR_LIVE',
    'EXPORT_REIMPORT_LIVE', 'RUNBOOK_WALKTHROUGH', 'ZERO_P0_P1'
  ]::public.handoff_check_code[];
  local_codes public.handoff_check_code[] := array[
    'SOURCE_PACKAGE_LOCAL', 'EXPORT_REIMPORT_LOCAL', 'SECOND_RESTORE_LOCAL',
    'SECURITY_REGRESSION_LOCAL', 'RUNBOOK_INDEX_LOCAL', 'TRAINING_SCRIPT_LOCAL'
  ]::public.handoff_check_code[];
  local_artifact_keys text[] := array[
    'SOURCE_ARCHIVE', 'EXPORT_MANIFEST', 'RESTORE_REPORT',
    'SECURITY_TEST_REPORT', 'RUNBOOK_PACK', 'TRAINING_SCRIPT'
  ];
  live_artifact_keys text[] := array[
    'SOURCE_ARCHIVE', 'SBOM', 'DATABASE_BACKUP', 'STORAGE_BACKUP',
    'EXPORT_MANIFEST', 'RESTORE_REPORT', 'SECURITY_TEST_REPORT', 'RUNBOOK_PACK',
    'UAT_EVIDENCE', 'TRAINING_EVIDENCE', 'ACCESS_INVENTORY', 'PROVIDER_INVENTORY'
  ];
begin
  select * into package_record from public.handoff_packages where id = target_package_id for update;
  if not found then raise exception 'HANDOFF_PACKAGE_NOT_FOUND'; end if;
  if package_record.status <> 'DRAFT' then return package_record.status; end if;
  if not exists (
    select 1 from public.handoff_artifacts
    where organization_id = package_record.organization_id and package_id = package_record.id and required
  ) then raise exception 'HANDOFF_REQUIRED_ARTIFACTS_MISSING'; end if;
  if exists (
    select 1 from public.handoff_readiness_checks
    where organization_id = package_record.organization_id and package_id = package_record.id
      and status = 'KILL'
  ) then raise exception 'HANDOFF_KILL_PRESENT'; end if;

  if package_record.evidence_class = 'synthetic_demo' then
    select count(distinct artifact_key) into passed_count
    from public.handoff_artifacts
    where organization_id = package_record.organization_id and package_id = package_record.id
      and artifact_key = any(local_artifact_keys) and required
      and evidence_class = 'synthetic_demo';
    if passed_count <> cardinality(local_artifact_keys) then raise exception 'HANDOFF_LOCAL_ARTIFACTS_INCOMPLETE'; end if;
    required_count := cardinality(local_codes);
    select count(distinct check_code) into passed_count
    from public.handoff_readiness_checks
    where organization_id = package_record.organization_id and package_id = package_record.id
      and check_code = any(local_codes) and status = 'PASS'
      and evidence_class = 'synthetic_demo' and evidence_sha256 is not null;
    if passed_count <> required_count then raise exception 'HANDOFF_LOCAL_CHECKS_INCOMPLETE'; end if;
    update public.handoff_packages
    set status = 'EVIDENCE_READY', sealed_at = now()
    where id = package_record.id;
    return 'EVIDENCE_READY';
  end if;

  select count(distinct artifact_key) into passed_count
  from public.handoff_artifacts
  where organization_id = package_record.organization_id and package_id = package_record.id
    and artifact_key = any(live_artifact_keys) and required
    and evidence_class = 'live';
  if passed_count <> cardinality(live_artifact_keys) then raise exception 'HANDOFF_LIVE_ARTIFACTS_INCOMPLETE'; end if;
  required_count := cardinality(live_codes);
  select count(distinct check_code) into passed_count
  from public.handoff_readiness_checks
  where organization_id = package_record.organization_id and package_id = package_record.id
    and check_code = any(live_codes) and status = 'PASS'
    and evidence_class = 'live' and evidence_sha256 is not null;
  if passed_count <> required_count then raise exception 'HANDOFF_LIVE_CHECKS_INCOMPLETE'; end if;
  if not exists (
    select 1 from public.handoff_training_records
    where organization_id = package_record.organization_id and package_id = package_record.id
      and evidence_class = 'live' and status = 'HELD' and participant_user_id is not null
  ) then raise exception 'HANDOFF_LIVE_TRAINING_MISSING'; end if;
  if exists (
    select 1 from public.incidents
    where organization_id = package_record.organization_id and severity in ('P0', 'P1')
      and status <> 'RESOLVED'
  ) then raise exception 'HANDOFF_OPEN_P0_P1'; end if;

  update public.handoff_packages
  set status = 'READY_FOR_ACCEPTANCE', sealed_at = now()
  where id = package_record.id;
  return 'READY_FOR_ACCEPTANCE';
end;
$$;

create or replace function app.accept_handoff_package(
  target_package_id uuid,
  target_acceptance_statement_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  package_record public.handoff_packages%rowtype;
  approval_record public.approvals%rowtype;
  acceptance_id uuid;
  existing_statement_sha256 text;
  actor_id uuid := auth.uid();
begin
  if actor_id is null then raise exception 'HANDOFF_ACCEPTANCE_AUTH_REQUIRED'; end if;
  select * into package_record from public.handoff_packages where id = target_package_id for update;
  if not found then raise exception 'HANDOFF_PACKAGE_NOT_FOUND'; end if;
  if not app.has_role(package_record.organization_id, array['ennco_admin'::public.user_role]) then
    raise exception 'HANDOFF_ACCEPTANCE_ENNCO_ADMIN_REQUIRED';
  end if;
  if package_record.evidence_class <> 'live' or package_record.status not in ('READY_FOR_ACCEPTANCE', 'ACCEPTED') then
    raise exception 'HANDOFF_NOT_READY_FOR_ACCEPTANCE';
  end if;
  if target_acceptance_statement_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'HANDOFF_ACCEPTANCE_SHA_INVALID';
  end if;
  select * into approval_record
  from public.approvals
  where organization_id = package_record.organization_id
    and subject_type = 'final_handoff_acceptance'
    and subject_id = package_record.id
    and subject_sha256 = package_record.manifest_sha256
    and decision = 'APPROVED'
    and decided_by = actor_id
  order by decided_at desc
  limit 1;
  if not found then raise exception 'HANDOFF_EXPLICIT_APPROVAL_REQUIRED'; end if;

  select id, acceptance_statement_sha256 into acceptance_id, existing_statement_sha256
  from public.final_acceptances
  where organization_id = package_record.organization_id and package_id = package_record.id;
  if acceptance_id is not null then
    if existing_statement_sha256 <> target_acceptance_statement_sha256 then
      raise exception 'HANDOFF_ACCEPTANCE_STATEMENT_DRIFT';
    end if;
    return acceptance_id;
  end if;

  insert into public.final_acceptances (
    organization_id, package_id, package_manifest_sha256, acceptance_statement_sha256,
    approval_id, accepted_by
  ) values (
    package_record.organization_id, package_record.id, package_record.manifest_sha256,
    target_acceptance_statement_sha256, approval_record.id, actor_id
  ) returning id into acceptance_id;

  update public.handoff_packages
  set status = 'ACCEPTED', accepted_at = now()
  where id = package_record.id;
  return acceptance_id;
end;
$$;

alter table public.handoff_packages enable row level security;
alter table public.handoff_artifacts enable row level security;
alter table public.handoff_readiness_checks enable row level security;
alter table public.handoff_training_records enable row level security;
alter table public.final_acceptances enable row level security;

create policy handoff_packages_member_read on public.handoff_packages
for select using (app.is_member(organization_id));
create policy handoff_artifacts_member_read on public.handoff_artifacts
for select using (app.is_member(organization_id));
create policy handoff_checks_member_read on public.handoff_readiness_checks
for select using (app.is_member(organization_id));
create policy handoff_training_member_read on public.handoff_training_records
for select using (app.is_member(organization_id));
create policy final_acceptances_member_read on public.final_acceptances
for select using (app.is_member(organization_id));

revoke all on table public.handoff_packages, public.handoff_artifacts,
  public.handoff_readiness_checks, public.handoff_training_records,
  public.final_acceptances from public;
revoke all on function app.create_handoff_package(uuid, text, text, public.evidence_class, uuid) from public;
revoke all on function app.add_handoff_artifact(uuid, text, text, text, boolean, public.evidence_class, uuid) from public;
revoke all on function app.record_handoff_check(uuid, public.handoff_check_code, public.handoff_check_status, public.evidence_class, text, text, uuid) from public;
revoke all on function app.record_handoff_training(uuid, public.user_role, public.handoff_training_status, public.evidence_class, text, uuid, uuid, timestamptz, timestamptz) from public;
revoke all on function app.seal_handoff_package(uuid) from public;
revoke all on function app.accept_handoff_package(uuid, text) from public;

do $grant_roles$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on public.handoff_packages, public.handoff_artifacts,
      public.handoff_readiness_checks, public.handoff_training_records,
      public.final_acceptances to authenticated;
    revoke insert, update, delete, truncate on public.handoff_packages, public.handoff_artifacts,
      public.handoff_readiness_checks, public.handoff_training_records,
      public.final_acceptances from authenticated;
    grant execute on function app.accept_handoff_package(uuid, text) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on public.handoff_packages, public.handoff_artifacts,
      public.handoff_readiness_checks, public.handoff_training_records,
      public.final_acceptances to service_role;
    revoke insert, update, delete, truncate on public.handoff_packages, public.handoff_artifacts,
      public.handoff_readiness_checks, public.handoff_training_records,
      public.final_acceptances from service_role;
    grant execute on function app.create_handoff_package(uuid, text, text, public.evidence_class, uuid) to service_role;
    grant execute on function app.add_handoff_artifact(uuid, text, text, text, boolean, public.evidence_class, uuid) to service_role;
    grant execute on function app.record_handoff_check(uuid, public.handoff_check_code, public.handoff_check_status, public.evidence_class, text, text, uuid) to service_role;
    grant execute on function app.record_handoff_training(uuid, public.user_role, public.handoff_training_status, public.evidence_class, text, uuid, uuid, timestamptz, timestamptz) to service_role;
    grant execute on function app.seal_handoff_package(uuid) to service_role;
  end if;
end;
$grant_roles$;

commit;
