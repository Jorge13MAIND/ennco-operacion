\set ON_ERROR_STOP on

do $$
declare
  gate_codes text[];
begin
  select array_agg(value::text order by value::text)
  into gate_codes
  from unnest(enum_range(null::public.first_send_gate_code)) as values(value);

  if not ('WARMUP_42_DAYS_COMPLETE' = any(gate_codes)) then
    raise exception 'M023_APOLLO_GATE_MISSING';
  end if;
  if 'DOMAIN_AGE_35_DAYS' = any(gate_codes) then
    raise exception 'M023_LEGACY_35_DAY_GATE_PRESENT';
  end if;
end;
$$;

do $$
begin
  if app.apollo_warmup_is_ready(
    '81111111-1111-4111-8111-111111111111',
    '84444444-4444-4444-8444-444444444444',
    clock_timestamp()
  ) then
    raise exception 'M023_40_DAY_MAILBOX_FALSE_PASS';
  end if;

  update public.mailboxes
  set domain_ready_at = clock_timestamp() - interval '42 days 1 hour'
  where id = '84444444-4444-4444-8444-444444444444';

  if not app.apollo_warmup_is_ready(
    '81111111-1111-4111-8111-111111111111',
    '84444444-4444-4444-8444-444444444444',
    clock_timestamp()
  ) then
    raise exception 'M023_42_DAY_MAILBOX_NOT_READY';
  end if;

  update public.mailboxes
  set domain_ready_at = clock_timestamp() - interval '40 days'
  where id = '84444444-4444-4444-8444-444444444444';
end;
$$;

do $$
begin
  begin
    insert into public.messages (
      organization_id, mailbox_id, direction, status, idempotency_key, correlation_id
    ) values (
      '81111111-1111-4111-8111-111111111111',
      '84444444-4444-4444-8444-444444444444',
      'OUTBOUND', 'QUEUED', 'm023-too-early', gen_random_uuid()
    );
    raise exception 'M023_EXPECTED_40_DAY_HOLD';
  exception when others then
    if sqlerrm <> 'APOLLO_WARMUP_NOT_READY_42_DAYS' then raise; end if;
  end;

  insert into public.messages (
    organization_id, mailbox_id, direction, status, idempotency_key, correlation_id
  ) values (
    '81111111-1111-4111-8111-111111111111',
    '84444444-4444-4444-8444-444444444444',
    'OUTBOUND', 'DRY_RUN', 'm023-dry-run', gen_random_uuid()
  );
end;
$$;

select 'APOLLO_WARMUP_ALIGNMENT_GATE_PASS' as result;
