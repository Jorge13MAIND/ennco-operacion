\set ON_ERROR_STOP on

insert into public.organizations (id, slug, legal_name) values
  ('b1000000-0000-4000-8000-000000000001', 'm9-org', 'M9 Synthetic Organization'),
  ('b1000000-0000-4000-8000-000000000002', 'm9-other', 'M9 Other Synthetic Organization');

insert into public.organization_users (organization_id, user_id, role) values
  ('b1000000-0000-4000-8000-000000000001', 'b9000000-0000-4000-8000-000000000009', 'teckel_admin'),
  ('b1000000-0000-4000-8000-000000000001', 'b8000000-0000-4000-8000-000000000008', 'ennco_admin'),
  ('b1000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000007', 'ennco_operator'),
  ('b1000000-0000-4000-8000-000000000002', 'b6000000-0000-4000-8000-000000000006', 'ennco_admin');

create temporary table m9_ids (key text primary key, id uuid not null);
grant select, insert, update, delete on m9_ids to service_role, authenticated;

set role service_role;
insert into m9_ids values (
  'local_package',
  app.create_handoff_package(
    'b1000000-0000-4000-8000-000000000001', repeat('1', 40), repeat('a', 64),
    'synthetic_demo', 'b9000000-0000-4000-8000-000000000009'
  )
);

select app.add_handoff_artifact(
  (select id from m9_ids where key = 'local_package'), artifact_key,
  'evidence/m9/' || lower(artifact_key), repeat('b', 64), true,
  'synthetic_demo', 'b9000000-0000-4000-8000-000000000009'
)
from unnest(array[
  'SOURCE_ARCHIVE', 'EXPORT_MANIFEST', 'RESTORE_REPORT',
  'SECURITY_TEST_REPORT', 'RUNBOOK_PACK', 'TRAINING_SCRIPT'
]) artifact_key;

select app.record_handoff_check(
  (select id from m9_ids where key = 'local_package'), check_code,
  'PASS', 'synthetic_demo', repeat('c', 64), 'LOCAL_SYNTHETIC_PASS',
  'b9000000-0000-4000-8000-000000000009'
)
from unnest(array[
  'SOURCE_PACKAGE_LOCAL', 'EXPORT_REIMPORT_LOCAL', 'SECOND_RESTORE_LOCAL',
  'SECURITY_REGRESSION_LOCAL', 'RUNBOOK_INDEX_LOCAL', 'TRAINING_SCRIPT_LOCAL'
]::public.handoff_check_code[]) check_code;

do $$
declare
  first_id uuid;
  second_id uuid;
begin
  first_id := app.create_handoff_package(
    'b1000000-0000-4000-8000-000000000001', repeat('1', 40), repeat('a', 64),
    'synthetic_demo', 'b9000000-0000-4000-8000-000000000009'
  );
  select id into second_id from m9_ids where key = 'local_package';
  if first_id <> second_id then raise exception 'package creation is not idempotent'; end if;
end;
$$;

do $$
declare package_status public.handoff_package_status;
begin
  package_status := app.seal_handoff_package((select id from m9_ids where key = 'local_package'));
  if package_status <> 'EVIDENCE_READY' then raise exception 'local package did not seal as EVIDENCE_READY'; end if;
end;
$$;
reset role;

do $$
begin
  begin
    update public.handoff_artifacts set location = 'tampered'
    where package_id = (select id from m9_ids where key = 'local_package');
    raise exception 'artifact mutation accepted';
  exception when others then
    if sqlerrm = 'artifact mutation accepted' then raise; end if;
  end;
  begin
    delete from public.handoff_readiness_checks
    where package_id = (select id from m9_ids where key = 'local_package');
    raise exception 'check deletion accepted';
  exception when others then
    if sqlerrm = 'check deletion accepted' then raise; end if;
  end;
end;
$$;

set role service_role;
insert into m9_ids values (
  'live_package',
  app.create_handoff_package(
    'b1000000-0000-4000-8000-000000000001', repeat('2', 40), repeat('d', 64),
    'live', 'b9000000-0000-4000-8000-000000000009'
  )
);
select app.add_handoff_artifact(
  (select id from m9_ids where key = 'live_package'), artifact_key,
  'evidence/live/' || lower(artifact_key), repeat('e', 64), true,
  'live', 'b9000000-0000-4000-8000-000000000009'
)
from unnest(array[
  'SOURCE_ARCHIVE', 'SBOM', 'DATABASE_BACKUP', 'STORAGE_BACKUP',
  'EXPORT_MANIFEST', 'RESTORE_REPORT', 'SECURITY_TEST_REPORT', 'RUNBOOK_PACK',
  'UAT_EVIDENCE', 'TRAINING_EVIDENCE', 'ACCESS_INVENTORY', 'PROVIDER_INVENTORY'
]) artifact_key;
select app.record_handoff_check(
  (select id from m9_ids where key = 'live_package'), check_code,
  'PASS', 'live', repeat('f', 64), 'LIVE_FIXTURE_PASS',
  'b9000000-0000-4000-8000-000000000009'
)
from unnest(array[
  'SOURCE_CONTROL_OWNERSHIP', 'PRODUCTION_ACCESS_TRANSFER', 'PROVIDER_INVENTORY_ACCEPTED',
  'SECOND_RESTORE_LIVE', 'SECURITY_AUDIT_LIVE', 'UAT_CLIENT', 'TRAINING_OPERATOR_LIVE',
  'EXPORT_REIMPORT_LIVE', 'RUNBOOK_WALKTHROUGH', 'ZERO_P0_P1'
]::public.handoff_check_code[]) check_code;
select app.record_handoff_training(
  (select id from m9_ids where key = 'live_package'), 'ennco_operator', 'HELD',
  'live', repeat('9', 64), 'b9000000-0000-4000-8000-000000000009',
  'b7000000-0000-4000-8000-000000000007', now() - interval '2 hours', now() - interval '1 hour'
);
reset role;

insert into public.incidents (
  id, organization_id, severity, title, status
) values (
  'ba000000-0000-4000-8000-000000000010',
  'b1000000-0000-4000-8000-000000000001', 'P1', 'M9 synthetic blocker', 'OPEN'
);

set role service_role;
do $$
begin
  begin
    perform app.seal_handoff_package((select id from m9_ids where key = 'live_package'));
    raise exception 'package sealed with open P1';
  exception when others then
    if sqlerrm = 'package sealed with open P1' then raise; end if;
    if position('HANDOFF_OPEN_P0_P1' in sqlerrm) = 0 then raise; end if;
  end;
end;
$$;
reset role;

update public.incidents
set status = 'RESOLVED', resolved_at = now()
where id = 'ba000000-0000-4000-8000-000000000010';

set role service_role;
do $$
declare package_status public.handoff_package_status;
begin
  package_status := app.seal_handoff_package((select id from m9_ids where key = 'live_package'));
  if package_status <> 'READY_FOR_ACCEPTANCE' then raise exception 'live package not ready for acceptance'; end if;
end;
$$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', 'b6000000-0000-4000-8000-000000000006', false);
do $$
begin
  begin
    perform app.accept_handoff_package((select id from m9_ids where key = 'live_package'), repeat('8', 64));
    raise exception 'cross-tenant acceptance accepted';
  exception when others then
    if sqlerrm = 'cross-tenant acceptance accepted' then raise; end if;
    if position('HANDOFF_ACCEPTANCE_ENNCO_ADMIN_REQUIRED' in sqlerrm) = 0 then raise; end if;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', 'b8000000-0000-4000-8000-000000000008', false);
do $$
begin
  begin
    insert into public.approvals (
      organization_id, subject_type, subject_id, subject_sha256, decision, decided_by
    ) values (
      'b1000000-0000-4000-8000-000000000001', 'final_handoff_acceptance',
      (select id from m9_ids where key = 'local_package'), repeat('a', 64), 'APPROVED',
      'b8000000-0000-4000-8000-000000000008'
    );
    perform app.accept_handoff_package((select id from m9_ids where key = 'local_package'), repeat('8', 64));
    raise exception 'synthetic package accepted';
  exception when others then
    if sqlerrm = 'synthetic package accepted' then raise; end if;
    if position('HANDOFF_NOT_READY_FOR_ACCEPTANCE' in sqlerrm) = 0 then raise; end if;
  end;
end;
$$;

insert into public.approvals (
  organization_id, subject_type, subject_id, subject_sha256, decision, decided_by
) values (
  'b1000000-0000-4000-8000-000000000001', 'final_handoff_acceptance',
  (select id from m9_ids where key = 'live_package'), repeat('d', 64), 'APPROVED',
  'b8000000-0000-4000-8000-000000000008'
);

do $$
declare
  first_acceptance uuid;
  second_acceptance uuid;
begin
  first_acceptance := app.accept_handoff_package((select id from m9_ids where key = 'live_package'), repeat('8', 64));
  second_acceptance := app.accept_handoff_package((select id from m9_ids where key = 'live_package'), repeat('8', 64));
  if first_acceptance <> second_acceptance then raise exception 'acceptance is not idempotent'; end if;
  begin
    perform app.accept_handoff_package((select id from m9_ids where key = 'live_package'), repeat('7', 64));
    raise exception 'acceptance statement drift accepted';
  exception when others then
    if sqlerrm = 'acceptance statement drift accepted' then raise; end if;
    if position('HANDOFF_ACCEPTANCE_STATEMENT_DRIFT' in sqlerrm) = 0 then raise; end if;
  end;
end;
$$;
reset role;

do $$
begin
  if (select status from public.handoff_packages where id = (select id from m9_ids where key = 'local_package')) <> 'EVIDENCE_READY' then
    raise exception 'local evidence changed into acceptance';
  end if;
  if (select status from public.handoff_packages where id = (select id from m9_ids where key = 'live_package')) <> 'ACCEPTED' then
    raise exception 'live package acceptance not recorded';
  end if;
  if (select count(*) from public.final_acceptances where package_id = (select id from m9_ids where key = 'live_package')) <> 1 then
    raise exception 'acceptance cardinality invalid';
  end if;
  if exists (
    select 1 from public.audit_log
    where (record_type like 'handoff%' or record_type = 'final_acceptances')
      and coalesce(old_data::text, '') || coalesce(new_data::text, '') like '%evidence/live/source_archive%'
  ) then raise exception 'handoff artifact location leaked into audit'; end if;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', 'b6000000-0000-4000-8000-000000000006', false);
do $$
begin
  if exists (select 1 from public.handoff_packages where organization_id = 'b1000000-0000-4000-8000-000000000001') then
    raise exception 'cross-tenant RLS disclosure';
  end if;
end;
$$;
reset role;

select 'HANDOFF_ACCEPTANCE_GATE_PASS' as result;
