\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.campaign_release_gates') is not null then raise exception 'campaign_release_gates still exists'; end if;
  if to_regclass('public.first_send_batches') is not null then raise exception 'first_send_batches still exists'; end if;
  if to_regclass('public.first_send_batch_enrollments') is not null then raise exception 'first_send_batch_enrollments still exists'; end if;
  if to_regprocedure('app.assess_first_send_batch(uuid)') is not null then raise exception 'assess function still exists'; end if;
  if to_regprocedure('app.finalize_first_send_batch(uuid)') is not null then raise exception 'finalize function still exists'; end if;
  if to_regprocedure('app.is_first_send_window(timestamp with time zone,timestamp with time zone)') is not null then raise exception 'window function still exists'; end if;
  if exists (select 1 from pg_type where typname = 'first_send_gate_code') then raise exception 'first send gate type still exists'; end if;
  if exists (select 1 from pg_trigger where tgname = 'messages_first_send_release_gate' and not tgisinternal) then raise exception 'message release trigger still exists'; end if;
  if exists (select 1 from pg_trigger where tgname = 'approvals_append_only' and not tgisinternal) then raise exception 'approval trigger still exists'; end if;

  if to_regclass('public.campaigns') is null then raise exception 'campaigns base table missing'; end if;
  if to_regclass('public.shadow_canary_runs') is null then raise exception 'M5 table missing after M6 rollback'; end if;
end;
$$;

select 'FIRST_SEND_RELEASE_ROLLBACK_PASS' as result;
