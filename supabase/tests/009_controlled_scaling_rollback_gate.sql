\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.rollout_health_observations') is not null then raise exception 'health table still exists'; end if;
  if to_regclass('public.rollout_waves') is not null then raise exception 'wave table still exists'; end if;
  if to_regclass('public.rollout_wave_enrollments') is not null then raise exception 'wave enrollments still exists'; end if;
  if to_regclass('public.commercial_baselines') is not null then raise exception 'baseline table still exists'; end if;
  if to_regprocedure('app.assess_scaling_health(uuid)') is not null then raise exception 'scaling function still exists'; end if;
  if exists (select 1 from pg_type where typname = 'rollout_wave_status') then raise exception 'rollout type still exists'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'messages_first_send_release_gate' and not tgisinternal) then
    raise exception 'M6 message trigger was not restored';
  end if;
  if to_regclass('public.first_send_batches') is null then raise exception 'M6 table missing after rollback'; end if;
end;
$$;

select 'CONTROLLED_SCALING_ROLLBACK_PASS' as result;
