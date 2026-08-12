\set ON_ERROR_STOP on

do $$
begin
  if to_regprocedure('public.create_public_prequote(uuid,text,uuid,bigint,text,text,text,text)') is not null then
    raise exception 'PUBLIC_PREQUOTE_RPC_SURVIVED_ROLLBACK';
  end if;
  if to_regclass('public.public_prequote_nonces') is not null
    or to_regclass('public.public_prequote_rate_windows') is not null
    or to_regclass('app.private_runtime_config') is not null
  then
    raise exception 'PUBLIC_PREQUOTE_CONTROL_TABLE_SURVIVED_ROLLBACK';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'prequotes' and column_name = 'idempotency_key'
  ) then
    raise exception 'PREQUOTE_IDEMPOTENCY_COLUMN_SURVIVED_ROLLBACK';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'prequotes' and column_name = 'privacy_notice_version'
  ) then
    raise exception 'PREQUOTE_PRIVACY_VERSION_SURVIVED_ROLLBACK';
  end if;
  if to_regprocedure('app.redact_audit_snapshot(text,jsonb)') is null then
    raise exception 'SAFE_AUDIT_REDACTION_LOST_DURING_ROLLBACK';
  end if;
end;
$$;

select 'PUBLIC_PREQUOTE_CAPTURE_ROLLBACK_PASS' as result;
