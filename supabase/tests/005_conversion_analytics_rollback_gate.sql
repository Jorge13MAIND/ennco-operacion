\set ON_ERROR_STOP on

do $$
begin
  if to_regprocedure('public.capture_public_analytics_event(uuid,text,uuid,bigint,text,text,text,text)') is not null then
    raise exception 'ANALYTICS_RPC_SURVIVED_ROLLBACK';
  end if;
  if to_regclass('public.analytics_events') is not null
    or to_regclass('public.analytics_rate_windows') is not null
  then
    raise exception 'ANALYTICS_TABLE_SURVIVED_ROLLBACK';
  end if;
  if to_regprocedure('public.create_public_prequote(uuid,text,uuid,bigint,text,text,text,text)') is null then
    raise exception 'PREQUOTE_RPC_LOST_DURING_ANALYTICS_ROLLBACK';
  end if;
end;
$$;

select 'CONVERSION_ANALYTICS_ROLLBACK_PASS' as result;
