\set ON_ERROR_STOP on

BEGIN;

INSERT INTO organizations (id, slug, name, created_at) VALUES
  ('00000000-0000-4000-8000-000000000001', 'ennco-synthetic-m2', 'ENNCO SYNTHETIC M2', '2026-08-12T00:00:00Z');

INSERT INTO companies (id, organization_id, legal_name, company_key, commercial_state, created_at) VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'SYNTHETIC INDUSTRIAL ALPHA',
    'SYNTHETICINDUSTRIALALPHA',
    'PROSPECTING',
    '2026-08-12T00:01:00Z'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    'SYNTHETIC INDUSTRIAL BLOCKED',
    'SYNTHETICINDUSTRIALBLOCKED',
    'RESEARCH_SEED',
    '2026-08-12T00:02:00Z'
  );

INSERT INTO suppression_entries (
  id,
  organization_id,
  company_id,
  normalized_email,
  normalized_company_key,
  reason,
  source,
  created_at
) VALUES (
  '20000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  'blocked@example.invalid',
  'SYNTHETICINDUSTRIALBLOCKED',
  'SYNTHETIC_ANNEX_A_MATCH',
  'M2_FIXTURE',
  '2026-08-12T00:03:00Z'
);

INSERT INTO messages (
  id,
  organization_id,
  company_id,
  idempotency_key,
  recipient_email,
  subject,
  body_text,
  dry_run,
  created_at
) VALUES
  (
    '30000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'm2-dry-run-alpha-001',
    'plant.manager@example.invalid',
    'SYNTHETIC DRY RUN',
    'Synthetic fixture. No external delivery.',
    true,
    '2026-08-12T00:04:00Z'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'm2-suppressed-blocked-001',
    'blocked@example.invalid',
    'SYNTHETIC SUPPRESSION PROOF',
    'Synthetic suppressed fixture. No external delivery.',
    true,
    '2026-08-12T00:05:00Z'
  );

INSERT INTO replies (
  id,
  organization_id,
  company_id,
  message_id,
  external_event_id,
  reply_class,
  received_at
) VALUES (
  '40000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'm2-synthetic-reply-event-001',
  'POSITIVE',
  '2026-08-12T00:06:00Z'
);

INSERT INTO leads (
  id,
  organization_id,
  company_id,
  reply_id,
  qualification_status,
  project_capacity_kwp,
  annex_a_match,
  contact_role_verified,
  explicit_interest,
  monthly_spend_mxn,
  evidence_reference,
  next_action,
  next_action_due_at,
  created_at
) VALUES (
  '50000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'QUALIFIED',
  150.000,
  false,
  true,
  true,
  250000.00,
  'SYNTHETIC_EVIDENCE_M2_ONLY',
  'SYNTHETIC TECHNICAL REVIEW',
  '2026-08-13T16:00:00Z',
  '2026-08-12T00:07:00Z'
);

INSERT INTO outbox_events (
  id,
  organization_id,
  aggregate_type,
  aggregate_id,
  event_type,
  payload,
  idempotency_key,
  status,
  attempts,
  available_at,
  created_at
) VALUES (
  '60000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'lead',
  '50000000-0000-4000-8000-000000000001',
  'lead.qualified.synthetic',
  '{"synthetic":true,"delivery":"disabled"}'::jsonb,
  'm2-outbox-lead-qualified-001',
  'PENDING',
  0,
  '2026-08-12T00:08:00Z',
  '2026-08-12T00:08:00Z'
);

INSERT INTO object_records (
  id,
  organization_id,
  object_key,
  sha256,
  size_bytes,
  content_class,
  created_at
) VALUES
  (
    '70000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'prequotes/PQ-M2-001.json',
    :'object_prequote_sha',
    :object_prequote_size,
    'SYNTHETIC_PREQUOTE',
    '2026-08-12T00:09:00Z'
  ),
  (
    '70000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    'receipts/REC-M2-001.txt',
    :'object_receipt_sha',
    :object_receipt_size,
    'SYNTHETIC_RECEIPT',
    '2026-08-12T00:10:00Z'
  );

INSERT INTO audit_log (
  id,
  organization_id,
  actor_type,
  event_type,
  aggregate_type,
  aggregate_id,
  correlation_id,
  evidence,
  created_at
) VALUES
  (
    '80000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'SYSTEM_SYNTHETIC',
    'message.dry_run.created',
    'message',
    '30000000-0000-4000-8000-000000000001',
    'm2-correlation-001',
    '{"synthetic":true,"external_mutation":false}'::jsonb,
    '2026-08-12T00:04:00Z'
  ),
  (
    '80000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    'SYSTEM_SYNTHETIC',
    'lead.qualified',
    'lead',
    '50000000-0000-4000-8000-000000000001',
    'm2-correlation-001',
    '{"synthetic":true,"strict_contract_fields":true}'::jsonb,
    '2026-08-12T00:07:00Z'
  );

COMMIT;
