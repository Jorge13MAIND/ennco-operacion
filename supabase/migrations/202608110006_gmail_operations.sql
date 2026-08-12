begin;

create type public.mailbox_sync_status as enum ('HOLD', 'READY', 'SYNCING', 'ERROR');
create type public.provider_event_kind as enum ('DELIVERY', 'REPLY', 'AUTO_REPLY', 'HARD_BOUNCE', 'UNSUBSCRIBE', 'UNKNOWN');
create type public.reply_classification as enum ('POSITIVE', 'NEUTRAL', 'NEGATIVE', 'NOT_APPLICABLE', 'UNREVIEWED');

alter table app.private_runtime_config
  add column gmail_ingest_secret text
  check (gmail_ingest_secret is null or length(gmail_ingest_secret) >= 32);

alter table public.mailboxes
  add constraint mailboxes_organization_id_id_unique
  unique (organization_id, id);

alter table public.messages
  add constraint messages_organization_id_id_unique
  unique (organization_id, id);

alter table public.leads
  add column origin_message_id uuid,
  add constraint leads_origin_message_tenant_fkey
    foreign key (organization_id, origin_message_id)
    references public.messages (organization_id, id),
  add constraint leads_organization_origin_message_unique
    unique (organization_id, origin_message_id);

alter table public.provider_events
  add column event_kind public.provider_event_kind not null default 'UNKNOWN',
  add column reply_classification public.reply_classification not null default 'UNREVIEWED',
  add column correlation_id uuid,
  add column processing_status text not null default 'PENDING'
    check (processing_status in ('PENDING', 'PROCESSED', 'QUARANTINED')),
  add constraint provider_events_kind_classification_check check (
    (event_kind = 'REPLY' and reply_classification in ('POSITIVE', 'NEUTRAL', 'NEGATIVE', 'UNREVIEWED'))
    or (event_kind <> 'REPLY' and reply_classification = 'NOT_APPLICABLE')
    or (event_kind = 'UNKNOWN' and reply_classification = 'UNREVIEWED')
  );

create table public.gmail_push_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mailbox_id uuid not null,
  pubsub_message_id text not null check (pubsub_message_id ~ '^[A-Za-z0-9._:-]{1,255}$'),
  history_id text not null check (history_id ~ '^[0-9]{1,32}$'),
  subscription_sha256 text not null check (subscription_sha256 ~ '^[a-f0-9]{64}$'),
  published_at timestamptz not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'PENDING' check (status in ('PENDING', 'PROCESSING', 'PROCESSED', 'DEAD_LETTER')),
  correlation_id uuid not null,
  foreign key (organization_id, mailbox_id)
    references public.mailboxes (organization_id, id)
    on delete cascade,
  unique (organization_id, pubsub_message_id)
);

create index gmail_push_notifications_pending_idx
on public.gmail_push_notifications (organization_id, received_at)
where status in ('PENDING', 'PROCESSING');

create table public.mailbox_sync_cursors (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mailbox_id uuid not null,
  last_history_id text check (last_history_id is null or last_history_id ~ '^[0-9]{1,32}$'),
  watch_expires_at timestamptz,
  status public.mailbox_sync_status not null default 'HOLD',
  last_synced_at timestamptz,
  last_error_code text,
  updated_at timestamptz not null default now(),
  primary key (organization_id, mailbox_id),
  foreign key (organization_id, mailbox_id)
    references public.mailboxes (organization_id, id)
    on delete cascade,
  check (last_error_code is null or last_error_code ~ '^[A-Z0-9_]{3,64}$')
);

create table public.export_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid not null,
  dataset text not null check (dataset in ('companies_contacts', 'pipeline_attribution')),
  row_count integer not null check (row_count >= 0),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  correlation_id uuid not null,
  evidence_class public.evidence_class not null default 'live',
  created_at timestamptz not null default now()
);

create or replace function app.redact_audit_snapshot(
  target_record_type text,
  snapshot jsonb
)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when snapshot is null then null
    when target_record_type = 'messages' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'enrollment_id', snapshot -> 'enrollment_id',
      'mailbox_id', snapshot -> 'mailbox_id',
      'contact_id', snapshot -> 'contact_id',
      'direction', snapshot -> 'direction',
      'status', snapshot -> 'status',
      'touch_number', snapshot -> 'touch_number',
      'correlation_id', snapshot -> 'correlation_id',
      'sent_at', snapshot -> 'sent_at',
      'created_at', snapshot -> 'created_at',
      'updated_at', snapshot -> 'updated_at'
    ))
    when target_record_type = 'suppression_entries' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'kind', snapshot -> 'kind',
      'account_id', snapshot -> 'account_id',
      'source_batch_id', snapshot -> 'source_batch_id',
      'effective_at', snapshot -> 'effective_at',
      'expires_at', snapshot -> 'expires_at',
      'created_at', snapshot -> 'created_at'
    ))
    when target_record_type = 'event_outbox' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'aggregate_type', snapshot -> 'aggregate_type',
      'aggregate_id', snapshot -> 'aggregate_id',
      'event_type', snapshot -> 'event_type',
      'status', snapshot -> 'status',
      'attempt_count', snapshot -> 'attempt_count',
      'next_attempt_at', snapshot -> 'next_attempt_at',
      'locked_at', snapshot -> 'locked_at',
      'created_at', snapshot -> 'created_at',
      'delivered_at', snapshot -> 'delivered_at'
    ))
    when target_record_type = 'campaigns' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'status', snapshot -> 'status',
      'manifest_sha256', snapshot -> 'manifest_sha256',
      'suppression_snapshot_at', snapshot -> 'suppression_snapshot_at',
      'shadow_canary_decision', snapshot -> 'shadow_canary_decision',
      'approved_by', snapshot -> 'approved_by',
      'approved_at', snapshot -> 'approved_at',
      'created_at', snapshot -> 'created_at',
      'updated_at', snapshot -> 'updated_at'
    ))
    when target_record_type = 'runtime_controls' then jsonb_strip_nulls(jsonb_build_object(
      'organization_id', snapshot -> 'organization_id',
      'global_kill_switch', snapshot -> 'global_kill_switch',
      'external_send_allowed', snapshot -> 'external_send_allowed',
      'updated_by', snapshot -> 'updated_by',
      'updated_at', snapshot -> 'updated_at'
    ))
    when target_record_type = 'campaign_enrollments' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'campaign_id', snapshot -> 'campaign_id',
      'sequence_version_id', snapshot -> 'sequence_version_id',
      'account_id', snapshot -> 'account_id',
      'contact_id', snapshot -> 'contact_id',
      'mailbox_id', snapshot -> 'mailbox_id',
      'status', snapshot -> 'status',
      'next_touch_number', snapshot -> 'next_touch_number',
      'next_touch_at', snapshot -> 'next_touch_at',
      'created_at', snapshot -> 'created_at',
      'updated_at', snapshot -> 'updated_at'
    ))
    when target_record_type = 'leads' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'account_id', snapshot -> 'account_id',
      'contact_id', snapshot -> 'contact_id',
      'prequote_id', snapshot -> 'prequote_id',
      'origin_message_id', snapshot -> 'origin_message_id',
      'status', snapshot -> 'status',
      'contractual_qualified', snapshot -> 'contractual_qualified',
      'evidence_class', snapshot -> 'evidence_class',
      'created_at', snapshot -> 'created_at',
      'updated_at', snapshot -> 'updated_at'
    ))
    when target_record_type = 'opportunities' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'account_id', snapshot -> 'account_id',
      'lead_id', snapshot -> 'lead_id',
      'stage', snapshot -> 'stage',
      'economic_buyer', snapshot -> 'economic_buyer',
      'active_pain', snapshot -> 'active_pain',
      'business_impact', snapshot -> 'business_impact',
      'timing_under_90_days', snapshot -> 'timing_under_90_days',
      'value_mxn', snapshot -> 'value_mxn',
      'next_action_at', snapshot -> 'next_action_at',
      'created_at', snapshot -> 'created_at',
      'updated_at', snapshot -> 'updated_at'
    ))
    when target_record_type = 'approvals' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'subject_type', snapshot -> 'subject_type',
      'subject_id', snapshot -> 'subject_id',
      'subject_sha256', snapshot -> 'subject_sha256',
      'decision', snapshot -> 'decision',
      'decided_by', snapshot -> 'decided_by',
      'decided_at', snapshot -> 'decided_at'
    ))
    when target_record_type = 'incidents' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'severity', snapshot -> 'severity',
      'status', snapshot -> 'status',
      'correlation_id', snapshot -> 'correlation_id',
      'opened_at', snapshot -> 'opened_at',
      'acknowledged_at', snapshot -> 'acknowledged_at',
      'resolved_at', snapshot -> 'resolved_at',
      'owner_user_id', snapshot -> 'owner_user_id'
    ))
    when target_record_type = 'prequote_documents' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'prequote_id', snapshot -> 'prequote_id',
      'bucket_id', snapshot -> 'bucket_id',
      'media_type', snapshot -> 'media_type',
      'sha256', snapshot -> 'sha256',
      'size_bytes', snapshot -> 'size_bytes',
      'retention_until', snapshot -> 'retention_until',
      'quarantine_status', snapshot -> 'quarantine_status',
      'scanned_at', snapshot -> 'scanned_at',
      'scan_engine', snapshot -> 'scan_engine',
      'released_at', snapshot -> 'released_at',
      'created_at', snapshot -> 'created_at'
    ))
    when target_record_type = 'provider_events' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'source', snapshot -> 'source',
      'source_record_type', snapshot -> 'source_record_type',
      'message_id', snapshot -> 'message_id',
      'event_kind', snapshot -> 'event_kind',
      'reply_classification', snapshot -> 'reply_classification',
      'correlation_id', snapshot -> 'correlation_id',
      'processing_status', snapshot -> 'processing_status',
      'observed_at', snapshot -> 'observed_at',
      'processed_at', snapshot -> 'processed_at',
      'created_at', snapshot -> 'created_at'
    ))
    when target_record_type = 'gmail_push_notifications' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'mailbox_id', snapshot -> 'mailbox_id',
      'history_id', snapshot -> 'history_id',
      'published_at', snapshot -> 'published_at',
      'received_at', snapshot -> 'received_at',
      'processed_at', snapshot -> 'processed_at',
      'status', snapshot -> 'status',
      'correlation_id', snapshot -> 'correlation_id'
    ))
    when target_record_type = 'mailbox_sync_cursors' then jsonb_strip_nulls(jsonb_build_object(
      'organization_id', snapshot -> 'organization_id',
      'mailbox_id', snapshot -> 'mailbox_id',
      'last_history_id', snapshot -> 'last_history_id',
      'watch_expires_at', snapshot -> 'watch_expires_at',
      'status', snapshot -> 'status',
      'last_synced_at', snapshot -> 'last_synced_at',
      'last_error_code', snapshot -> 'last_error_code',
      'updated_at', snapshot -> 'updated_at'
    ))
    when target_record_type = 'export_runs' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'requested_by', snapshot -> 'requested_by',
      'dataset', snapshot -> 'dataset',
      'row_count', snapshot -> 'row_count',
      'sha256', snapshot -> 'sha256',
      'correlation_id', snapshot -> 'correlation_id',
      'evidence_class', snapshot -> 'evidence_class',
      'created_at', snapshot -> 'created_at'
    ))
    when target_record_type = 'qualification_checks' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'lead_id', snapshot -> 'lead_id',
      'industrial_over_100_kwp', snapshot -> 'industrial_over_100_kwp',
      'outside_annex_a', snapshot -> 'outside_annex_a',
      'verified_target_role', snapshot -> 'verified_target_role',
      'explicit_interest', snapshot -> 'explicit_interest',
      'monthly_spend_mxn', snapshot -> 'monthly_spend_mxn',
      'evidence_record_ids', snapshot -> 'evidence_record_ids',
      'evaluated_by', snapshot -> 'evaluated_by',
      'evaluated_at', snapshot -> 'evaluated_at'
    ))
    when target_record_type = 'meetings' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'opportunity_id', snapshot -> 'opportunity_id',
      'scheduled_at', snapshot -> 'scheduled_at',
      'held_at', snapshot -> 'held_at',
      'attendance_verified', snapshot -> 'attendance_verified',
      'created_at', snapshot -> 'created_at'
    ))
    when target_record_type = 'tasks' then jsonb_strip_nulls(jsonb_build_object(
      'id', snapshot -> 'id',
      'organization_id', snapshot -> 'organization_id',
      'account_id', snapshot -> 'account_id',
      'contact_id', snapshot -> 'contact_id',
      'task_type', snapshot -> 'task_type',
      'owner_user_id', snapshot -> 'owner_user_id',
      'due_at', snapshot -> 'due_at',
      'status', snapshot -> 'status',
      'created_at', snapshot -> 'created_at',
      'completed_at', snapshot -> 'completed_at'
    ))
    else jsonb_build_object('redaction', 'NO_ALLOWLIST_FOR_RECORD_TYPE')
  end;
$$;

create or replace function public.capture_gmail_push_notification(
  target_organization_id uuid,
  target_idempotency_key text,
  target_request_nonce uuid,
  target_request_expires_at_epoch bigint,
  target_payload_sha256 text,
  target_request_signature text,
  target_payload_text text
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  runtime_secret text;
  expected_signature text;
  calculated_payload_sha256 text;
  signed_value text;
  request_expires_at timestamptz;
  payload jsonb;
  mailbox_record public.mailboxes%rowtype;
  existing_notification public.gmail_push_notifications%rowtype;
  created_id uuid := gen_random_uuid();
  correlation_id_value uuid := gen_random_uuid();
  subscription_hash text;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || ':gmail-push:' || target_idempotency_key,
    0
  ));

  if target_organization_id is null
    or target_request_nonce is null
    or target_idempotency_key is null
    or target_idempotency_key !~ '^[A-Za-z0-9_.:-]{16,255}$'
    or target_payload_sha256 !~ '^[a-f0-9]{64}$'
    or target_request_signature !~ '^[a-f0-9]{64}$'
    or target_payload_text is null
    or octet_length(target_payload_text) > 20000
  then
    raise exception 'GMAIL_PUSH_REQUEST_INVALID';
  end if;

  select gmail_ingest_secret into runtime_secret
  from app.private_runtime_config
  where organization_id = target_organization_id;
  if not found or runtime_secret is null then raise exception 'GMAIL_PUSH_RUNTIME_NOT_CONFIGURED'; end if;

  calculated_payload_sha256 := encode(digest(target_payload_text, 'sha256'), 'hex');
  if calculated_payload_sha256 <> target_payload_sha256 then raise exception 'GMAIL_PUSH_PAYLOAD_HASH_MISMATCH'; end if;

  signed_value := concat_ws(E'\n',
    target_organization_id::text,
    target_idempotency_key,
    target_request_nonce::text,
    target_request_expires_at_epoch::text,
    target_payload_sha256
  );
  expected_signature := encode(
    hmac(convert_to(signed_value, 'UTF8'), convert_to(runtime_secret, 'UTF8'), 'sha256'),
    'hex'
  );
  if digest(target_request_signature, 'sha256') <> digest(expected_signature, 'sha256') then
    raise exception 'GMAIL_PUSH_SIGNATURE_INVALID';
  end if;

  request_expires_at := to_timestamp(target_request_expires_at_epoch);
  if request_expires_at < clock_timestamp() - interval '30 seconds'
    or request_expires_at > clock_timestamp() + interval '5 minutes 30 seconds'
  then
    raise exception 'GMAIL_PUSH_PROOF_EXPIRED';
  end if;

  begin
    insert into public.public_prequote_nonces (organization_id, request_nonce, request_expires_at)
    values (target_organization_id, target_request_nonce, request_expires_at);
  exception
    when unique_violation then raise exception 'GMAIL_PUSH_REPLAY_REJECTED';
  end;

  begin
    payload := target_payload_text::jsonb;
  exception
    when others then raise exception 'GMAIL_PUSH_PAYLOAD_INVALID';
  end;

  if jsonb_typeof(payload) <> 'object'
    or not (payload ?& array['emailAddress', 'historyId', 'messageId', 'publishTime', 'subscription'])
    or exists (
      select 1 from jsonb_object_keys(payload) key
      where key not in ('emailAddress', 'historyId', 'messageId', 'publishTime', 'subscription')
    )
    or lower(payload ->> 'emailAddress') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or payload ->> 'historyId' !~ '^[0-9]{1,32}$'
    or payload ->> 'messageId' !~ '^[A-Za-z0-9._:-]{1,255}$'
    or length(payload ->> 'subscription') not between 3 and 512
  then
    raise exception 'GMAIL_PUSH_PAYLOAD_INVALID';
  end if;

  select * into mailbox_record
  from public.mailboxes
  where organization_id = target_organization_id
    and normalized_email = lower(payload ->> 'emailAddress')
  for share;
  if not found then raise exception 'GMAIL_PUSH_MAILBOX_UNKNOWN'; end if;

  select * into existing_notification
  from public.gmail_push_notifications
  where organization_id = target_organization_id
    and pubsub_message_id = payload ->> 'messageId';
  if found then
    return jsonb_build_object(
      'status', 'DUPLICATE',
      'notification_id', existing_notification.id,
      'correlation_id', existing_notification.correlation_id
    );
  end if;

  subscription_hash := encode(digest(payload ->> 'subscription', 'sha256'), 'hex');
  insert into public.gmail_push_notifications (
    id, organization_id, mailbox_id, pubsub_message_id, history_id,
    subscription_sha256, published_at, correlation_id
  ) values (
    created_id, target_organization_id, mailbox_record.id, payload ->> 'messageId',
    payload ->> 'historyId', subscription_hash, (payload ->> 'publishTime')::timestamptz,
    correlation_id_value
  );

  insert into public.event_outbox (
    organization_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload_json
  ) values (
    target_organization_id,
    'gmail_push_notification',
    created_id,
    'gmail.history_sync_requested',
    'gmail-history:' || target_idempotency_key,
    jsonb_build_object(
      'notification_id', created_id,
      'mailbox_id', mailbox_record.id,
      'history_id', payload ->> 'historyId',
      'correlation_id', correlation_id_value
    )
  );

  return jsonb_build_object(
    'status', 'ACCEPTED',
    'notification_id', created_id,
    'correlation_id', correlation_id_value
  );
exception
  when invalid_text_representation or datetime_field_overflow then
    raise exception 'GMAIL_PUSH_PAYLOAD_INVALID';
end;
$$;

create or replace function app.record_export_run(
  target_organization_id uuid,
  target_dataset text,
  target_row_count integer,
  target_sha256 text,
  target_correlation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  created_id uuid;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then
    raise exception 'EXPORT_MEMBER_REQUIRED';
  end if;
  if target_dataset not in ('companies_contacts', 'pipeline_attribution')
    or target_row_count is null or target_row_count < 0
    or target_sha256 !~ '^[a-f0-9]{64}$'
    or target_correlation_id is null
  then
    raise exception 'EXPORT_AUDIT_INPUT_INVALID';
  end if;
  insert into public.export_runs (
    organization_id, requested_by, dataset, row_count, sha256, correlation_id
  ) values (
    target_organization_id, auth.uid(), target_dataset, target_row_count, target_sha256, target_correlation_id
  ) returning id into created_id;
  return created_id;
end;
$$;

create or replace function app.enforce_lead_qualification_transition()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  qualification public.qualification_checks%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.contractual_qualified or new.status = 'QUALIFIED' then
      raise exception 'STRICT_LEAD_CREATION_MUST_START_UNQUALIFIED';
    end if;
    return new;
  end if;
  if new.contractual_qualified = old.contractual_qualified
    and new.status = old.status
  then return new; end if;

  if new.contractual_qualified then
    select * into qualification
    from public.qualification_checks
    where organization_id = new.organization_id and lead_id = new.id;
    if not found
      or qualification.industrial_over_100_kwp is not true
      or qualification.outside_annex_a is not true
      or qualification.verified_target_role is not true
      or not (
        qualification.explicit_interest is true
        or coalesce(qualification.monthly_spend_mxn, 0) > 20000
      )
      or cardinality(qualification.evidence_record_ids) = 0
    then raise exception 'STRICT_LEAD_EVIDENCE_INCOMPLETE'; end if;
    if new.status <> 'QUALIFIED' then raise exception 'STRICT_LEAD_STATUS_MISMATCH'; end if;
  elsif new.status = 'QUALIFIED' then
    raise exception 'QUALIFIED_STATUS_REQUIRES_CONTRACTUAL_FLAG';
  end if;
  return new;
end;
$$;

create or replace function app.enforce_opportunity_transition()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  stage_order integer;
  old_stage_order integer;
  lead_record public.leads%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.stage not in ('PROSPECTING', 'CONVERSATION') then
      raise exception 'OPPORTUNITY_CREATION_STAGE_INVALID';
    end if;
    return new;
  end if;
  if new.stage = old.stage then return new; end if;
  stage_order := array_position(
    array['PROSPECTING', 'CONVERSATION', 'MEETING_CONFIRMED', 'DISCOVERY_HELD', 'QUALIFIED', 'TECHNICAL_VISIT', 'PROPOSAL', 'DECISION', 'CLOSED_WON', 'CLOSED_LOST']::text[],
    new.stage::text
  );
  old_stage_order := array_position(
    array['PROSPECTING', 'CONVERSATION', 'MEETING_CONFIRMED', 'DISCOVERY_HELD', 'QUALIFIED', 'TECHNICAL_VISIT', 'PROPOSAL', 'DECISION', 'CLOSED_WON', 'CLOSED_LOST']::text[],
    old.stage::text
  );
  if old.stage in ('CLOSED_WON', 'CLOSED_LOST') then raise exception 'CLOSED_OPPORTUNITY_IMMUTABLE'; end if;
  if new.stage not in ('CLOSED_WON', 'CLOSED_LOST') and stage_order > old_stage_order + 1 then
    raise exception 'OPPORTUNITY_STAGE_SKIP_REJECTED';
  end if;
  if new.stage in ('QUALIFIED', 'TECHNICAL_VISIT', 'PROPOSAL', 'DECISION', 'CLOSED_WON') then
    if new.lead_id is null then raise exception 'QUALIFIED_PIPELINE_REQUIRES_LEAD'; end if;
    select * into lead_record
    from public.leads
    where organization_id = new.organization_id and id = new.lead_id;
    if not found or not lead_record.contractual_qualified then
      raise exception 'QUALIFIED_PIPELINE_REQUIRES_STRICT_LEAD';
    end if;
    if not (
      new.economic_buyer and new.active_pain and new.business_impact and new.timing_under_90_days
      and coalesce(new.value_mxn, 0) > 0
      and nullif(btrim(new.next_action), '') is not null
      and new.next_action_at is not null
    ) then raise exception 'QUALIFIED_PIPELINE_EVIDENCE_INCOMPLETE'; end if;
  end if;
  if new.stage = 'PROPOSAL' and not exists (
    select 1 from public.proposals p
    where p.organization_id = new.organization_id and p.opportunity_id = new.id and p.delivered_at is not null
  ) then raise exception 'PROPOSAL_STAGE_REQUIRES_DELIVERY_EVIDENCE'; end if;
  if new.stage = 'CLOSED_WON' and not exists (
    select 1 from public.approvals a
    where a.organization_id = new.organization_id
      and a.subject_type = 'opportunity_closed_won'
      and a.subject_id = new.id
      and a.decision = 'APPROVED'
  ) then raise exception 'CLOSED_WON_REQUIRES_APPROVAL_EVIDENCE'; end if;
  return new;
end;
$$;

create or replace function app.enforce_meeting_evidence()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
begin
  if new.attendance_verified then
    if new.held_at is null or new.held_at > clock_timestamp() + interval '5 minutes'
      or nullif(btrim(new.outcome_notes), '') is null
    then raise exception 'MEETING_EVIDENCE_INCOMPLETE'; end if;
  elsif new.held_at is not null then
    raise exception 'MEETING_HELD_REQUIRES_ATTENDANCE_VERIFICATION';
  end if;
  return new;
end;
$$;

create or replace function app.qualify_lead_strict(
  target_organization_id uuid,
  target_lead_id uuid,
  target_industrial_over_100_kwp boolean,
  target_outside_annex_a boolean,
  target_verified_target_role boolean,
  target_explicit_interest boolean,
  target_monthly_spend_mxn numeric,
  target_evidence_record_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  lead_record public.leads%rowtype;
begin
  if not app.has_role(target_organization_id, array[
    'ennco_admin'::public.user_role, 'ennco_operator'::public.user_role,
    'teckel_admin'::public.user_role, 'teckel_operator'::public.user_role
  ]) then raise exception 'LEAD_QUALIFICATION_ROLE_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text || ':lead:' || target_lead_id::text, 0));
  select * into lead_record from public.leads
  where organization_id = target_organization_id and id = target_lead_id
  for update;
  if not found then raise exception 'LEAD_NOT_FOUND'; end if;
  if not (
    target_industrial_over_100_kwp
    and target_outside_annex_a
    and target_verified_target_role
    and (target_explicit_interest or coalesce(target_monthly_spend_mxn, 0) > 20000)
    and cardinality(coalesce(target_evidence_record_ids, '{}'::uuid[])) > 0
  ) then raise exception 'STRICT_LEAD_EVIDENCE_INCOMPLETE'; end if;
  insert into public.qualification_checks (
    organization_id, lead_id, industrial_over_100_kwp, outside_annex_a,
    verified_target_role, explicit_interest, monthly_spend_mxn,
    evidence_record_ids, evaluated_by, evaluated_at
  ) values (
    target_organization_id, target_lead_id, target_industrial_over_100_kwp,
    target_outside_annex_a, target_verified_target_role, target_explicit_interest,
    target_monthly_spend_mxn, target_evidence_record_ids, auth.uid(), now()
  )
  on conflict (lead_id) do update set
    industrial_over_100_kwp = excluded.industrial_over_100_kwp,
    outside_annex_a = excluded.outside_annex_a,
    verified_target_role = excluded.verified_target_role,
    explicit_interest = excluded.explicit_interest,
    monthly_spend_mxn = excluded.monthly_spend_mxn,
    evidence_record_ids = excluded.evidence_record_ids,
    evaluated_by = excluded.evaluated_by,
    evaluated_at = excluded.evaluated_at;
  update public.leads
  set status = 'QUALIFIED', contractual_qualified = true,
      qualification_reason = 'STRICT_EVIDENCE_VERIFIED', updated_at = now()
  where id = target_lead_id and organization_id = target_organization_id;
  insert into public.event_outbox (
    organization_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload_json
  ) values (
    target_organization_id, 'lead', target_lead_id, 'lead.contractual_qualified',
    'strict-lead:' || target_lead_id::text,
    jsonb_build_object('lead_id', target_lead_id, 'evaluated_by', auth.uid())
  ) on conflict (organization_id, idempotency_key) do nothing;
  return jsonb_build_object('status', 'QUALIFIED', 'lead_id', target_lead_id);
end;
$$;

create or replace function app.complete_operational_task(
  target_organization_id uuid,
  target_task_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  affected integer;
begin
  if not app.has_role(target_organization_id, array[
    'ennco_admin'::public.user_role, 'ennco_operator'::public.user_role,
    'teckel_admin'::public.user_role, 'teckel_operator'::public.user_role
  ]) then raise exception 'TASK_OPERATOR_ROLE_REQUIRED'; end if;
  update public.tasks set status = 'DONE', completed_at = now()
  where organization_id = target_organization_id and id = target_task_id and status = 'OPEN';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'OPEN_TASK_NOT_FOUND'; end if;
  return jsonb_build_object('status', 'DONE', 'task_id', target_task_id);
end;
$$;

create or replace function app.record_meeting_outcome(
  target_organization_id uuid,
  target_meeting_id uuid,
  target_held_at timestamptz,
  target_attendance_verified boolean,
  target_outcome_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  affected integer;
begin
  if not app.has_role(target_organization_id, array[
    'ennco_admin'::public.user_role, 'ennco_operator'::public.user_role,
    'teckel_admin'::public.user_role, 'teckel_operator'::public.user_role
  ]) then raise exception 'MEETING_OPERATOR_ROLE_REQUIRED'; end if;
  if octet_length(coalesce(target_outcome_notes, '')) > 10000 then raise exception 'MEETING_NOTES_TOO_LARGE'; end if;
  update public.meetings
  set held_at = target_held_at,
      attendance_verified = target_attendance_verified,
      outcome_notes = target_outcome_notes
  where organization_id = target_organization_id and id = target_meeting_id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'MEETING_NOT_FOUND'; end if;
  return jsonb_build_object('status', 'RECORDED', 'meeting_id', target_meeting_id);
end;
$$;

create or replace function app.transition_opportunity(
  target_organization_id uuid,
  target_opportunity_id uuid,
  target_stage public.commercial_stage,
  target_value_mxn numeric,
  target_next_action text,
  target_next_action_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  affected integer;
begin
  if not app.has_role(target_organization_id, array[
    'ennco_admin'::public.user_role, 'ennco_operator'::public.user_role,
    'teckel_admin'::public.user_role, 'teckel_operator'::public.user_role
  ]) then raise exception 'OPPORTUNITY_OPERATOR_ROLE_REQUIRED'; end if;
  if octet_length(coalesce(target_next_action, '')) > 2000 then raise exception 'NEXT_ACTION_TOO_LARGE'; end if;
  update public.opportunities
  set stage = target_stage,
      value_mxn = target_value_mxn,
      next_action = target_next_action,
      next_action_at = target_next_action_at,
      updated_at = now()
  where organization_id = target_organization_id and id = target_opportunity_id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'OPPORTUNITY_NOT_FOUND'; end if;
  return jsonb_build_object('status', target_stage, 'opportunity_id', target_opportunity_id);
end;
$$;

create or replace function app.apply_mailbox_provider_event(
  target_organization_id uuid,
  target_mailbox_id uuid,
  target_external_event_id text,
  target_provider_message_id text,
  target_related_outbound_message_id uuid,
  target_event_kind public.provider_event_kind,
  target_reply_classification public.reply_classification,
  target_normalized_from text,
  target_subject text,
  target_body_text text,
  target_observed_at timestamptz,
  target_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  outbound_record public.messages%rowtype;
  enrollment_record public.campaign_enrollments%rowtype;
  contact_record public.contacts%rowtype;
  existing_event public.provider_events%rowtype;
  provider_event_id uuid := gen_random_uuid();
  inbound_message_id uuid;
  created_lead_id uuid;
  created_task_id uuid;
  processing_result text := 'PROCESSED';
begin
  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || ':gmail-event:' || coalesce(target_external_event_id, ''),
    0
  ));

  if target_organization_id is null
    or target_mailbox_id is null
    or target_external_event_id is null
    or length(target_external_event_id) not between 1 and 512
    or target_provider_message_id is null
    or length(target_provider_message_id) not between 1 and 512
    or target_event_kind is null
    or target_reply_classification is null
    or target_observed_at is null
    or target_correlation_id is null
    or (target_event_kind = 'REPLY' and target_reply_classification <> 'UNREVIEWED')
    or (target_event_kind <> 'REPLY' and target_reply_classification <> 'NOT_APPLICABLE')
  then
    raise exception 'PROVIDER_EVENT_INVALID';
  end if;

  select * into existing_event
  from public.provider_events
  where organization_id = target_organization_id
    and source = 'gmail'
    and source_record_type = 'message'
    and external_event_id = target_external_event_id;
  if found then
    return jsonb_build_object(
      'status', 'DUPLICATE',
      'provider_event_id', existing_event.id,
      'message_id', existing_event.message_id
    );
  end if;

  select * into outbound_record
  from public.messages
  where organization_id = target_organization_id
    and id = target_related_outbound_message_id
    and mailbox_id = target_mailbox_id
    and direction = 'OUTBOUND'
  for update;

  if not found then
    insert into public.provider_events (
      id, organization_id, source, source_record_type, external_event_id,
      payload_json, observed_at, event_kind, reply_classification,
      correlation_id, processing_status
    ) values (
      provider_event_id, target_organization_id, 'gmail', 'message', target_external_event_id,
      jsonb_build_object('provider_message_id_sha256', encode(digest(target_provider_message_id, 'sha256'), 'hex')),
      target_observed_at, target_event_kind, target_reply_classification,
      target_correlation_id, 'QUARANTINED'
    );
    insert into public.dead_letters (
      organization_id, source_table, source_id, reason, payload_json
    ) values (
      target_organization_id, 'provider_events', provider_event_id,
      'OUTBOUND_MESSAGE_NOT_RESOLVED',
      jsonb_build_object('provider_event_id', provider_event_id, 'correlation_id', target_correlation_id)
    );
    return jsonb_build_object('status', 'QUARANTINED', 'provider_event_id', provider_event_id);
  end if;

  select * into enrollment_record
  from public.campaign_enrollments
  where organization_id = target_organization_id
    and id = outbound_record.enrollment_id
  for update;
  if not found then raise exception 'PROVIDER_EVENT_ENROLLMENT_NOT_FOUND'; end if;

  select * into contact_record
  from public.contacts
  where organization_id = target_organization_id
    and id = enrollment_record.contact_id;
  if not found then raise exception 'PROVIDER_EVENT_CONTACT_NOT_FOUND'; end if;

  if target_event_kind in ('REPLY', 'AUTO_REPLY', 'UNSUBSCRIBE') then
    if target_normalized_from is null
      or lower(target_normalized_from) <> contact_record.normalized_email
      or octet_length(coalesce(target_subject, '')) > 1000
      or octet_length(coalesce(target_body_text, '')) > 100000
    then
      raise exception 'PROVIDER_EVENT_MESSAGE_INVALID';
    end if;

    insert into public.messages (
      organization_id, enrollment_id, mailbox_id, contact_id, direction, status,
      normalized_to, normalized_from, subject, body_text, idempotency_key,
      provider_message_id, correlation_id, sent_at
    ) values (
      target_organization_id, enrollment_record.id, target_mailbox_id, contact_record.id,
      'INBOUND', 'DELIVERED', outbound_record.normalized_from, lower(target_normalized_from),
      target_subject, target_body_text, 'gmail-inbound:' || target_external_event_id,
      target_provider_message_id, target_correlation_id, target_observed_at
    ) returning id into inbound_message_id;
  end if;

  if target_event_kind = 'DELIVERY' then
    update public.messages
    set status = 'DELIVERED', updated_at = now()
    where id = outbound_record.id and status in ('QUEUED', 'SENDING', 'SENT');
  elsif target_event_kind = 'HARD_BOUNCE' then
    update public.messages set status = 'BOUNCED', updated_at = now() where id = outbound_record.id;
    update public.campaign_enrollments
    set status = 'BOUNCED', stopped_reason = 'HARD_BOUNCE', next_touch_at = null, updated_at = now()
    where id = enrollment_record.id;
    insert into public.suppression_entries (
      organization_id, kind, account_id, normalized_email, normalized_domain, reason
    ) values (
      target_organization_id, 'HARD_BOUNCE', null,
      contact_record.normalized_email, null,
      'GMAIL_HARD_BOUNCE'
    ) on conflict do nothing;
  elsif target_event_kind = 'UNSUBSCRIBE' then
    update public.campaign_enrollments
    set status = 'UNSUBSCRIBED', stopped_reason = 'UNSUBSCRIBE', next_touch_at = null, updated_at = now()
    where id = enrollment_record.id;
    insert into public.suppression_entries (
      organization_id, kind, account_id, normalized_email, normalized_domain, reason
    ) values (
      target_organization_id, 'UNSUBSCRIBE', null,
      contact_record.normalized_email, null,
      'GMAIL_UNSUBSCRIBE'
    ) on conflict do nothing;
  elsif target_event_kind = 'AUTO_REPLY' then
    update public.campaign_enrollments
    set status = 'PAUSED', stopped_reason = 'AUTO_REPLY_REVIEW', next_touch_at = null, updated_at = now()
    where id = enrollment_record.id;
    insert into public.tasks (
      organization_id, account_id, contact_id, task_type, normalized_objective, due_at
    ) values (
      target_organization_id, enrollment_record.account_id, contact_record.id,
      'REPLY_REVIEW', 'review automatic reply before resuming sequence', now() + interval '1 day'
    ) on conflict do nothing returning id into created_task_id;
  elsif target_event_kind = 'REPLY' then
    update public.campaign_enrollments
    set status = 'REPLIED', stopped_reason = 'HUMAN_REPLY', next_touch_at = null, updated_at = now()
    where id = enrollment_record.id;

    insert into public.tasks (
      organization_id, account_id, contact_id, task_type, normalized_objective, due_at
    ) values (
      target_organization_id, enrollment_record.account_id, contact_record.id,
      'REPLY_FOLLOW_UP', 'review human reply and record next action', now() + interval '4 hours'
    ) on conflict do nothing returning id into created_task_id;
  elsif target_event_kind = 'UNKNOWN' then
    processing_result := 'QUARANTINED';
  end if;

  insert into public.provider_events (
    id, organization_id, source, source_record_type, external_event_id, message_id,
    payload_json, observed_at, processed_at, event_kind, reply_classification,
    correlation_id, processing_status
  ) values (
    provider_event_id, target_organization_id, 'gmail', 'message', target_external_event_id,
    coalesce(inbound_message_id, outbound_record.id),
    jsonb_build_object(
      'related_outbound_message_id', outbound_record.id,
      'provider_message_id_sha256', encode(digest(target_provider_message_id, 'sha256'), 'hex')
    ),
    target_observed_at,
    case when processing_result = 'PROCESSED' then now() else null end,
    target_event_kind, target_reply_classification, target_correlation_id, processing_result
  );

  if processing_result = 'QUARANTINED' then
    insert into public.dead_letters (
      organization_id, source_table, source_id, reason, payload_json
    ) values (
      target_organization_id, 'provider_events', provider_event_id, 'UNKNOWN_PROVIDER_EVENT_KIND',
      jsonb_build_object('provider_event_id', provider_event_id, 'correlation_id', target_correlation_id)
    );
  else
    insert into public.event_outbox (
      organization_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload_json
    ) values (
      target_organization_id,
      'provider_event',
      provider_event_id,
      'gmail.' || lower(target_event_kind::text),
      'gmail-event:' || target_external_event_id,
      jsonb_build_object(
        'provider_event_id', provider_event_id,
        'event_kind', target_event_kind,
        'message_id', coalesce(inbound_message_id, outbound_record.id),
        'lead_id', created_lead_id,
        'task_id', created_task_id,
        'correlation_id', target_correlation_id
      )
    );
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'status', processing_result,
    'provider_event_id', provider_event_id,
    'message_id', coalesce(inbound_message_id, outbound_record.id),
    'lead_id', created_lead_id,
    'task_id', created_task_id
  ));
end;
$$;

create or replace function app.review_reply_event(
  target_organization_id uuid,
  target_provider_event_id uuid,
  target_classification public.reply_classification
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  event_record public.provider_events%rowtype;
  message_record public.messages%rowtype;
  enrollment_record public.campaign_enrollments%rowtype;
  created_lead_id uuid;
begin
  if not app.has_role(target_organization_id, array[
    'ennco_admin'::public.user_role, 'ennco_operator'::public.user_role,
    'teckel_admin'::public.user_role, 'teckel_operator'::public.user_role
  ]) then raise exception 'REPLY_REVIEW_ROLE_REQUIRED'; end if;
  if target_classification not in ('POSITIVE', 'NEUTRAL', 'NEGATIVE') then
    raise exception 'REPLY_REVIEW_CLASSIFICATION_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text || ':reply-review:' || target_provider_event_id::text, 0));
  select * into event_record
  from public.provider_events
  where organization_id = target_organization_id
    and id = target_provider_event_id
    and event_kind = 'REPLY'
  for update;
  if not found then raise exception 'REPLY_EVENT_NOT_FOUND'; end if;
  if event_record.processing_status <> 'PROCESSED' then raise exception 'REPLY_EVENT_NOT_PROCESSED'; end if;
  if event_record.reply_classification <> 'UNREVIEWED' then
    if event_record.reply_classification = target_classification then
      select id into created_lead_id from public.leads
      where organization_id = target_organization_id and origin_message_id = event_record.message_id;
      return jsonb_strip_nulls(jsonb_build_object(
        'status', 'DUPLICATE', 'provider_event_id', target_provider_event_id,
        'classification', target_classification, 'lead_id', created_lead_id
      ));
    end if;
    raise exception 'REPLY_REVIEW_ALREADY_FINAL';
  end if;
  select * into message_record from public.messages
  where organization_id = target_organization_id and id = event_record.message_id and direction = 'INBOUND';
  if not found then raise exception 'REPLY_MESSAGE_NOT_FOUND'; end if;
  select * into enrollment_record from public.campaign_enrollments
  where organization_id = target_organization_id and id = message_record.enrollment_id;
  if not found then raise exception 'REPLY_ENROLLMENT_NOT_FOUND'; end if;

  update public.provider_events
  set reply_classification = target_classification
  where id = target_provider_event_id;

  if target_classification = 'POSITIVE' then
    insert into public.leads (
      organization_id, account_id, contact_id, origin_message_id, status,
      contractual_qualified, qualification_reason, evidence_class
    ) values (
      target_organization_id, enrollment_record.account_id, message_record.contact_id,
      message_record.id, 'CAPTURED', false, 'PENDING_STRICT_HUMAN_QUALIFICATION', 'live'
    ) on conflict (organization_id, origin_message_id) do nothing
    returning id into created_lead_id;
    if created_lead_id is null then
      select id into created_lead_id from public.leads
      where organization_id = target_organization_id and origin_message_id = message_record.id;
    end if;
  end if;

  insert into public.event_outbox (
    organization_id, aggregate_type, aggregate_id, event_type, idempotency_key, payload_json
  ) values (
    target_organization_id, 'provider_event', target_provider_event_id, 'reply.reviewed',
    'reply-reviewed:' || target_provider_event_id::text,
    jsonb_build_object(
      'provider_event_id', target_provider_event_id,
      'classification', target_classification,
      'lead_id', created_lead_id,
      'reviewed_by', auth.uid()
    )
  ) on conflict (organization_id, idempotency_key) do nothing;

  return jsonb_strip_nulls(jsonb_build_object(
    'status', 'REVIEWED', 'provider_event_id', target_provider_event_id,
    'classification', target_classification, 'lead_id', created_lead_id
  ));
end;
$$;

alter table public.gmail_push_notifications enable row level security;
alter table public.mailbox_sync_cursors enable row level security;
alter table public.export_runs enable row level security;

drop policy if exists provider_events_operator_write on public.provider_events;
drop policy if exists messages_operator_write on public.messages;
drop policy if exists mailboxes_operator_write on public.mailboxes;

create policy gmail_push_notifications_member_read
on public.gmail_push_notifications for select
using (app.is_member(organization_id));

create policy mailbox_sync_cursors_member_read
on public.mailbox_sync_cursors for select
using (app.is_member(organization_id));

create policy export_runs_member_read
on public.export_runs for select
using (app.is_member(organization_id));

create trigger provider_events_audit
after insert or update or delete on public.provider_events
for each row execute function app.capture_audit_event();

create trigger gmail_push_notifications_audit
after insert or update or delete on public.gmail_push_notifications
for each row execute function app.capture_audit_event();

create trigger mailbox_sync_cursors_audit
after insert or update or delete on public.mailbox_sync_cursors
for each row execute function app.capture_audit_event();

create trigger export_runs_audit
after insert or update or delete on public.export_runs
for each row execute function app.capture_audit_event();

create trigger leads_strict_qualification_transition
before insert or update of contractual_qualified, status on public.leads
for each row execute function app.enforce_lead_qualification_transition();

create trigger opportunities_strict_stage_transition
before insert or update of stage on public.opportunities
for each row execute function app.enforce_opportunity_transition();

create trigger meetings_evidence_gate
before insert or update of held_at, attendance_verified, outcome_notes on public.meetings
for each row execute function app.enforce_meeting_evidence();

create trigger qualification_checks_audit
after insert or update or delete on public.qualification_checks
for each row execute function app.capture_audit_event();

create trigger meetings_audit
after insert or update or delete on public.meetings
for each row execute function app.capture_audit_event();

create trigger tasks_audit
after insert or update or delete on public.tasks
for each row execute function app.capture_audit_event();

revoke all on table public.gmail_push_notifications from public;
revoke all on table public.mailbox_sync_cursors from public;
revoke all on table public.export_runs from public;
revoke all on function public.capture_gmail_push_notification(uuid, text, uuid, bigint, text, text, text) from public;
revoke all on function app.apply_mailbox_provider_event(uuid, uuid, text, text, uuid, public.provider_event_kind, public.reply_classification, text, text, text, timestamptz, uuid) from public;
revoke all on function app.record_export_run(uuid, text, integer, text, uuid) from public;
revoke all on function app.enforce_lead_qualification_transition() from public;
revoke all on function app.enforce_opportunity_transition() from public;
revoke all on function app.enforce_meeting_evidence() from public;
revoke all on function app.qualify_lead_strict(uuid, uuid, boolean, boolean, boolean, boolean, numeric, uuid[]) from public;
revoke all on function app.complete_operational_task(uuid, uuid) from public;
revoke all on function app.record_meeting_outcome(uuid, uuid, timestamptz, boolean, text) from public;
revoke all on function app.transition_opportunity(uuid, uuid, public.commercial_stage, numeric, text, timestamptz) from public;
revoke all on function app.review_reply_event(uuid, uuid, public.reply_classification) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant execute on function public.capture_gmail_push_notification(uuid, text, uuid, bigint, text, text, text) to anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on public.gmail_push_notifications, public.mailbox_sync_cursors, public.export_runs to authenticated;
    grant execute on function app.record_export_run(uuid, text, integer, text, uuid) to authenticated;
    grant execute on function app.qualify_lead_strict(uuid, uuid, boolean, boolean, boolean, boolean, numeric, uuid[]) to authenticated;
    grant execute on function app.complete_operational_task(uuid, uuid) to authenticated;
    grant execute on function app.record_meeting_outcome(uuid, uuid, timestamptz, boolean, text) to authenticated;
    grant execute on function app.transition_opportunity(uuid, uuid, public.commercial_stage, numeric, text, timestamptz) to authenticated;
    grant execute on function app.review_reply_event(uuid, uuid, public.reply_classification) to authenticated;
    revoke insert, update, delete, truncate on public.provider_events, public.messages, public.mailboxes from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update on public.gmail_push_notifications, public.mailbox_sync_cursors to service_role;
    grant execute on function app.apply_mailbox_provider_event(uuid, uuid, text, text, uuid, public.provider_event_kind, public.reply_classification, text, text, text, timestamptz, uuid) to service_role;
  end if;
end;
$$;

commit;
