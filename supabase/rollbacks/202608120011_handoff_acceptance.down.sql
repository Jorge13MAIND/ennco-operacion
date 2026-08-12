begin;

drop policy if exists final_acceptances_member_read on public.final_acceptances;
drop policy if exists handoff_training_member_read on public.handoff_training_records;
drop policy if exists handoff_checks_member_read on public.handoff_readiness_checks;
drop policy if exists handoff_artifacts_member_read on public.handoff_artifacts;
drop policy if exists handoff_packages_member_read on public.handoff_packages;

drop function if exists app.accept_handoff_package(uuid, text);
drop function if exists app.seal_handoff_package(uuid);
drop function if exists app.record_handoff_training(uuid, public.user_role, public.handoff_training_status, public.evidence_class, text, uuid, uuid, timestamptz, timestamptz);
drop function if exists app.record_handoff_check(uuid, public.handoff_check_code, public.handoff_check_status, public.evidence_class, text, text, uuid);
drop function if exists app.add_handoff_artifact(uuid, text, text, text, boolean, public.evidence_class, uuid);
drop function if exists app.create_handoff_package(uuid, text, text, public.evidence_class, uuid);

drop table if exists public.final_acceptances;
drop table if exists public.handoff_training_records;
drop table if exists public.handoff_readiness_checks;
drop table if exists public.handoff_artifacts;
drop table if exists public.handoff_packages;

drop function if exists app.prevent_handoff_evidence_mutation();

drop type if exists public.handoff_check_code;
drop type if exists public.handoff_training_status;
drop type if exists public.handoff_check_status;
drop type if exists public.handoff_package_status;

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
  return new;
end;
$$;

commit;
