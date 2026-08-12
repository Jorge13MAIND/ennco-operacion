begin;

-- Fail-closed rollback. HMAC identities, permanent DNC and secret guards remain active.
drop index if exists public.suppression_account_unique;
drop index if exists public.suppression_email_unique;
drop index if exists public.suppression_domain_unique;

revoke all on function app.compute_suppression_hmac(uuid, text, text) from public;
revoke all on function app.is_suppressed(uuid, uuid, text, text) from public;
revoke select on public.suppression_entries from authenticated;

do $$
begin
  if exists (
    select 1 from public.suppression_entries
    where account_id is not null or normalized_email is not null or normalized_domain is not null
  ) then raise exception 'M015_ROLLBACK_RAW_SUPPRESSION_IDENTITY_PRESENT'; end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.suppression_entries'::regclass
      and tgname = 'suppression_entries_private_identity' and not tgisinternal
  ) then raise exception 'M015_ROLLBACK_PRIVATE_IDENTITY_TRIGGER_MISSING'; end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.contacts'::regclass
      and tgname = 'contacts_deletion_dnc_suppression' and not tgisinternal
  ) then raise exception 'M015_ROLLBACK_DELETION_DNC_TRIGGER_MISSING'; end if;

  if (
    select count(*) from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'suppression_account_hmac_unique', 'suppression_email_hmac_unique',
        'suppression_domain_hmac_unique'
      )
  ) <> 3 then raise exception 'M015_ROLLBACK_HMAC_UNIQUE_INDEX_MISSING'; end if;
end;
$$;

commit;
