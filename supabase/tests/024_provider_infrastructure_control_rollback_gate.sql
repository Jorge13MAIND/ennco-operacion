\set ON_ERROR_STOP on

do $$ begin
  if to_regprocedure('public.evaluate_outbound_provider_readiness(uuid,timestamptz)') is not null then
    raise exception 'M024_ROLLBACK_READ_RPC_SURVIVED';
  end if;
  if to_regprocedure('public.apply_outbound_provider_snapshot(uuid,jsonb,text)') is not null then
    raise exception 'M024_ROLLBACK_WRITE_RPC_SURVIVED';
  end if;
  if to_regclass('public.provider_accounts') is null
    or to_regclass('public.provider_credit_budgets') is null
    or to_regclass('public.outreach_domains') is null
    or to_regclass('public.provider_activation_gates') is null
  then raise exception 'M024_ROLLBACK_DESTROYED_PROVIDER_LEDGER'; end if;
  if (select count(*) from public.provider_accounts where organization_id='24000000-0000-4000-8000-000000000001')<>1
    or (select count(*) from public.mailboxes where organization_id='24000000-0000-4000-8000-000000000001')<>4
  then raise exception 'M024_ROLLBACK_PROVIDER_DATA_DRIFT'; end if;
  if not exists(
    select 1 from pg_trigger where tgrelid='public.messages'::regclass
      and tgname='messages_aaa_m024_rollback_fail_closed' and not tgisinternal
  ) then raise exception 'M024_ROLLBACK_FAIL_CLOSED_TRIGGER_MISSING'; end if;

  insert into public.messages(organization_id,direction,status,idempotency_key,correlation_id)
  values ('24000000-0000-4000-8000-000000000001','OUTBOUND','DRY_RUN','m024-rollback-dry-run',gen_random_uuid());

  begin
    insert into public.messages(organization_id,mailbox_id,direction,status,idempotency_key,correlation_id)
    values ('24000000-0000-4000-8000-000000000001','24600000-0000-4000-8000-000000000001',
      'OUTBOUND','QUEUED','m024-rollback-real',gen_random_uuid());
    raise exception 'M024_EXPECTED_ROLLBACK_OUTBOUND_HOLD';
  exception when others then
    if sqlerrm<>'M024_ROLLBACK_OUTBOUND_BLOCKED' then raise; end if;
  end;
end $$;

select 'PROVIDER_INFRASTRUCTURE_CONTROL_ROLLBACK_PASS' as result;
