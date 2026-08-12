begin;

create or replace function app.m022_rollback_fail_closed()
returns trigger language plpgsql set search_path=public,app,pg_temp as $$
begin
  raise exception 'CONTROL_CADENCE_M022_ROLLED_BACK';
end $$;

do $$ declare table_name text; begin
  foreach table_name in array array[
    'control_cadence_policy_versions','control_cadence_policy_items','control_cadence_occurrences','control_cadence_human_sessions','control_cadence_attendance',
    'control_cadence_evidence_items','control_cadence_delivery_requirements','control_cadence_breaches','control_cadence_reconciliation_runs','control_cadence_command_ledger'
  ] loop
    if to_regclass('public.'||table_name) is not null then
      execute format('drop trigger if exists %I_m022_rollback_fail_closed on public.%I',table_name,table_name);
      execute format('create trigger %I_m022_rollback_fail_closed before insert or update or delete or truncate on public.%I for each statement execute function app.m022_rollback_fail_closed()',table_name,table_name);
      execute format('revoke insert,update,delete,truncate on public.%I from authenticated',table_name);
      execute format('revoke insert,update,delete,truncate on public.%I from service_role',table_name);
    end if;
  end loop;
end $$;

drop function if exists public.create_control_cadence_policy(uuid,integer,public.evidence_class,integer,jsonb,text);
drop function if exists public.activate_control_cadence_policy(uuid,uuid,text,text);
drop function if exists public.record_control_cadence_evidence(uuid,uuid,text,text,text,public.evidence_class,text,text);
drop function if exists public.record_control_cadence_session(uuid,uuid,text,text,timestamptz,timestamptz,public.evidence_class,text,text);
drop function if exists public.record_control_cadence_attendance(uuid,uuid,uuid,text,text,text);
drop function if exists public.record_control_cadence_delivery(uuid,uuid,text,text,public.evidence_class,text,timestamptz,text,boolean,text);
drop function if exists public.mitigate_control_cadence_breach(uuid,uuid,text,text);

drop function if exists app.create_control_cadence_policy(uuid,integer,public.evidence_class,integer,jsonb,text);
drop function if exists app.activate_control_cadence_policy(uuid,uuid,text,text);
drop function if exists app.record_control_cadence_evidence(uuid,uuid,text,text,text,public.evidence_class,text,timestamptz,text);
drop function if exists app.record_control_cadence_session(uuid,uuid,text,text,timestamptz,timestamptz,public.evidence_class,text,timestamptz,text);
drop function if exists app.record_control_cadence_attendance(uuid,uuid,uuid,text,text,timestamptz,text);
drop function if exists app.record_control_cadence_delivery(uuid,uuid,text,text,public.evidence_class,text,timestamptz,text,boolean,text);
drop function if exists app.mitigate_control_cadence_breach(uuid,uuid,text,text);
drop function if exists app.run_control_cadence_reconciler(uuid,timestamptz,text);
drop function if exists app.run_control_cadence_heartbeat_watchdog(uuid,timestamptz,text);
drop function if exists app.control_cadence_command_finish(uuid,text,text,jsonb);
drop function if exists app.control_cadence_command_begin(uuid,text,text,jsonb);

create or replace function app.evaluate_control_cadence_health(target_organization_id uuid,target_evaluated_at timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
begin
  if not app.is_member(target_organization_id) then raise exception 'CONTROL_CADENCE_MEMBER_REQUIRED'; end if;
  return jsonb_build_object('status','READ_ONLY','state','UNKNOWN','reason_code','M022_ROLLED_BACK','organization_id',target_organization_id,'evaluated_at',target_evaluated_at,
    'policy_version_id',null,'policy_version',null,'timezone','America/Mexico_City','cadence_count',0,'required_cadence_count',5,'open_occurrences',0,
    'breached_occurrences',0,'open_p0',0,'open_p1',0,'last_reconciled_at',null,'heartbeat_state','UNKNOWN','outbound_release','BLOCKED','cadences','[]'::jsonb);
end $$;

create or replace function public.evaluate_control_cadence_health(uuid,timestamptz) returns jsonb
language sql security definer set search_path=app,public,pg_temp as $$ select app.evaluate_control_cadence_health($1,$2) $$;
revoke all on function public.evaluate_control_cadence_health(uuid,timestamptz) from public;
grant execute on function public.evaluate_control_cadence_health(uuid,timestamptz) to authenticated;

create or replace function app.m022_block_real_outbound()
returns trigger language plpgsql set search_path=public,app,pg_temp as $$
begin
  if new.direction='OUTBOUND' and new.status<>'DRY_RUN' and not (tg_op='UPDATE' and new.status is not distinct from old.status) then
    raise exception 'CONTROL_CADENCE_M022_ROLLBACK_OUTBOUND_BLOCKED';
  end if;
  return new;
end $$;
drop trigger if exists messages_control_cadence_send_health on public.messages;
drop trigger if exists messages_m022_rollback_fail_closed on public.messages;
create trigger messages_m022_rollback_fail_closed before insert or update of status on public.messages for each row execute function app.m022_block_real_outbound();

revoke all on function app.evaluate_control_cadence_health(uuid,timestamptz) from public,authenticated,service_role;
revoke all on function app.m022_rollback_fail_closed() from public,authenticated,service_role;
revoke all on function app.m022_block_real_outbound() from public,authenticated,service_role;

commit;
