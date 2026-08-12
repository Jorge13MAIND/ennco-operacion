\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.gmail_push_notifications') is not null then
    raise exception 'GMAIL_PUSH_TABLE_SURVIVED_ROLLBACK';
  end if;
  if to_regclass('public.mailbox_sync_cursors') is not null then
    raise exception 'MAILBOX_SYNC_CURSOR_TABLE_SURVIVED_ROLLBACK';
  end if;
  if to_regclass('public.export_runs') is not null then
    raise exception 'EXPORT_RUNS_TABLE_SURVIVED_ROLLBACK';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'provider_events'
      and column_name in ('event_kind', 'reply_classification', 'correlation_id', 'processing_status')
  ) then raise exception 'PROVIDER_EVENT_COLUMNS_SURVIVED_ROLLBACK'; end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'leads' and column_name = 'origin_message_id'
  ) then raise exception 'LEAD_ORIGIN_MESSAGE_SURVIVED_ROLLBACK'; end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'app' and table_name = 'private_runtime_config' and column_name = 'gmail_ingest_secret'
  ) then raise exception 'GMAIL_INGEST_SECRET_SURVIVED_ROLLBACK'; end if;
  if to_regtype('public.provider_event_kind') is not null then
    raise exception 'PROVIDER_EVENT_KIND_SURVIVED_ROLLBACK';
  end if;
end;
$$;

select 'GMAIL_OPERATIONS_ROLLBACK_PASS' as result;
