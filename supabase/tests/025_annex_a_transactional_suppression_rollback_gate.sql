\set ON_ERROR_STOP on

do $$ begin
  if to_regprocedure('public.apply_annex_a_suppression_snapshot(uuid,jsonb,text)') is not null
    or not exists(select 1 from pg_trigger where tgrelid='public.messages'::regclass
      and tgname='messages_aaa_m025_rollback_fail_closed' and not tgisinternal)
  then raise exception 'M025_ROLLBACK_FAIL_CLOSED_MISSING'; end if;
  if (select count(*) from public.suppression_manifests where organization_id='25000000-0000-4000-8000-000000000001')<>1
    or (select count(*) from public.suppression_manifest_identities where organization_id='25000000-0000-4000-8000-000000000001')<>18
    or (select count(*) from public.suppression_manifest_commands where organization_id='25000000-0000-4000-8000-000000000001')<>2
  then raise exception 'M025_ROLLBACK_LEDGER_NOT_PRESERVED'; end if;
  begin
    insert into public.messages(organization_id,direction,status,idempotency_key,correlation_id)
    values ('25000000-0000-4000-8000-000000000001','OUTBOUND','QUEUED','m025-rollback-real',gen_random_uuid());
    raise exception 'M025_EXPECTED_ROLLBACK_SEND_DENIAL';
  exception when others then
    if sqlerrm not in ('M025_ROLLBACK_OUTBOUND_BLOCKED','PROVIDER_INFRASTRUCTURE_NOT_READY') then raise; end if;
  end;
  insert into public.messages(organization_id,direction,status,idempotency_key,correlation_id)
  values ('25000000-0000-4000-8000-000000000001','OUTBOUND','DRY_RUN','m025-rollback-dry',gen_random_uuid());
end $$;

select 'ANNEX_A_TRANSACTIONAL_SUPPRESSION_ROLLBACK_PASS' as result;
