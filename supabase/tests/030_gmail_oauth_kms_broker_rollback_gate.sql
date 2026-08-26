\set ON_ERROR_STOP on

do $$ begin
  if to_regprocedure('public.begin_gmail_oauth_authorization(uuid,uuid,text,text,text,text[],timestamptz,text)') is not null
    or to_regprocedure('public.complete_gmail_oauth_authorization(uuid,text,text,text,text,text,text,text[],timestamptz,text,text,text)') is not null
    or to_regprocedure('public.evaluate_gmail_oauth_readiness(uuid,uuid)') is not null
  then raise exception 'M030_ROLLBACK_PUBLIC_RPC_SURVIVED'; end if;
  if (select count(*) from public.gmail_oauth_credentials where organization_id='30000000-0000-4000-8000-000000000001')<>1
    or (select status from public.gmail_oauth_credentials where organization_id='30000000-0000-4000-8000-000000000001')<>'ERROR'
  then raise exception 'M030_ROLLBACK_CREDENTIAL_JOURNAL_LOST'; end if;
  if (select credential_status from public.mailboxes where id='30200000-0000-4000-8000-000000000001')<>'ERROR'
  then raise exception 'M030_ROLLBACK_MAILBOX_NOT_FAIL_CLOSED'; end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.mailboxes'::regclass
    and tgname='mailboxes_aaa_m030_rollback_fail_closed' and not tgisinternal)
  then raise exception 'M030_ROLLBACK_GUARD_MISSING'; end if;
end $$;

do $$ begin
  begin
    update public.mailboxes set credential_status='OAUTH_CONNECTED'
    where id='30200000-0000-4000-8000-000000000001';
    raise exception 'EXPECTED_M030_ROLLBACK_CONNECTION_REJECTION';
  exception when others then if sqlerrm<>'M030_ROLLBACK_OAUTH_CONNECTION_BLOCKED' then raise; end if; end;
  begin
    update public.mailboxes set encrypted_refresh_token='rollback-token-forbidden'
    where id='30200000-0000-4000-8000-000000000001';
    raise exception 'EXPECTED_M030_ROLLBACK_LEGACY_TOKEN_REJECTION';
  exception when others then if sqlerrm<>'LEGACY_MAILBOX_REFRESH_TOKEN_STORAGE_FORBIDDEN' then raise; end if; end;
end $$;

select 'GMAIL_OAUTH_KMS_BROKER_ROLLBACK_PASS' as result;
