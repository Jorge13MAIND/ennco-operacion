begin;

drop trigger if exists shadow_canary_observations_audit on public.shadow_canary_observations;
drop trigger if exists shadow_canary_days_audit on public.shadow_canary_days;
drop trigger if exists shadow_canary_runs_audit on public.shadow_canary_runs;
drop trigger if exists shadow_canary_observations_tenant_integrity on public.shadow_canary_observations;
drop trigger if exists shadow_canary_runs_updated_at on public.shadow_canary_runs;

drop function if exists app.finalize_shadow_canary(uuid);
drop function if exists app.assess_shadow_canary(uuid);
drop function if exists app.capture_shadow_canary_audit();
drop function if exists app.enforce_shadow_observation_tenant();

drop table if exists public.shadow_canary_observations;
drop table if exists public.shadow_canary_days;
drop table if exists public.shadow_canary_runs;

alter table public.campaigns
  drop constraint if exists campaigns_organization_id_id_unique;

drop type if exists public.canary_observation_outcome;
drop type if exists public.shadow_canary_status;

commit;

