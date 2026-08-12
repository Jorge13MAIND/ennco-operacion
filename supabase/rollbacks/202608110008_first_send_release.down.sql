begin;

drop trigger if exists messages_first_send_release_gate on public.messages;
drop trigger if exists suppression_entries_first_send_lock on public.suppression_entries;
drop trigger if exists approvals_append_only on public.approvals;
drop trigger if exists first_send_batch_enrollments_audit on public.first_send_batch_enrollments;
drop trigger if exists first_send_batches_audit on public.first_send_batches;
drop trigger if exists campaign_release_gates_audit on public.campaign_release_gates;
drop trigger if exists first_send_batch_enrollments_integrity on public.first_send_batch_enrollments;
drop trigger if exists first_send_batches_updated_at on public.first_send_batches;
drop trigger if exists campaign_release_gates_updated_at on public.campaign_release_gates;

drop function if exists app.capture_first_send_audit();
drop function if exists app.enforce_first_send_outbound_release();
drop function if exists app.finalize_first_send_batch(uuid);
drop function if exists app.assess_first_send_batch(uuid);
drop function if exists app.is_first_send_window(timestamptz, timestamptz);
drop function if exists app.enforce_first_send_enrollment_integrity();
drop function if exists app.enforce_approval_append_only();
drop function if exists app.lock_first_send_suppression_change();

drop table if exists public.first_send_batch_enrollments;
drop table if exists public.first_send_batches;
drop table if exists public.campaign_release_gates;

drop index if exists public.campaign_enrollments_organization_id_id_unique;
drop index if exists public.accounts_organization_id_id_unique;
drop index if exists public.approvals_organization_id_id_unique;

drop type if exists public.first_send_batch_status;
drop type if exists public.release_gate_status;
drop type if exists public.first_send_gate_code;

commit;
