begin;

-- Security hardening is intentionally fail closed on rollback. The migration is
-- idempotent and can be reapplied, while these P0 controls remain in force.
drop policy if exists event_outbox_technical_write on public.event_outbox;
revoke insert, update, delete, truncate on public.event_outbox from authenticated;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.leads'::regclass
      and conname in ('leads_account_tenant_fkey', 'leads_contact_tenant_fkey', 'leads_prequote_tenant_fkey')
    group by conrelid
    having count(*) = 3
  ) then raise exception 'SECURITY_ROLLBACK_TENANT_FKS_MISSING'; end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.leads'::regclass
      and tgname = 'leads_reference_integrity'
      and not tgisinternal
  ) then raise exception 'SECURITY_ROLLBACK_LEAD_TRIGGER_MISSING'; end if;

  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.deletion_batches'::regclass
      and attname = 'approved_items_sha256'
      and not attisdropped
  ) then raise exception 'SECURITY_ROLLBACK_DELETION_SNAPSHOT_MISSING'; end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.deletion_items'::regclass
      and tgname = 'deletion_items_batch_membership'
      and not tgisinternal
  ) then raise exception 'SECURITY_ROLLBACK_DELETION_ITEM_FREEZE_MISSING'; end if;
end;
$$;

commit;
