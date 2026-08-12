begin;

drop policy if exists legal_holds_privileged_read on public.legal_holds;
drop policy if exists legal_holds_admin_insert on public.legal_holds;
drop policy if exists legal_holds_admin_update on public.legal_holds;
drop policy if exists deletion_batches_privileged_read on public.deletion_batches;
drop policy if exists deletion_batches_teckel_insert on public.deletion_batches;
drop policy if exists deletion_batches_admin_update on public.deletion_batches;
drop policy if exists deletion_items_privileged_read on public.deletion_items;
drop policy if exists deletion_tombstones_privileged_read on public.deletion_tombstones;

drop trigger if exists legal_holds_updated_at on public.legal_holds;
drop trigger if exists deletion_batches_updated_at on public.deletion_batches;
drop trigger if exists deletion_items_updated_at on public.deletion_items;
drop trigger if exists legal_holds_transition on public.legal_holds;
drop trigger if exists legal_holds_actor on public.legal_holds;
drop trigger if exists deletion_batches_transition on public.deletion_batches;
drop trigger if exists deletion_batches_actor on public.deletion_batches;
drop trigger if exists deletion_items_transition on public.deletion_items;
drop trigger if exists legal_holds_audit on public.legal_holds;
drop trigger if exists deletion_batches_audit on public.deletion_batches;
drop trigger if exists deletion_items_audit on public.deletion_items;
drop trigger if exists deletion_tombstones_audit on public.deletion_tombstones;

drop function if exists app.execute_contact_deletion(uuid);
drop function if exists app.assess_contact_deletion(uuid);
drop function if exists app.create_contact_deletion_item(uuid, uuid, timestamptz);
drop function if exists app.is_contact_under_legal_hold(uuid, uuid);
drop function if exists app.enforce_deletion_item_transition();
drop function if exists app.enforce_deletion_batch_transition();
drop function if exists app.enforce_deletion_batch_actor();
drop function if exists app.enforce_legal_hold_transition();
drop function if exists app.enforce_legal_hold_actor();
drop function if exists app.capture_retention_audit_event();
drop function if exists app.retention_audit_snapshot(text, jsonb);

drop table if exists public.deletion_tombstones;
drop table if exists public.deletion_items;
drop table if exists public.deletion_batches;
drop table if exists public.legal_holds;

drop index if exists public.contacts_organization_id_id_unique;

drop type if exists public.restoration_status;
drop type if exists public.legal_hold_reason_code;
drop type if exists public.deletion_reason_code;
drop type if exists public.deletion_item_status;
drop type if exists public.deletion_batch_status;
drop type if exists public.legal_hold_status;

-- Contact anonymization and audit evidence are intentionally irreversible.
-- The tombstone explicitly states that raw data cannot be restored.
-- The tightened organization user privacy policy is also intentionally preserved.

commit;
