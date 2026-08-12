begin;

-- Privacy rollback is logical and fail closed. Retention journals, holds,
-- deletion items and tombstones are evidence and must survive every rollback.
create or replace function app.m003_retention_rollback_fail_closed()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'M003_RETENTION_CONTROL_UNAVAILABLE'; end $$;

drop trigger if exists legal_holds_m003_rollback_fail_closed on public.legal_holds;
create trigger legal_holds_m003_rollback_fail_closed before insert or update or delete on public.legal_holds
for each row execute function app.m003_retention_rollback_fail_closed();
drop trigger if exists deletion_batches_m003_rollback_fail_closed on public.deletion_batches;
create trigger deletion_batches_m003_rollback_fail_closed before insert or update or delete on public.deletion_batches
for each row execute function app.m003_retention_rollback_fail_closed();
drop trigger if exists deletion_items_m003_rollback_fail_closed on public.deletion_items;
create trigger deletion_items_m003_rollback_fail_closed before insert or update or delete on public.deletion_items
for each row execute function app.m003_retention_rollback_fail_closed();
drop trigger if exists deletion_tombstones_m003_rollback_fail_closed on public.deletion_tombstones;
create trigger deletion_tombstones_m003_rollback_fail_closed before insert or update or delete on public.deletion_tombstones
for each row execute function app.m003_retention_rollback_fail_closed();

revoke insert,update,delete,truncate on public.legal_holds,public.deletion_batches,public.deletion_items,public.deletion_tombstones from authenticated,service_role;
revoke all on function app.create_contact_deletion_item(uuid,uuid,timestamptz) from public,authenticated,service_role;
revoke all on function app.assess_contact_deletion(uuid) from public,authenticated,service_role;
revoke all on function app.execute_contact_deletion(uuid) from public,authenticated,service_role;

commit;
