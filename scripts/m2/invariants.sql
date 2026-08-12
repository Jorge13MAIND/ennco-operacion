\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

SELECT 'single_synthetic_organization',
       count(*) = 1 AND bool_and(slug = 'ennco-synthetic-m2'),
       'organizations=' || count(*)
FROM organizations;

SELECT 'tenant_key_present',
       (
         SELECT bool_and(organization_id IS NOT NULL) FROM companies
       ) AND (
         SELECT bool_and(organization_id IS NOT NULL) FROM suppression_entries
       ) AND (
         SELECT bool_and(organization_id IS NOT NULL) FROM messages
       ) AND (
         SELECT bool_and(organization_id IS NOT NULL) FROM replies
       ) AND (
         SELECT bool_and(organization_id IS NOT NULL) FROM leads
       ) AND (
         SELECT bool_and(organization_id IS NOT NULL) FROM outbox_events
       ) AND (
         SELECT bool_and(organization_id IS NOT NULL) FROM object_records
       ) AND (
         SELECT bool_and(organization_id IS NOT NULL) FROM audit_log
       ),
       'organization_id required in every operational fixture table';

SELECT 'synthetic_addresses_only',
       bool_and(recipient_email LIKE '%@example.invalid'),
       'messages=' || count(*)
FROM messages;

SELECT 'no_external_sends',
       bool_and(dry_run = true AND provider_message_id IS NULL AND sent_at IS NULL),
       'messages=' || count(*)
FROM messages;

SELECT 'suppression_fixture_present',
       count(*) = 1 AND bool_and(normalized_email = 'blocked@example.invalid'),
       'suppression_entries=' || count(*)
FROM suppression_entries;

SELECT 'strict_qualified_lead',
       count(*) = 1
       AND bool_and(project_capacity_kwp > 100)
       AND bool_and(annex_a_match = false)
       AND bool_and(contact_role_verified = true)
       AND bool_and(explicit_interest = true)
       AND bool_and(monthly_spend_mxn > 20000)
       AND bool_and(evidence_reference IS NOT NULL)
       AND bool_and(next_action IS NOT NULL)
       AND bool_and(next_action_due_at IS NOT NULL),
       'qualified_leads=' || count(*)
FROM leads
WHERE qualification_status = 'QUALIFIED';

SELECT 'outbox_not_delivered',
       count(*) = 1 AND bool_and(status = 'PENDING' AND attempts = 0),
       'outbox_events=' || count(*)
FROM outbox_events;

SELECT 'idempotency_unique',
       (SELECT count(*) = count(DISTINCT idempotency_key) FROM messages)
       AND (SELECT count(*) = count(DISTINCT idempotency_key) FROM outbox_events),
       'message_and_outbox_keys_unique';

SELECT 'object_manifest_shape',
       count(*) = 2
       AND bool_and(length(sha256) = 64)
       AND bool_and(size_bytes > 0),
       'object_records=' || count(*)
FROM object_records;

SELECT 'audit_evidence_synthetic',
       count(*) = 2 AND bool_and(evidence @> '{"synthetic":true}'::jsonb),
       'audit_events=' || count(*)
FROM audit_log;
