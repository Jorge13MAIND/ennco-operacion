\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.legal_holds') is not null then raise exception 'ROLLBACK_LEFT_LEGAL_HOLDS'; end if;
  if to_regclass('public.deletion_batches') is not null then raise exception 'ROLLBACK_LEFT_DELETION_BATCHES'; end if;
  if to_regclass('public.deletion_items') is not null then raise exception 'ROLLBACK_LEFT_DELETION_ITEMS'; end if;
  if to_regclass('public.deletion_tombstones') is not null then raise exception 'ROLLBACK_LEFT_TOMBSTONES'; end if;
  if to_regprocedure('app.execute_contact_deletion(uuid)') is not null then raise exception 'ROLLBACK_LEFT_EXECUTOR'; end if;
  if exists (select 1 from pg_type where typname = 'deletion_item_status') then raise exception 'ROLLBACK_LEFT_TYPES'; end if;

  if not (select is_deleted from public.contacts where id = '32111111-1111-4111-8111-111111111111') then
    raise exception 'ROLLBACK_RESTORED_ANONYMIZED_CONTACT';
  end if;
  if exists (
    select 1 from public.messages
    where contact_id = '32111111-1111-4111-8111-111111111111'
      and num_nonnulls(normalized_to, normalized_from, subject, body_text, provider_message_id) > 0
  ) then raise exception 'ROLLBACK_RESTORED_MESSAGE_CONTENT'; end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'organization_users'
      and policyname = 'organization_users_self_or_admin_read'
  ) then raise exception 'ROLLBACK_WEAKENED_ORGANIZATION_USER_PRIVACY'; end if;
end;
$$;

set request.jwt.claim.sub = '83111111-1111-4111-8111-111111111111';
set role authenticated;

do $$
begin
  if (select count(*) from public.organization_users) <> 1 then
    raise exception 'ROLLBACK_REINTRODUCED_USER_ENUMERATION';
  end if;
end;
$$;

reset role;
reset request.jwt.claim.sub;

\echo 'RETENTION_DELETION_ROLLBACK_PASS'
