\set ON_ERROR_STOP on
do $$ begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='messages' and column_name in ('lane','provider_thread_id','rfc_message_id','cc_emails','reply_to_provider_event_id'))
    or exists(select 1 from information_schema.columns where table_schema='public' and table_name='campaigns' and column_name in ('lane','direct_lane_state'))
    or exists(select 1 from information_schema.columns where table_schema='public' and table_name='mailboxes' and column_name like 'direct_lane_%')
  then raise exception 'M041_DOWN_COLUMNS_REMAIN'; end if;
  if to_regclass('public.direct_lane_credentials') is not null or to_regclass('public.direct_lane_authorizations') is not null
    or to_regclass('public.direct_lane_commands') is not null or to_regclass('public.direct_lane_ticks') is not null
  then raise exception 'M041_DOWN_TABLES_REMAIN'; end if;
  if to_regprocedure('public.claim_direct_lane_dispatch(uuid,uuid,boolean,text,uuid,timestamptz,text)') is not null
    or to_regprocedure('app.enforce_direct_lane_release()') is not null
  then raise exception 'M041_DOWN_FUNCTIONS_REMAIN'; end if;
  if exists(select 1 from pg_trigger where tgrelid='public.messages'::regclass and tgname='messages_aaa_m041_direct_lane') then raise exception 'M041_DOWN_TRIGGER_REMAINS'; end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app'
    and p.proname in ('enforce_hybrid_outbound_release','enforce_scaled_outbound_release','enforce_operations_send_health','enforce_control_cadence_send_health')
    and position('M041' in pg_get_functiondef(p.oid))>0) then raise exception 'M041_DOWN_BYPASS_REMAINS'; end if;
  if position('direct_lane' in pg_get_functiondef('public.read_dispatch_health(uuid,text,uuid,timestamptz,text)'::regprocedure))>0 then raise exception 'M041_DOWN_HEALTH_PATCH_REMAINS'; end if;
end $$;
select 'DIRECT_LANE_ROLLBACK_PASS' as result;
