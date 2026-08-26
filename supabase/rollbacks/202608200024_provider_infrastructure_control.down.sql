begin;

drop trigger if exists messages_aaa_m024_provider_infrastructure on public.messages;
drop function if exists app.enforce_m024_provider_infrastructure();
drop function if exists public.evaluate_outbound_provider_readiness(uuid,timestamptz);
drop function if exists public.apply_outbound_provider_snapshot(uuid,jsonb,text);
drop function if exists app.evaluate_outbound_provider_readiness_as_system(uuid,timestamptz);
drop function if exists app.provider_mailbox_is_ready(uuid,uuid,timestamptz);
drop function if exists app.provider_control_requirements();

create or replace function app.block_m024_rollback_outbound()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.direction='OUTBOUND' and new.status not in ('DRAFT','DRY_RUN') then
    raise exception 'M024_ROLLBACK_OUTBOUND_BLOCKED';
  end if;
  return new;
end;
$$;

revoke all on function app.block_m024_rollback_outbound() from public,anon,authenticated,service_role;

drop trigger if exists messages_aaa_m024_rollback_fail_closed on public.messages;
create trigger messages_aaa_m024_rollback_fail_closed
before insert or update of direction,status,mailbox_id on public.messages
for each row execute function app.block_m024_rollback_outbound();

revoke all on table public.provider_accounts from public,anon,authenticated,service_role;
revoke all on table public.provider_credit_budgets from public,anon,authenticated,service_role;
revoke all on table public.outreach_domains from public,anon,authenticated,service_role;
revoke all on table public.provider_activation_gates from public,anon,authenticated,service_role;
revoke all on table public.provider_control_commands from public,anon,authenticated,service_role;
grant select on table public.provider_accounts,public.provider_credit_budgets,public.outreach_domains,
  public.provider_activation_gates,public.provider_control_commands to authenticated;

commit;
