\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.unsubscribe_requests') is not null then raise exception 'UNSUBSCRIBE_TABLE_SURVIVED_ROLLBACK'; end if;
  if to_regprocedure('public.apply_one_click_unsubscribe(uuid,uuid,uuid,text,uuid,bigint,text,text)') is not null then
    raise exception 'UNSUBSCRIBE_FUNCTION_SURVIVED_ROLLBACK';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'app' and table_name = 'private_runtime_config' and column_name = 'unsubscribe_ingest_secret'
  ) then raise exception 'UNSUBSCRIBE_SECRET_COLUMN_SURVIVED_ROLLBACK'; end if;
end;
$$;

select 'ONE_CLICK_UNSUBSCRIBE_ROLLBACK_PASS' as result;
