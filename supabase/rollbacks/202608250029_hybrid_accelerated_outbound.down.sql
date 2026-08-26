begin;

drop trigger if exists messages_aaa_m029_hybrid_outbound on public.messages;

create or replace function app.m029_block_real_outbound()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.direction='OUTBOUND' and new.status not in ('DRAFT','DRY_RUN') then
    raise exception 'M029_ROLLBACK_REAL_OUTBOUND_BLOCKED';
  end if;
  return new;
end $$;

drop trigger if exists messages_aaa_m029_rollback_fail_closed on public.messages;
create trigger messages_aaa_m029_rollback_fail_closed
before insert or update of direction,status,mailbox_id,enrollment_id,touch_number on public.messages
for each row execute function app.m029_block_real_outbound();

revoke all on function public.apply_hybrid_mailbox_snapshot(uuid,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.record_hybrid_mailbox_observation(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.create_hybrid_outbound_release(uuid,uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,uuid[],text) from public,anon,authenticated,service_role;

drop function if exists public.apply_hybrid_mailbox_snapshot(uuid,jsonb,text);
drop function if exists public.record_hybrid_mailbox_observation(uuid,uuid,jsonb,text);
drop function if exists public.create_hybrid_outbound_release(uuid,uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,uuid[],text);

commit;
