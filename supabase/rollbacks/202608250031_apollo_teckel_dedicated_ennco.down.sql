begin;

revoke all on function public.apply_apollo_dedicated_provider_snapshot(uuid,jsonb,text)
  from public,anon,authenticated,service_role;
drop function if exists public.apply_apollo_dedicated_provider_snapshot(uuid,jsonb,text);

update public.provider_accounts
set active=false,delivery_status='BLOCKED',updated_at=clock_timestamp()
where provider_code='APOLLO' and environment='PRODUCTION';

create or replace function app.block_m031_rollback_outbound()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if new.direction='OUTBOUND' and new.status not in ('DRAFT','DRY_RUN') then
    raise exception 'M031_ROLLBACK_REAL_OUTBOUND_BLOCKED';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_aaa_m031_rollback_fail_closed on public.messages;
create trigger messages_aaa_m031_rollback_fail_closed
before insert or update of direction,status,mailbox_id on public.messages
for each row execute function app.block_m031_rollback_outbound();

lock table public.provider_activation_gates in share row exclusive mode;
alter table public.provider_activation_gates
  drop constraint if exists provider_activation_gates_gate_code_check;
update public.provider_activation_gates
set gate_code='APOLLO_OWNERSHIP_ENNCO'
where gate_code='APOLLO_TECKEL_MANAGED_ACCEPTED';
alter table public.provider_activation_gates
  add constraint provider_activation_gates_gate_code_check check (gate_code in (
    'CONTRACT_ARCHIVED','PRIVACY_APPROVED','APOLLO_TERMS_ACCEPTED','APOLLO_OWNERSHIP_ENNCO',
    'MFA_RECOVERY','BUDGET_APPROVED','GOOGLE_CLOUD_READY','RESEND_READY','SENTRY_READY',
    'CHECKLY_READY','OPERATOR_PRIMARY','OPERATOR_COVERAGE','ANEXO_A_BOUND','COPY_APPROVED','PILOT_APPROVED'
  ));

create or replace function app.provider_control_requirements()
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select array[
    'CONTRACT_ARCHIVED','PRIVACY_APPROVED','APOLLO_TERMS_ACCEPTED','APOLLO_OWNERSHIP_ENNCO',
    'MFA_RECOVERY','BUDGET_APPROVED','GOOGLE_CLOUD_READY','RESEND_READY','SENTRY_READY',
    'CHECKLY_READY','OPERATOR_PRIMARY','OPERATOR_COVERAGE','ANEXO_A_BOUND','COPY_APPROVED','PILOT_APPROVED',
    'M031_ROLLBACK_HOLD'
  ]::text[]
$$;

revoke all on function public.apply_outbound_provider_snapshot(uuid,jsonb,text)
  from public,anon,authenticated,service_role;
revoke all on function app.block_m031_rollback_outbound()
  from public,anon,authenticated,service_role;

commit;
