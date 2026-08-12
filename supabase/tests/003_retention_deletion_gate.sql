\set ON_ERROR_STOP on

insert into public.organizations (id, slug, legal_name) values
  ('11111111-1111-4111-8111-111111111111', 'ennco', 'ENNCO'),
  ('12121212-1212-4212-8212-121212121212', 'other-org', 'Other Org');

insert into public.organization_users (organization_id, user_id, role) values
  ('11111111-1111-4111-8111-111111111111', '81111111-1111-4111-8111-111111111111', 'teckel_admin'),
  ('11111111-1111-4111-8111-111111111111', '82111111-1111-4111-8111-111111111111', 'ennco_admin'),
  ('11111111-1111-4111-8111-111111111111', '83111111-1111-4111-8111-111111111111', 'ennco_operator'),
  ('11111111-1111-4111-8111-111111111111', '84111111-1111-4111-8111-111111111111', 'auditor_readonly'),
  ('12121212-1212-4212-8212-121212121212', '85121212-1212-4212-8212-121212121212', 'teckel_admin'),
  ('12121212-1212-4212-8212-121212121212', '86121212-1212-4212-8212-121212121212', 'ennco_admin');

insert into public.accounts (
  id, organization_id, legal_name, normalized_name, primary_domain, evidence_class, source_confidence
) values
  ('21111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Synthetic Retention A', 'synthetic retention a', 'retention-a.invalid', 'synthetic_demo', 'VERIFIED'),
  ('22121212-1212-4212-8212-121212121212', '12121212-1212-4212-8212-121212121212', 'Synthetic Retention B', 'synthetic retention b', 'retention-b.invalid', 'synthetic_demo', 'VERIFIED');

insert into public.contacts (
  id, organization_id, account_id, full_name, role_title, normalized_email, verified, verified_at, source_confidence
) values
  ('31111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111111', 'M2 Sentinel Held Name', 'CEO', 'm2_retention_held@invalid.test', true, now(), 'VERIFIED'),
  ('32111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111111', 'M2 Sentinel Delete Name', 'CEO', 'm2_retention_delete@invalid.test', true, now(), 'VERIFIED'),
  ('33121212-1212-4212-8212-121212121212', '12121212-1212-4212-8212-121212121212', '22121212-1212-4212-8212-121212121212', 'M2 Sentinel Foreign Name', 'CEO', 'm2_retention_foreign@invalid.test', true, now(), 'VERIFIED');

insert into public.prequote_models (
  id, organization_id, version, status, assumptions, source_manifest
) values (
  '34111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  'retention-synthetic',
  'DRAFT_REVIEW_REQUIRED',
  '{}',
  '{}'
);

insert into public.prequotes (
  id, organization_id, model_id, folio, need_type, account_name, contact_name, contact_role,
  normalized_email, phone_e164, monthly_spend_mxn, tariff, installed_capacity_kwp,
  coverage_target_pct, city, state, zone, result_json, consented_at, evidence_class, correlation_id
) values (
  '35111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '34111111-1111-4111-8111-111111111111',
  'RETENTION-SYNTHETIC',
  'solar',
  'Synthetic Retention A',
  'M2 Sentinel Delete Name',
  'CEO',
  'm2_retention_delete@invalid.test',
  '+520000000000',
  50000,
  'GDMTH',
  0,
  80,
  'Leon',
  'Guanajuato',
  'urban',
  '{}',
  now(),
  'synthetic_demo',
  '36111111-1111-4111-8111-111111111111'
);

insert into public.leads (
  id, organization_id, account_id, contact_id, prequote_id, status,
  contractual_qualified, qualification_reason, evidence_class
) values (
  '37111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '21111111-1111-4111-8111-111111111111',
  '32111111-1111-4111-8111-111111111111',
  '35111111-1111-4111-8111-111111111111',
  'CAPTURED', false, 'M2_RETENTION_SENTINEL_QUALIFICATION', 'synthetic_demo'
);

insert into public.opportunities (
  id, organization_id, account_id, lead_id, next_action, loss_reason
) values (
  '38111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '21111111-1111-4111-8111-111111111111',
  '37111111-1111-4111-8111-111111111111',
  'M2_RETENTION_SENTINEL_NEXT_ACTION',
  'M2_RETENTION_SENTINEL_LOSS_REASON'
);

insert into public.meetings (
  organization_id, opportunity_id, scheduled_at, outcome_notes
) values (
  '11111111-1111-4111-8111-111111111111',
  '38111111-1111-4111-8111-111111111111',
  now(),
  'M2_RETENTION_SENTINEL_MEETING_NOTES'
);

insert into public.source_evidence (
  organization_id, subject_type, subject_id, field_name, source_name, observed_at,
  confidence, value_json
) values (
  '11111111-1111-4111-8111-111111111111',
  'contact',
  '32111111-1111-4111-8111-111111111111',
  'contact_detail',
  'synthetic',
  now(),
  'VERIFIED',
  '{"value":"M2_RETENTION_SENTINEL_SOURCE_EVIDENCE"}'
);

insert into public.tasks (
  organization_id, account_id, contact_id, task_type, normalized_objective, due_at
) values (
  '11111111-1111-4111-8111-111111111111',
  '21111111-1111-4111-8111-111111111111',
  '32111111-1111-4111-8111-111111111111',
  'RETENTION_SYNTHETIC',
  'M2_RETENTION_SENTINEL_TASK',
  now()
);

insert into public.prequote_documents (
  id, organization_id, prequote_id, storage_path, media_type, sha256, size_bytes, retention_until
) values (
  '39111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '35111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111/prequotes/35111111-1111-4111-8111-111111111111/39911111-1111-4111-8111-111111111111.pdf',
  'application/pdf', repeat('9', 64), 100, now() + interval '90 days'
);

insert into storage.objects (bucket_id, name, metadata) values (
  'ennco-sensitive-documents',
  '11111111-1111-4111-8111-111111111111/prequotes/35111111-1111-4111-8111-111111111111/39911111-1111-4111-8111-111111111111.pdf',
  '{"synthetic":true}'
);

insert into public.messages (
  id, organization_id, contact_id, direction, status, normalized_to, normalized_from,
  subject, body_text, idempotency_key, correlation_id
) values
  ('41111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '32111111-1111-4111-8111-111111111111', 'OUTBOUND', 'DRY_RUN', 'm2_retention_delete@invalid.test', 'sender@invalid.test', 'M2_RETENTION_SENTINEL_SUBJECT', 'M2_RETENTION_SENTINEL_BODY', 'm2-retention-message', '51111111-1111-4111-8111-111111111111');

set request.jwt.claim.sub = '81111111-1111-4111-8111-111111111111';
set role authenticated;

insert into public.deletion_batches (
  id, organization_id, reason_code, evidence_class, input_manifest_sha256, requested_by
) values (
  '61111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111',
  'SYNTHETIC_TEST', 'synthetic_demo', repeat('a', 64), '81111111-1111-4111-8111-111111111111'
);

do $$
begin
  begin
    insert into public.deletion_batches (
      organization_id, reason_code, evidence_class, input_manifest_sha256, requested_by
    ) values (
      '11111111-1111-4111-8111-111111111111', 'SYNTHETIC_TEST', 'synthetic_demo', repeat('f', 64),
      '82111111-1111-4111-8111-111111111111'
    );
    raise exception 'EXPECTED_FORGED_REQUESTER_REJECTION';
  exception
    when others then
      if sqlerrm <> 'DELETION_BATCH_REQUESTED_BY_MISMATCH' then raise; end if;
  end;

  begin
    update public.deletion_batches
    set status = 'APPROVED', approved_by = '81111111-1111-4111-8111-111111111111', approved_at = now()
    where id = '61111111-1111-4111-8111-111111111111';
    raise exception 'EXPECTED_FOUR_EYES_REJECTION';
  exception
    when others then
      if sqlerrm <> 'DELETION_BATCH_FOUR_EYES_REQUIRED' then raise; end if;
  end;
end;
$$;

reset role;
reset request.jwt.claim.sub;

set request.jwt.claim.sub = '82111111-1111-4111-8111-111111111111';
set role authenticated;

do $$
begin
  begin
    update public.deletion_batches
    set status = 'IN_PROGRESS', started_at = now()
    where id = '61111111-1111-4111-8111-111111111111';
    raise exception 'EXPECTED_TECHNICAL_TRANSITION_REJECTION';
  exception
    when others then
      if sqlerrm <> 'DELETION_BATCH_TECHNICAL_TRANSITION_REQUIRES_SERVICE_ROLE' then raise; end if;
  end;
end;
$$;

reset role;
reset request.jwt.claim.sub;

set request.jwt.claim.sub = '82111111-1111-4111-8111-111111111111';
set role authenticated;
update public.deletion_batches
set status = 'APPROVED', approved_by = '82111111-1111-4111-8111-111111111111', approved_at = now()
where id = '61111111-1111-4111-8111-111111111111';
reset role;
reset request.jwt.claim.sub;

set request.jwt.claim.sub = '85121212-1212-4212-8212-121212121212';
set role authenticated;
insert into public.deletion_batches (
  id, organization_id, reason_code, evidence_class, input_manifest_sha256, requested_by
) values (
  '62121212-1212-4212-8212-121212121212', '12121212-1212-4212-8212-121212121212',
  'SYNTHETIC_TEST', 'synthetic_demo', repeat('b', 64), '85121212-1212-4212-8212-121212121212'
);
reset role;
reset request.jwt.claim.sub;

set request.jwt.claim.sub = '86121212-1212-4212-8212-121212121212';
set role authenticated;
update public.deletion_batches
set status = 'APPROVED', approved_by = '86121212-1212-4212-8212-121212121212', approved_at = now()
where id = '62121212-1212-4212-8212-121212121212';
reset role;
reset request.jwt.claim.sub;

set request.jwt.claim.sub = '82111111-1111-4111-8111-111111111111';
set role authenticated;

do $$
begin
  begin
    insert into public.legal_holds (
      organization_id, subject_id, reason_code, evidence_sha256, created_by
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '33121212-1212-4212-8212-121212121212',
      'LEGAL', repeat('c', 64), '82111111-1111-4111-8111-111111111111'
    );
    raise exception 'EXPECTED_CROSS_TENANT_HOLD_REJECTION';
  exception
    when foreign_key_violation then null;
  end;
end;
$$;

do $$
begin
  begin
    insert into public.legal_holds (
      organization_id, subject_id, reason_code, evidence_sha256, created_by
    ) values (
      '11111111-1111-4111-8111-111111111111', '31111111-1111-4111-8111-111111111111',
      'LEGAL', repeat('d', 64), '81111111-1111-4111-8111-111111111111'
    );
    raise exception 'EXPECTED_FORGED_HOLD_ACTOR_REJECTION';
  exception
    when others then
      if sqlerrm <> 'LEGAL_HOLD_CREATED_BY_MISMATCH' then raise; end if;
  end;
end;
$$;

reset role;
reset request.jwt.claim.sub;

set request.jwt.claim.sub = '83111111-1111-4111-8111-111111111111';
set role authenticated;

do $$
begin
  begin
    insert into public.legal_holds (
      organization_id, subject_id, reason_code, evidence_sha256, created_by
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '31111111-1111-4111-8111-111111111111',
      'LEGAL', repeat('d', 64), '83111111-1111-4111-8111-111111111111'
    );
    raise exception 'EXPECTED_OPERATOR_HOLD_MUTATION_REJECTION';
  exception
    when insufficient_privilege then null;
  end;

  if exists (select 1 from public.legal_holds) then raise exception 'OPERATOR_READ_LEGAL_HOLD'; end if;
  if exists (select 1 from public.deletion_batches) then raise exception 'OPERATOR_READ_DELETION_BATCH'; end if;
  if (select count(*) from public.organization_users) <> 1 then raise exception 'OPERATOR_ENUMERATED_ORGANIZATION_USERS'; end if;

  begin
    perform app.execute_contact_deletion(gen_random_uuid());
    raise exception 'EXPECTED_SERVICE_FUNCTION_EXECUTE_REJECTION';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;
reset request.jwt.claim.sub;

set role service_role;

select app.create_contact_deletion_item(
  '61111111-1111-4111-8111-111111111111',
  '31111111-1111-4111-8111-111111111111',
  now() - interval '1 day'
) as held_item_id \gset

select app.create_contact_deletion_item(
  '61111111-1111-4111-8111-111111111111',
  '32111111-1111-4111-8111-111111111111',
  now() - interval '1 day'
) as delete_item_id \gset

select app.assess_contact_deletion(:'held_item_id'::uuid) as held_initial_status \gset
select app.assess_contact_deletion(:'delete_item_id'::uuid) as delete_initial_status \gset

select case
  when :'held_initial_status' = 'ELIGIBLE' and :'delete_initial_status' = 'ELIGIBLE' then true
  else null::boolean
end as synthetic_eligibility_must_be_true \gset
\if :synthetic_eligibility_must_be_true
\else
  \quit 1
\endif

reset role;

set request.jwt.claim.sub = '82111111-1111-4111-8111-111111111111';
set role authenticated;

insert into public.legal_holds (
  id, organization_id, subject_id, reason_code, evidence_sha256, created_by
) values (
  '71111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '31111111-1111-4111-8111-111111111111',
  'LEGAL', repeat('e', 64), '82111111-1111-4111-8111-111111111111'
);

reset role;
reset request.jwt.claim.sub;

set role service_role;

select app.execute_contact_deletion(:'held_item_id'::uuid) as held_execution_result \gset
select app.execute_contact_deletion(:'delete_item_id'::uuid) as delete_execution_result \gset

reset role;

select case when :'held_execution_result' = 'f' then true else null::boolean end as hold_must_block \gset
\if :hold_must_block
\else
  \quit 1
\endif
select case when :'delete_execution_result' = 't' then true else null::boolean end as eligible_must_execute \gset
\if :eligible_must_execute
\else
  \quit 1
\endif

create temp table retention_gate_ids (
  held_item_id uuid not null,
  delete_item_id uuid not null
);
insert into retention_gate_ids values (:'held_item_id'::uuid, :'delete_item_id'::uuid);

do $$
declare
  tombstone_text text;
  expected_subject_hash text;
  gate_ids retention_gate_ids%rowtype;
begin
  select * into gate_ids from retention_gate_ids;

  if (select status from public.deletion_items where id = gate_ids.held_item_id) <> 'BLOCKED_HOLD' then
    raise exception 'HELD_ITEM_STATUS_INVALID';
  end if;
  if (select status from public.deletion_items where id = gate_ids.delete_item_id) <> 'EXECUTED' then
    raise exception 'EXECUTED_ITEM_STATUS_INVALID';
  end if;

  if (select is_deleted from public.contacts where id = '31111111-1111-4111-8111-111111111111') then
    raise exception 'HELD_CONTACT_WAS_DELETED';
  end if;
  if not (select is_deleted from public.contacts where id = '32111111-1111-4111-8111-111111111111') then
    raise exception 'ELIGIBLE_CONTACT_NOT_ANONYMIZED';
  end if;

  if exists (
    select 1 from public.contacts
    where id = '32111111-1111-4111-8111-111111111111'
      and (
        full_name <> 'Deleted subject'
        or phone_e164 is not null
        or normalized_email like '%m2_retention_delete%'
        or verified
      )
  ) then raise exception 'CONTACT_ANONYMIZATION_INCOMPLETE'; end if;

  if exists (
    select 1 from public.messages
    where contact_id = '32111111-1111-4111-8111-111111111111'
      and num_nonnulls(normalized_to, normalized_from, subject, body_text, provider_message_id) > 0
  ) then raise exception 'MESSAGE_CONTENT_NOT_ERASED'; end if;

  if exists (
    select 1 from public.prequotes
    where id = '35111111-1111-4111-8111-111111111111'
      and (
        contact_name <> 'Deleted subject'
        or contact_role <> 'Deleted'
        or normalized_email like '%m2_retention_delete%'
        or phone_e164 is not null
      )
  ) then raise exception 'PREQUOTE_PII_NOT_ERASED'; end if;

  if exists (
    select 1 from public.leads
    where id = '37111111-1111-4111-8111-111111111111' and qualification_reason is not null
  ) then raise exception 'LEAD_FREE_TEXT_NOT_ERASED'; end if;
  if exists (
    select 1 from public.opportunities
    where id = '38111111-1111-4111-8111-111111111111'
      and (next_action is not null or loss_reason is not null)
  ) then raise exception 'OPPORTUNITY_FREE_TEXT_NOT_ERASED'; end if;
  if exists (
    select 1 from public.meetings
    where opportunity_id = '38111111-1111-4111-8111-111111111111' and outcome_notes is not null
  ) then raise exception 'MEETING_FREE_TEXT_NOT_ERASED'; end if;
  if exists (
    select 1 from public.source_evidence
    where organization_id = '11111111-1111-4111-8111-111111111111'
      and subject_id = '32111111-1111-4111-8111-111111111111'
  ) then raise exception 'CONTACT_EVIDENCE_NOT_ERASED'; end if;
  if exists (
    select 1 from public.tasks
    where organization_id = '11111111-1111-4111-8111-111111111111'
      and contact_id = '32111111-1111-4111-8111-111111111111'
  ) then raise exception 'CONTACT_TASK_NOT_ERASED'; end if;
  if exists (
    select 1 from public.prequote_documents
    where prequote_id = '35111111-1111-4111-8111-111111111111'
  ) then raise exception 'PREQUOTE_DOCUMENT_METADATA_NOT_ERASED'; end if;
  if exists (
    select 1 from storage.objects
    where name like '%/prequotes/35111111-1111-4111-8111-111111111111/%'
  ) then raise exception 'PREQUOTE_STORAGE_OBJECT_NOT_ERASED'; end if;

  select to_jsonb(dt)::text into tombstone_text
  from public.deletion_tombstones dt
  where dt.deletion_item_id = gate_ids.delete_item_id;
  if tombstone_text is null then raise exception 'TOMBSTONE_MISSING'; end if;
  if tombstone_text like '%m2_retention_%' or tombstone_text like '%M2_RETENTION_%' then
    raise exception 'TOMBSTONE_CONTAINS_RAW_PII';
  end if;
  if not exists (
    select 1 from public.deletion_tombstones
    where deletion_item_id = gate_ids.delete_item_id
      and restore_semantics = 'NO_RAW_DATA_RESTORE_FROM_TOMBSTONE'
      and restoration_status = 'NOT_POSSIBLE'
  ) then raise exception 'RESTORE_SEMANTICS_NOT_RECORDED'; end if;

  expected_subject_hash := encode(
    digest(
      '11111111-1111-4111-8111-111111111111:CONTACT:32111111-1111-4111-8111-111111111111',
      'sha256'
    ),
    'hex'
  );
  if (select subject_hash from public.deletion_items where id = gate_ids.delete_item_id) <> expected_subject_hash then
    raise exception 'SUBJECT_HASH_NOT_OPAQUE_IDENTIFIER_DERIVED';
  end if;
  if (select subject_hash from public.deletion_items where id = gate_ids.delete_item_id) = encode(
    digest('11111111-1111-4111-8111-111111111111:m2_retention_delete@invalid.test', 'sha256'), 'hex'
  ) then raise exception 'SUBJECT_HASH_EMAIL_DERIVED'; end if;

  if exists (
    select 1
    from public.audit_log al
    cross join lateral (values (coalesce(al.old_data::text, '')), (coalesce(al.new_data::text, ''))) snapshots(value)
    where snapshots.value like '%m2_retention_%'
       or snapshots.value like '%M2_RETENTION_%'
       or snapshots.value like '%M2 Sentinel%'
  ) then raise exception 'RETENTION_AUDIT_CONTAINS_PII'; end if;

  if not exists (
    select 1 from public.audit_log
    where record_type = 'deletion_tombstones'
      and new_data ? 'subject_hash'
      and new_data ->> 'restore_semantics' = 'NO_RAW_DATA_RESTORE_FROM_TOMBSTONE'
  ) then raise exception 'TOMBSTONE_AUDIT_ALLOWLIST_MISSING'; end if;
end;
$$;

set request.jwt.claim.sub = '81111111-1111-4111-8111-111111111111';
set role authenticated;

do $$
begin
  begin
    update public.legal_holds
    set status = 'RELEASED',
        released_by = '82111111-1111-4111-8111-111111111111',
        released_at = now()
    where id = '71111111-1111-4111-8111-111111111111';
    raise exception 'EXPECTED_FORGED_HOLD_RELEASE_REJECTION';
  exception
    when others then
      if sqlerrm <> 'LEGAL_HOLD_RELEASED_BY_MISMATCH' then raise; end if;
  end;
end;
$$;

reset role;
reset request.jwt.claim.sub;

set request.jwt.claim.sub = '82111111-1111-4111-8111-111111111111';
set role authenticated;

update public.legal_holds
set status = 'RELEASED',
    released_by = '82111111-1111-4111-8111-111111111111',
    released_at = now()
where id = '71111111-1111-4111-8111-111111111111';

do $$
begin
  if (select count(*) from public.organization_users) <> 4 then raise exception 'ADMIN_CANNOT_ENUMERATE_OWN_ORGANIZATION_USERS'; end if;
end;
$$;

reset role;
reset request.jwt.claim.sub;

set request.jwt.claim.sub = '84111111-1111-4111-8111-111111111111';
set role authenticated;

do $$
begin
  if (select count(*) from public.deletion_items) <> 2 then raise exception 'AUDITOR_READ_SCOPE_INVALID'; end if;
  begin
    update public.deletion_items set status = 'FAILED', failure_code = 'FORGED';
    raise exception 'EXPECTED_AUDITOR_MUTATION_REJECTION';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;
reset request.jwt.claim.sub;

\echo 'RETENTION_DELETION_GATE_PASS'
