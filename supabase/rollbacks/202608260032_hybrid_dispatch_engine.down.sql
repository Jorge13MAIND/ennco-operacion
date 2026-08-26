begin;

-- M032 rollback: disable the hybrid dispatch engine fail-closed.
-- Dropping the proof-guarded RPC surface removes every dispatcher entry point;
-- the restored M20/M22 send-health triggers block FAILED/QUARANTINED transitions
-- again exactly as before M032. The tick ledger (hybrid_dispatch_ticks) and the
-- dispatch_secret column are preserved on purpose: they are operational history
-- and configuration, and the M032 migration re-applies idempotently on top.

revoke all on function public.run_dispatch_heartbeat(uuid,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.claim_hybrid_dispatch(uuid,boolean,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.settle_hybrid_dispatch(uuid,uuid,text,text,text,text,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.read_hybrid_dispatch_credential(uuid,uuid,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.claim_dispatch_outbox(uuid,integer,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.complete_dispatch_outbox_event(uuid,uuid,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.fail_dispatch_outbox_event(uuid,uuid,text,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.apply_dispatch_provider_event(uuid,uuid,text,text,uuid,text,text,text,text,timestamptz,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.update_dispatch_sync_cursor(uuid,uuid,text,timestamptz,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.read_dispatch_health(uuid,text,uuid,timestamptz,text) from public,anon,authenticated,service_role;

drop function if exists public.run_dispatch_heartbeat(uuid,text,uuid,timestamptz,text);
drop function if exists public.claim_hybrid_dispatch(uuid,boolean,text,uuid,timestamptz,text);
drop function if exists public.settle_hybrid_dispatch(uuid,uuid,text,text,text,text,text,uuid,timestamptz,text);
drop function if exists public.read_hybrid_dispatch_credential(uuid,uuid,text,uuid,timestamptz,text);
drop function if exists public.claim_dispatch_outbox(uuid,integer,text,uuid,timestamptz,text);
drop function if exists public.complete_dispatch_outbox_event(uuid,uuid,text,uuid,timestamptz,text);
drop function if exists public.fail_dispatch_outbox_event(uuid,uuid,text,text,uuid,timestamptz,text);
drop function if exists public.apply_dispatch_provider_event(uuid,uuid,text,text,uuid,text,text,text,text,timestamptz,text,uuid,timestamptz,text);
drop function if exists public.update_dispatch_sync_cursor(uuid,uuid,text,timestamptz,text,uuid,timestamptz,text);
drop function if exists public.read_dispatch_health(uuid,text,uuid,timestamptz,text);

drop trigger if exists hybrid_release_enrollments_aaa_m032_envelope_contract on public.hybrid_outbound_release_enrollments;
drop function if exists app.enforce_hybrid_dispatch_envelope_contract();
drop function if exists app.record_hybrid_dispatch_observation(uuid,uuid,jsonb,text);
drop function if exists app.hybrid_dispatch_active_release(uuid);
drop function if exists app.hybrid_dispatch_noop(uuid,text,text,text,uuid,uuid,jsonb);
drop function if exists app.hybrid_dispatch_window_is_open(timestamptz);
drop function if exists app.verify_dispatch_proof(uuid,text,uuid,timestamptz,text,text);
drop function if exists app.record_hybrid_dispatch_tick(uuid,text,text,uuid,uuid,uuid,text,jsonb);

-- Restore the original M20 operations send-health trigger function (verbatim
-- from 202608120020_operations_sla_control.sql).
create or replace function app.enforce_operations_send_health()
returns trigger language plpgsql security definer set search_path=public,app,pg_temp as $$
declare latest public.operations_watchdog_runs%rowtype;
begin
  if new.direction<>'OUTBOUND' or new.status='DRY_RUN' or (tg_op='UPDATE' and new.status is not distinct from old.status) then return new; end if;
  select * into latest from public.operations_watchdog_runs
  where organization_id=new.organization_id order by evaluated_at desc limit 1;
  if latest.id is null or latest.evaluated_at<clock_timestamp()-interval '5 minutes' or latest.status<>'HEALTHY' then
    raise exception 'OPERATIONS_HEALTH_NOT_HEALTHY';
  end if;
  if not app.operations_assignment_is_active(new.organization_id) then
    raise exception 'OPERATIONS_ASSIGNMENT_NOT_ACTIVE';
  end if;
  if exists(select 1 from public.incidents where organization_id=new.organization_id and severity in ('P0','P1') and status not in ('RESOLVED','REVIEWED')) then
    raise exception 'OPERATIONS_INCIDENT_SEND_HOLD';
  end if;
  return new;
end $$;

-- Restore the original M22 control cadence send-health trigger function
-- (verbatim from 202608120022_control_room_cadence.sql).
create or replace function app.enforce_control_cadence_send_health()
returns trigger language plpgsql security definer set search_path=public,app,pg_temp as $$
declare health jsonb;
begin
  if new.direction<>'OUTBOUND' or new.status='DRY_RUN' or (tg_op='UPDATE' and new.status is not distinct from old.status) then return new; end if;
  select app.evaluate_control_cadence_health_as_system(new.organization_id,clock_timestamp()) into health;
  if health->>'state'<>'HEALTHY' or health->>'outbound_release'<>'ALLOWED' then raise exception 'CONTROL_CADENCE_HEALTH_NOT_HEALTHY'; end if;
  return new;
end $$;

commit;
