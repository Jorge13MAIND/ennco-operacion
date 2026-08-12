\set ON_ERROR_STOP on

do $$
begin
  if exists (
    select 1 from public.suppression_entries
    where account_id is not null or normalized_email is not null or normalized_domain is not null
  ) then raise exception 'M015_ROLLBACK_RESTORED_RAW_SUPPRESSION_IDENTITY'; end if;

  if not app.is_suppressed(
    '11111111-1111-4111-8111-111111111111',
    null, 'one-click@invalid.test', null
  ) then raise exception 'M015_ROLLBACK_LOST_DNC_MATCH'; end if;

  if has_function_privilege(
    'authenticated', 'app.compute_suppression_hmac(uuid,text,text)', 'EXECUTE'
  ) or has_function_privilege(
    'anon', 'app.compute_suppression_hmac(uuid,text,text)', 'EXECUTE'
  ) then raise exception 'M015_ROLLBACK_EXPOSED_HMAC_ORACLE'; end if;

  if has_table_privilege('authenticated', 'public.suppression_entries', 'SELECT') then
    raise exception 'M015_ROLLBACK_EXPOSED_SUPPRESSION_HASHES';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.suppression_entries'::regclass
      and tgname = 'suppression_entries_private_identity' and not tgisinternal
  ) then raise exception 'M015_ROLLBACK_REMOVED_HMAC_TRIGGER'; end if;
end;
$$;

\echo 'SUPPRESSION_PRIVACY_ROLLBACK_GATE_PASS'
