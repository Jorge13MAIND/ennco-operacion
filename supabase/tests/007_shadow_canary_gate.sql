\set ON_ERROR_STOP on

insert into public.organizations (id, slug, legal_name) values
  ('71111111-1111-4111-8111-111111111111', 'm5-org', 'M5 Synthetic Organization');

insert into public.campaigns (id, organization_id, name, status, manifest_json, manifest_sha256) values
  ('72222222-2222-4222-8222-222222222222', '71111111-1111-4111-8111-111111111111', 'M5 synthetic campaign', 'DRAFT', '{}', repeat('a', 64)),
  ('73333333-3333-4333-8333-333333333333', '71111111-1111-4111-8111-111111111111', 'M5 live campaign', 'DRAFT', '{}', repeat('b', 64)),
  ('74444444-4444-4444-8444-444444444444', '71111111-1111-4111-8111-111111111111', 'M5 unknown campaign', 'DRAFT', '{}', repeat('c', 64)),
  ('75555555-5555-4555-8555-555555555555', '71111111-1111-4111-8111-111111111111', 'M5 kill campaign', 'DRAFT', '{}', repeat('d', 64)),
  ('76666666-6666-4666-8666-666666666666', '71111111-1111-4111-8111-111111111111', 'M5 gap campaign', 'DRAFT', '{}', repeat('e', 64)),
  ('77777777-7777-4777-8777-777777777777', '71111111-1111-4111-8111-111111111111', 'M5 drift campaign', 'DRAFT', '{}', repeat('f', 64));

set role service_role;

insert into public.shadow_canary_runs (
  id, organization_id, campaign_id, evidence_class, environment, manifest_sha256,
  status, started_on, ended_on
) values
  ('72111111-1111-4111-8111-111111111111', '71111111-1111-4111-8111-111111111111', '72222222-2222-4222-8222-222222222222', 'synthetic_demo', 'local', repeat('a', 64), 'COMPLETED', '2025-01-01', '2025-01-14'),
  ('73111111-1111-4111-8111-111111111111', '71111111-1111-4111-8111-111111111111', '73333333-3333-4333-8333-333333333333', 'live', 'staging', repeat('b', 64), 'COMPLETED', '2025-02-01', '2025-02-14'),
  ('74111111-1111-4111-8111-111111111111', '71111111-1111-4111-8111-111111111111', '74444444-4444-4444-8444-444444444444', 'live', 'staging', repeat('c', 64), 'COMPLETED', '2025-03-01', '2025-03-14'),
  ('75111111-1111-4111-8111-111111111111', '71111111-1111-4111-8111-111111111111', '75555555-5555-4555-8555-555555555555', 'live', 'staging', repeat('d', 64), 'COMPLETED', '2025-04-01', '2025-04-14'),
  ('76111111-1111-4111-8111-111111111111', '71111111-1111-4111-8111-111111111111', '76666666-6666-4666-8666-666666666666', 'live', 'staging', repeat('e', 64), 'COMPLETED', '2025-05-01', '2025-05-14'),
  ('77111111-1111-4111-8111-111111111111', '71111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777777', 'live', 'staging', repeat('0', 64), 'COMPLETED', '2025-06-01', '2025-06-14');

insert into public.shadow_canary_days (
  organization_id, run_id, observed_on, scenario_count, passed_count, failed_count,
  unknown_count, p0_count, p1_count, external_side_effect_count, reconciliation_ok, evidence_sha256
)
select
  '71111111-1111-4111-8111-111111111111', run_id, start_day + offset_value,
  1,
  case when run_id = '74111111-1111-4111-8111-111111111111'::uuid and offset_value = 5 then 0 else 1 end,
  0,
  case when run_id = '74111111-1111-4111-8111-111111111111'::uuid and offset_value = 5 then 1 else 0 end,
  case when run_id = '75111111-1111-4111-8111-111111111111'::uuid and offset_value = 3 then 1 else 0 end,
  0,
  0,
  true,
  encode(digest(run_id::text || ':' || offset_value::text, 'sha256'), 'hex')
from (
  values
    ('72111111-1111-4111-8111-111111111111'::uuid, '2025-01-01'::date, true),
    ('73111111-1111-4111-8111-111111111111'::uuid, '2025-02-01'::date, true),
    ('74111111-1111-4111-8111-111111111111'::uuid, '2025-03-01'::date, true),
    ('75111111-1111-4111-8111-111111111111'::uuid, '2025-04-01'::date, true),
    ('76111111-1111-4111-8111-111111111111'::uuid, '2025-05-01'::date, false),
    ('77111111-1111-4111-8111-111111111111'::uuid, '2025-06-01'::date, true)
) as plans(run_id, start_day, full_window)
cross join generate_series(0, 13) as offsets(offset_value)
where full_window or offset_value <> 7;

insert into public.shadow_canary_observations (
  organization_id, run_id, canary_day_id, scenario_key, category, outcome,
  failure_injected, assertion_sha256, correlation_id, observed_at
)
select
  d.organization_id,
  d.run_id,
  d.id,
  'SCENARIO_' || to_char(d.observed_on, 'YYYYMMDD'),
  'SAFETY',
  case when d.unknown_count > 0 then 'UNKNOWN'::public.canary_observation_outcome else 'PASS'::public.canary_observation_outcome end,
  true,
  encode(digest(d.id::text, 'sha256'), 'hex'),
  md5(d.id::text)::uuid,
  d.observed_on::timestamptz + interval '12 hours'
from public.shadow_canary_days d;

do $$
declare
  decision_value public.gate_decision;
begin
  decision_value := app.finalize_shadow_canary('72111111-1111-4111-8111-111111111111');
  if decision_value <> 'EXTEND' then raise exception 'synthetic canary must remain EXTEND'; end if;

  decision_value := app.finalize_shadow_canary('73111111-1111-4111-8111-111111111111');
  if decision_value <> 'PASS' then raise exception 'complete live canary should PASS'; end if;

  decision_value := app.finalize_shadow_canary('74111111-1111-4111-8111-111111111111');
  if decision_value <> 'EXTEND' then raise exception 'unknown must EXTEND'; end if;

  decision_value := app.finalize_shadow_canary('75111111-1111-4111-8111-111111111111');
  if decision_value <> 'KILL' then raise exception 'P0 must KILL'; end if;

  decision_value := app.finalize_shadow_canary('76111111-1111-4111-8111-111111111111');
  if decision_value <> 'EXTEND' then raise exception 'missing day must EXTEND'; end if;

  decision_value := app.finalize_shadow_canary('77111111-1111-4111-8111-111111111111');
  if decision_value <> 'KILL' then raise exception 'manifest drift must KILL'; end if;
end;
$$;

do $$
begin
  begin
    update public.shadow_canary_runs
    set decision = 'PASS', decided_at = now()
    where id = '72111111-1111-4111-8111-111111111111';
    raise exception 'expected synthetic PASS constraint';
  exception when check_violation then null;
  end;
end;
$$;

reset role;

do $$
begin
  if (select shadow_canary_decision from public.campaigns where id = '72222222-2222-4222-8222-222222222222') is not null then
    raise exception 'synthetic canary must not update campaign release decision';
  end if;
  if (select shadow_canary_decision from public.campaigns where id = '73333333-3333-4333-8333-333333333333') <> 'PASS' then
    raise exception 'live PASS was not applied to campaign';
  end if;
end;
$$;

insert into public.organization_users (organization_id, user_id, role) values
  ('71111111-1111-4111-8111-111111111111', '78888888-8888-4888-8888-888888888888', 'teckel_admin');
set role authenticated;
select set_config('request.jwt.claim.sub', '78888888-8888-4888-8888-888888888888', true);

do $$
begin
  begin
    insert into public.shadow_canary_runs (
      organization_id, campaign_id, evidence_class, environment, manifest_sha256, status, started_on
    ) values (
      '71111111-1111-4111-8111-111111111111', '73333333-3333-4333-8333-333333333333',
      'live', 'staging', repeat('b', 64), 'RUNNING', '2025-07-01'
    );
    raise exception 'expected operator insert denial';
  exception when insufficient_privilege then null;
  end;

  begin
    perform app.finalize_shadow_canary('73111111-1111-4111-8111-111111111111');
    raise exception 'expected service-only denial';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;

do $$
begin
  if exists (
    select 1
    from public.audit_log
    where record_type like 'shadow_canary_%'
      and ((old_data::text || new_data::text) ~* '(email|body|subject|recipient|assertion_text)')
  ) then raise exception 'canary audit contains non-allowlisted content'; end if;

  if (select count(*) from public.shadow_canary_runs) <> 6 then raise exception 'run count mismatch'; end if;
  if (select count(*) from public.shadow_canary_days) <> 83 then raise exception 'day count mismatch'; end if;
  if (select count(*) from public.shadow_canary_observations) <> 83 then raise exception 'observation count mismatch'; end if;
end;
$$;

select 'SHADOW_CANARY_GATE_PASS' as result;
