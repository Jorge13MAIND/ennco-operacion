begin;

drop trigger if exists messages_apollo_warmup_42_days on public.messages;
drop function if exists app.enforce_apollo_warmup_42_days();
drop function if exists app.apollo_warmup_is_ready(uuid, uuid, timestamptz);

alter type public.first_send_gate_code
  rename value 'APOLLO_WARMUP_42_DAYS' to 'DOMAIN_AGE_35_DAYS';

create or replace function app.block_m023_rollback_outbound()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.direction = 'OUTBOUND' and new.status not in ('DRAFT', 'DRY_RUN') then
    raise exception 'M023_ROLLBACK_OUTBOUND_BLOCKED';
  end if;
  return new;
end;
$$;

revoke all on function app.block_m023_rollback_outbound() from public, anon, authenticated, service_role;

drop trigger if exists messages_aaa_m023_rollback_fail_closed on public.messages;
create trigger messages_aaa_m023_rollback_fail_closed
before insert or update of direction, status, mailbox_id on public.messages
for each row execute function app.block_m023_rollback_outbound();

commit;
