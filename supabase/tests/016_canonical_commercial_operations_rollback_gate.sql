\set ON_ERROR_STOP on

do $$
begin
  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.messages'::regclass
      and tgname = 'messages_automatic_first_attribution' and not tgisinternal
  ) then raise exception 'M016_ROLLBACK_LEFT_AUTOMATIC_ATTRIBUTION_ACTIVE'; end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.messages'::regclass
      and tgname = 'messages_m016_rollback_fail_closed' and not tgisinternal
  ) then raise exception 'M016_ROLLBACK_MISSING_SEND_FAIL_CLOSED'; end if;
  if has_table_privilege('authenticated', 'public.opportunities', 'INSERT')
    or has_table_privilege('authenticated', 'public.opportunities', 'UPDATE')
    or has_table_privilege('authenticated', 'public.meetings', 'INSERT')
    or has_table_privilege('authenticated', 'public.meetings', 'UPDATE')
  then raise exception 'M016_ROLLBACK_RESTORED_DIRECT_COMMERCIAL_DML'; end if;
  if to_regprocedure(
    'app.create_opportunity_from_strict_lead(uuid,uuid,public.commercial_stage,text)'
  ) is not null or to_regprocedure(
    'app.schedule_meeting(uuid,uuid,timestamptz,text)'
  ) is not null or to_regprocedure(
    'app.record_first_payment_with_evidence(uuid,uuid,numeric,timestamptz,text,text,timestamptz,public.source_confidence,text,text)'
  ) is not null then raise exception 'M016_ROLLBACK_LEFT_CANONICAL_RPC'; end if;
  if has_function_privilege(
    'authenticated', 'app.transition_opportunity(uuid,uuid,public.commercial_stage,numeric,text,timestamptz)', 'EXECUTE'
  ) or has_function_privilege(
    'authenticated', 'app.record_first_payment(uuid,uuid,numeric,timestamptz,uuid,text)', 'EXECUTE'
  ) or has_function_privilege(
    'authenticated', 'app.record_first_contact_attribution(uuid,uuid,uuid,text)', 'EXECUTE'
  ) or has_function_privilege(
    'authenticated', 'app.record_earned_commission(uuid,uuid,uuid,uuid,text)', 'EXECUTE'
  ) then raise exception 'M016_ROLLBACK_EXPOSED_UNSAFE_RPC'; end if;
  if position(
    'NO_COMMERCIAL_ALLOWLIST'
    in pg_get_functiondef('app.capture_commercial_integrity_audit()'::regprocedure)
  ) = 0 then raise exception 'M016_ROLLBACK_WEAKENED_AUDIT_REDACTION'; end if;

  begin
    update public.messages set status = status
    where id = '51111111-1111-4111-8111-111111111111';
    raise exception 'EXPECTED_M016_ROLLBACK_REAL_OUTBOUND_BLOCK';
  exception when others then
    if sqlerrm <> 'M016_ROLLED_BACK_REAL_OUTBOUND_DISABLED' then raise; end if;
  end;
  begin
    perform app.record_first_payment(
      '11111111-1111-4111-8111-111111111111', gen_random_uuid(), 1,
      clock_timestamp(), gen_random_uuid(), 'rollback-payment-test'
    );
    raise exception 'EXPECTED_M016_ROLLBACK_PAYMENT_BLOCK';
  exception when others then
    if sqlerrm <> 'M016_ROLLED_BACK_FIRST_PAYMENT_DISABLED' then raise; end if;
  end;
end;
$$;

\echo 'CANONICAL_COMMERCIAL_OPERATIONS_ROLLBACK_GATE_PASS'
