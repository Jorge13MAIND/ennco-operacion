begin;

drop trigger if exists messages_scaled_release_gate on public.messages;
drop trigger if exists commercial_baselines_audit on public.commercial_baselines;
drop trigger if exists rollout_wave_enrollments_audit on public.rollout_wave_enrollments;
drop trigger if exists rollout_waves_audit on public.rollout_waves;
drop trigger if exists rollout_health_observations_audit on public.rollout_health_observations;
drop trigger if exists commercial_baselines_append_only on public.commercial_baselines;
drop trigger if exists rollout_wave_enrollments_integrity on public.rollout_wave_enrollments;
drop trigger if exists rollout_health_source_integrity on public.rollout_health_observations;
drop trigger if exists rollout_waves_updated_at on public.rollout_waves;
drop trigger if exists first_send_no_rollout_overlap on public.first_send_batch_enrollments;

drop function if exists app.capture_scaling_audit();
drop function if exists app.prevent_scaling_evidence_mutation();
drop function if exists app.freeze_t0_baseline(uuid, uuid, text, uuid);
drop function if exists app.enforce_scaled_outbound_release();
drop function if exists app.followup_release_is_current(uuid, uuid, integer, timestamptz);
drop function if exists app.is_operational_send_window(timestamptz);
drop function if exists app.finalize_rollout_wave(uuid);
drop function if exists app.assess_rollout_wave(uuid);
drop function if exists app.finalize_scaling_health(uuid);
drop function if exists app.assess_scaling_health(uuid);
drop function if exists app.release_gates_are_current(uuid, uuid);
drop function if exists app.enforce_rollout_enrollment_integrity();
drop function if exists app.enforce_scaling_source_integrity();
drop function if exists app.enforce_first_send_no_rollout_overlap();

drop table if exists public.commercial_baselines;
drop table if exists public.rollout_wave_enrollments;
drop table if exists public.rollout_waves;
drop table if exists public.rollout_health_observations;

drop index if exists public.messages_one_external_touch_per_enrollment;
drop index if exists public.first_send_one_batch_per_enrollment;
drop index if exists public.sequence_versions_organization_id_id_unique;

drop type if exists public.rollout_wave_status;
drop type if exists public.rollout_source_kind;

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
  if actor_id is not null and new.decided_by <> actor_id then
    raise exception 'APPROVAL_ACTOR_MISMATCH';
  end if;
  if new.subject_type = 'campaign_first_send_release'
    and (
      actor_id is null
      or not app.has_role(new.organization_id, array['teckel_admin'::public.user_role])
    )
  then raise exception 'FIRST_SEND_APPROVAL_JORGE_ONLY'; end if;
  return new;
end;
$$;

create trigger messages_first_send_release_gate
before insert or update of status on public.messages
for each row execute function app.enforce_first_send_outbound_release();

commit;
