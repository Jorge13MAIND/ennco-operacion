begin;

drop trigger if exists messages_aaa_m023_rollback_fail_closed on public.messages;
drop function if exists app.block_m023_rollback_outbound();

alter type public.first_send_gate_code
  rename value 'DOMAIN_AGE_35_DAYS' to 'APOLLO_WARMUP_42_DAYS';

create or replace function app.apollo_warmup_is_ready(
  target_organization_id uuid,
  target_mailbox_id uuid,
  target_evaluated_at timestamptz
)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.mailboxes m
    where m.id = target_mailbox_id
      and m.organization_id = target_organization_id
      and m.domain_ready_at is not null
      and m.domain_ready_at <= target_evaluated_at - interval '42 days'
      and m.auth_spf
      and m.auth_dkim
      and m.auth_dmarc
      and m.auth_tls
      and m.health_status = 'HEALTHY'
      and not m.kill_switch
  )
$$;

revoke all on function app.apollo_warmup_is_ready(uuid, uuid, timestamptz) from public, anon, authenticated, service_role;

create or replace function app.enforce_apollo_warmup_42_days()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if new.direction = 'OUTBOUND'
    and new.status not in ('DRAFT', 'DRY_RUN')
    and (
      new.mailbox_id is null
      or not app.apollo_warmup_is_ready(new.organization_id, new.mailbox_id, clock_timestamp())
    )
  then
    raise exception 'APOLLO_WARMUP_NOT_READY_42_DAYS';
  end if;
  return new;
end;
$$;

revoke all on function app.enforce_apollo_warmup_42_days() from public, anon, authenticated, service_role;

drop trigger if exists messages_apollo_warmup_42_days on public.messages;
create trigger messages_apollo_warmup_42_days
before insert or update of direction, status, mailbox_id on public.messages
for each row execute function app.enforce_apollo_warmup_42_days();

commit;
