\set ON_ERROR_STOP on

-- M032 rollback gate: engine surface gone, ledger preserved, original
-- send-health behavior restored (FAILED transitions blocked again).

do $$ begin
  if to_regprocedure('public.run_dispatch_heartbeat(uuid,text,uuid,timestamptz,text)') is not null
    or to_regprocedure('public.claim_hybrid_dispatch(uuid,boolean,text,uuid,timestamptz,text)') is not null
    or to_regprocedure('public.settle_hybrid_dispatch(uuid,uuid,text,text,text,text,text,uuid,timestamptz,text)') is not null
    or to_regprocedure('public.read_hybrid_dispatch_credential(uuid,uuid,text,uuid,timestamptz,text)') is not null
    or to_regprocedure('public.claim_dispatch_outbox(uuid,integer,text,uuid,timestamptz,text)') is not null
    or to_regprocedure('public.complete_dispatch_outbox_event(uuid,uuid,text,uuid,timestamptz,text)') is not null
    or to_regprocedure('public.fail_dispatch_outbox_event(uuid,uuid,text,text,uuid,timestamptz,text)') is not null
    or to_regprocedure('public.apply_dispatch_provider_event(uuid,uuid,text,text,uuid,text,text,text,text,timestamptz,text,uuid,timestamptz,text)') is not null
    or to_regprocedure('public.update_dispatch_sync_cursor(uuid,uuid,text,timestamptz,text,uuid,timestamptz,text)') is not null
    or to_regprocedure('public.read_dispatch_health(uuid,text,uuid,timestamptz,text)') is not null
    or to_regprocedure('app.verify_dispatch_proof(uuid,text,uuid,timestamptz,text,text)') is not null
    or to_regprocedure('app.record_hybrid_dispatch_observation(uuid,uuid,jsonb,text)') is not null
    or to_regprocedure('app.enforce_hybrid_dispatch_envelope_contract()') is not null
  then raise exception 'M032_ROLLBACK_DISPATCH_SURFACE_SURVIVED'; end if;
  if exists (select 1 from pg_trigger where tgrelid='public.hybrid_outbound_release_enrollments'::regclass
    and tgname='hybrid_release_enrollments_aaa_m032_envelope_contract' and not tgisinternal)
  then raise exception 'M032_ROLLBACK_ENVELOPE_TRIGGER_SURVIVED'; end if;
  if to_regclass('public.hybrid_dispatch_ticks') is null
    or (select count(*) from public.hybrid_dispatch_ticks where organization_id='32000000-0000-4000-8000-000000000001')<10
  then raise exception 'M032_ROLLBACK_TICK_LEDGER_NOT_PRESERVED'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='app' and table_name='private_runtime_config' and column_name='dispatch_secret'
  ) then raise exception 'M032_ROLLBACK_DISPATCH_SECRET_DROPPED'; end if;
  if position('QUARANTINED' in (
    select p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app' and p.proname='enforce_operations_send_health'))>0
  then raise exception 'M032_ROLLBACK_OPERATIONS_TRIGGER_NOT_RESTORED'; end if;
  if position('QUARANTINED' in (
    select p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app' and p.proname='enforce_control_cadence_send_health'))>0
  then raise exception 'M032_ROLLBACK_CADENCE_TRIGGER_NOT_RESTORED'; end if;
end $$;

-- Behavioral fail-closed probe: with the original triggers restored, a legal
-- SENDING->FAILED transition is blocked again by the unhealthy send gates.
do $$ declare sending_id uuid; begin
  select id into sending_id from public.messages
  where organization_id='32000000-0000-4000-8000-000000000001' and direction='OUTBOUND' and status='SENDING'
  order by created_at desc limit 1;
  if sending_id is null then raise exception 'M032_ROLLBACK_FIXTURE_SENDING_MISSING'; end if;
  begin
    update public.messages set status='FAILED' where id=sending_id;
    raise exception 'EXPECTED_M032_ROLLBACK_FAILED_BLOCK';
  exception when others then
    if sqlerrm not in ('CONTROL_CADENCE_HEALTH_NOT_HEALTHY','OPERATIONS_HEALTH_NOT_HEALTHY') then raise; end if;
  end;
end $$;

select 'HYBRID_DISPATCH_ROLLBACK_PASS' as result;
