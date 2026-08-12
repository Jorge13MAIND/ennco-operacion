begin;

drop trigger if exists mailbox_sync_cursors_audit on public.mailbox_sync_cursors;
drop trigger if exists gmail_push_notifications_audit on public.gmail_push_notifications;
drop trigger if exists provider_events_audit on public.provider_events;
drop trigger if exists export_runs_audit on public.export_runs;
drop trigger if exists leads_strict_qualification_transition on public.leads;
drop trigger if exists opportunities_strict_stage_transition on public.opportunities;
drop trigger if exists meetings_evidence_gate on public.meetings;
drop trigger if exists qualification_checks_audit on public.qualification_checks;
drop trigger if exists meetings_audit on public.meetings;
drop trigger if exists tasks_audit on public.tasks;

drop function if exists app.apply_mailbox_provider_event(
  uuid, uuid, text, text, uuid, public.provider_event_kind,
  public.reply_classification, text, text, text, timestamptz, uuid
);
drop function if exists public.capture_gmail_push_notification(uuid, text, uuid, bigint, text, text, text);
drop function if exists app.record_export_run(uuid, text, integer, text, uuid);
drop function if exists app.enforce_lead_qualification_transition();
drop function if exists app.enforce_opportunity_transition();
drop function if exists app.enforce_meeting_evidence();
drop function if exists app.qualify_lead_strict(uuid, uuid, boolean, boolean, boolean, boolean, numeric, uuid[]);
drop function if exists app.complete_operational_task(uuid, uuid);
drop function if exists app.record_meeting_outcome(uuid, uuid, timestamptz, boolean, text);
drop function if exists app.transition_opportunity(uuid, uuid, public.commercial_stage, numeric, text, timestamptz);
drop function if exists app.review_reply_event(uuid, uuid, public.reply_classification);

drop table if exists public.export_runs;
drop table if exists public.mailbox_sync_cursors;
drop table if exists public.gmail_push_notifications;

alter table public.provider_events
  drop constraint if exists provider_events_kind_classification_check,
  drop column if exists processing_status,
  drop column if exists correlation_id,
  drop column if exists reply_classification,
  drop column if exists event_kind;

alter table public.leads
  drop constraint if exists leads_organization_origin_message_unique,
  drop constraint if exists leads_origin_message_tenant_fkey,
  drop column if exists origin_message_id;

alter table public.messages
  drop constraint if exists messages_organization_id_id_unique;

alter table public.mailboxes
  drop constraint if exists mailboxes_organization_id_id_unique;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant insert, update, delete on public.provider_events, public.messages, public.mailboxes to authenticated;
    create policy provider_events_operator_write on public.provider_events for all
      using (app.has_role(organization_id, array['ennco_admin'::public.user_role, 'ennco_operator'::public.user_role, 'teckel_admin'::public.user_role, 'teckel_operator'::public.user_role]))
      with check (app.has_role(organization_id, array['ennco_admin'::public.user_role, 'ennco_operator'::public.user_role, 'teckel_admin'::public.user_role, 'teckel_operator'::public.user_role]));
    create policy messages_operator_write on public.messages for all
      using (app.has_role(organization_id, array['ennco_admin'::public.user_role, 'ennco_operator'::public.user_role, 'teckel_admin'::public.user_role, 'teckel_operator'::public.user_role]))
      with check (app.has_role(organization_id, array['ennco_admin'::public.user_role, 'ennco_operator'::public.user_role, 'teckel_admin'::public.user_role, 'teckel_operator'::public.user_role]));
    create policy mailboxes_operator_write on public.mailboxes for all
      using (app.has_role(organization_id, array['ennco_admin'::public.user_role, 'ennco_operator'::public.user_role, 'teckel_admin'::public.user_role, 'teckel_operator'::public.user_role]))
      with check (app.has_role(organization_id, array['ennco_admin'::public.user_role, 'ennco_operator'::public.user_role, 'teckel_admin'::public.user_role, 'teckel_operator'::public.user_role]));
  end if;
end;
$$;

alter table app.private_runtime_config
  drop column if exists gmail_ingest_secret;

drop type if exists public.reply_classification;
drop type if exists public.provider_event_kind;
drop type if exists public.mailbox_sync_status;

commit;
