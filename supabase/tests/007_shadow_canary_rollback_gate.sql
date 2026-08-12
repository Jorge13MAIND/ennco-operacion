\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.shadow_canary_runs') is not null then raise exception 'shadow_canary_runs still exists'; end if;
  if to_regclass('public.shadow_canary_days') is not null then raise exception 'shadow_canary_days still exists'; end if;
  if to_regclass('public.shadow_canary_observations') is not null then raise exception 'shadow_canary_observations still exists'; end if;
  if to_regprocedure('app.assess_shadow_canary(uuid)') is not null then raise exception 'assess function still exists'; end if;
  if exists (select 1 from pg_type where typname = 'shadow_canary_status') then raise exception 'shadow canary type still exists'; end if;
end;
$$;

select 'SHADOW_CANARY_ROLLBACK_PASS' as result;

