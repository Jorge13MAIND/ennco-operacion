\set ON_ERROR_STOP on

do $$ begin
  if to_regprocedure('public.apply_hybrid_mailbox_snapshot(uuid,jsonb,text)') is not null
    or to_regprocedure('public.record_hybrid_mailbox_observation(uuid,uuid,jsonb,text)') is not null
    or to_regprocedure('public.create_hybrid_outbound_release(uuid,uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,uuid[],text)') is not null
  then raise exception 'M029_ROLLBACK_MUTATION_RPC_SURVIVED'; end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.messages'::regclass
    and tgname='messages_aaa_m029_rollback_fail_closed' and not tgisinternal)
  then raise exception 'M029_ROLLBACK_FAIL_CLOSED_TRIGGER_MISSING'; end if;
  if (select count(*) from public.hybrid_mailbox_observations where organization_id='29000000-0000-4000-8000-000000000001')<5
    or (select count(*) from public.hybrid_outbound_releases where organization_id='29000000-0000-4000-8000-000000000001')<>1
    or (select count(*) from public.hybrid_outbound_release_enrollments where organization_id='29000000-0000-4000-8000-000000000001')<>1
  then raise exception 'M029_ROLLBACK_LEDGER_NOT_PRESERVED'; end if;
end $$;

-- Isolate the M029 rollback guard from earlier independent release gates.
alter table public.messages disable trigger messages_scaled_release_gate;
alter table public.messages disable trigger messages_operations_send_health;
alter table public.messages disable trigger messages_control_cadence_send_health;
alter table public.messages disable trigger messages_aaa_m025_annex_a_release;

do $$ begin
  begin
    insert into public.messages(organization_id,direction,status,idempotency_key,correlation_id)
    values('29000000-0000-4000-8000-000000000001','OUTBOUND','QUEUED','m029-rollback-probe',gen_random_uuid());
    raise exception 'EXPECTED_M029_ROLLBACK_SEND_BLOCK';
  exception when others then if sqlerrm<>'M029_ROLLBACK_REAL_OUTBOUND_BLOCKED' then raise; end if; end;
end $$;

alter table public.messages enable trigger messages_aaa_m025_annex_a_release;
alter table public.messages enable trigger messages_control_cadence_send_health;
alter table public.messages enable trigger messages_operations_send_health;
alter table public.messages enable trigger messages_scaled_release_gate;

select 'HYBRID_ACCELERATED_OUTBOUND_ROLLBACK_PASS' as result;
