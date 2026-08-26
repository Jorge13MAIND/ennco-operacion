\set ON_ERROR_STOP on

do $$
declare
  gate_codes text[];
begin
  select array_agg(value::text order by value::text)
  into gate_codes
  from unnest(enum_range(null::public.first_send_gate_code)) as values(value);

  if not ('DOMAIN_AGE_35_DAYS' = any(gate_codes)) then
    raise exception 'M023_ROLLBACK_LEGACY_GATE_MISSING';
  end if;

  begin
    insert into public.messages (
      organization_id, mailbox_id, direction, status, idempotency_key, correlation_id
    ) values (
      '81111111-1111-4111-8111-111111111111',
      '84444444-4444-4444-8444-444444444444',
      'OUTBOUND', 'QUEUED', 'm023-rollback-real-send', gen_random_uuid()
    );
    raise exception 'M023_ROLLBACK_EXPECTED_FAIL_CLOSED';
  exception when others then
    if sqlerrm <> 'M023_ROLLBACK_OUTBOUND_BLOCKED' then raise; end if;
  end;
end;
$$;

select 'APOLLO_WARMUP_ALIGNMENT_ROLLBACK_GATE_PASS' as result;
