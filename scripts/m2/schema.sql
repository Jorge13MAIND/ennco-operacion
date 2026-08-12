\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE organizations (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE companies (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  legal_name text NOT NULL,
  company_key text NOT NULL,
  commercial_state text NOT NULL CHECK (commercial_state IN ('RESEARCH_SEED', 'PROSPECTING')),
  created_at timestamptz NOT NULL,
  UNIQUE (organization_id, company_key)
);

CREATE TABLE suppression_entries (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  company_id uuid REFERENCES companies(id),
  normalized_email text,
  normalized_domain text,
  normalized_company_key text,
  reason text NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK (
    normalized_email IS NOT NULL
    OR normalized_domain IS NOT NULL
    OR normalized_company_key IS NOT NULL
  )
);

CREATE TABLE messages (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  idempotency_key text NOT NULL,
  recipient_email text NOT NULL,
  subject text NOT NULL,
  body_text text NOT NULL,
  dry_run boolean NOT NULL DEFAULT true,
  provider_message_id text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL,
  UNIQUE (organization_id, idempotency_key),
  CHECK (
    (dry_run = true AND provider_message_id IS NULL AND sent_at IS NULL)
    OR dry_run = false
  )
);

CREATE TABLE replies (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  message_id uuid NOT NULL REFERENCES messages(id),
  external_event_id text NOT NULL,
  reply_class text NOT NULL CHECK (reply_class IN ('POSITIVE', 'NEGATIVE', 'AUTOMATIC')),
  received_at timestamptz NOT NULL,
  UNIQUE (organization_id, external_event_id)
);

CREATE TABLE leads (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  reply_id uuid NOT NULL REFERENCES replies(id),
  qualification_status text NOT NULL CHECK (qualification_status IN ('PENDING', 'QUALIFIED', 'DISQUALIFIED')),
  project_capacity_kwp numeric(12,3),
  annex_a_match boolean,
  contact_role_verified boolean,
  explicit_interest boolean,
  monthly_spend_mxn numeric(14,2),
  evidence_reference text,
  next_action text,
  next_action_due_at timestamptz,
  created_at timestamptz NOT NULL,
  CHECK (
    qualification_status <> 'QUALIFIED'
    OR (
      project_capacity_kwp > 100
      AND annex_a_match = false
      AND contact_role_verified = true
      AND explicit_interest = true
      AND monthly_spend_mxn > 20000
      AND evidence_reference IS NOT NULL
      AND next_action IS NOT NULL
      AND next_action_due_at IS NOT NULL
    )
  )
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'DELIVERED', 'DEAD_LETTER')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (organization_id, idempotency_key)
);

CREATE TABLE object_records (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  object_key text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  content_class text NOT NULL CHECK (content_class IN ('SYNTHETIC_PREQUOTE', 'SYNTHETIC_RECEIPT')),
  created_at timestamptz NOT NULL,
  UNIQUE (organization_id, object_key)
);

CREATE TABLE audit_log (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  actor_type text NOT NULL,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  correlation_id text NOT NULL,
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE FUNCTION prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$;

CREATE TRIGGER audit_log_append_only
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

COMMIT;
