import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const timestampSchema = z.iso.datetime({ offset: true });
const nullableTimestampSchema = timestampSchema.nullable();
const normalizedDomainSchema = z.string().trim().toLowerCase().regex(
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u,
);
const normalizedEmailSchema = z.email().transform((value) => value.trim().toLowerCase());

const accountSchema = z.object({
  provider_code: z.literal("APOLLO"),
  environment: z.literal("PRODUCTION"),
  ownership_status: z.enum(["UNKNOWN", "ENNCO_OWNED", "TECKEL_OWNED", "THIRD_PARTY"]),
  terms_status: z.enum(["UNKNOWN", "VERIFIED", "BLOCKED"]),
  plan_name: z.string().trim().min(1).max(120),
  legal_owner: z.enum(["UNKNOWN", "ENNCO", "TECKEL", "THIRD_PARTY"]),
  custody_model: z.enum(["UNKNOWN", "TECKEL_MANAGED_FOR_ENNCO"]),
  workspace_mode: z.enum(["UNKNOWN", "ENNCO_DEDICATED"]),
  sender_identity: z.enum(["UNKNOWN", "FRANCISCO_CUELLAR"]),
  terms_risk: z.enum(["UNKNOWN", "ACCEPTED_BY_TECKEL", "BLOCKED"]),
  legacy_teckel_assets: z.enum(["UNKNOWN", "ARCHIVED", "ACTIVE"]),
  legacy_contact_count: z.number().int().min(0).max(1_000_000),
  legacy_sequence_count: z.number().int().min(0).max(100_000),
  active_sequence_count: z.number().int().min(0).max(100_000),
  teckel_mailbox_active_count: z.number().int().min(0).max(100),
  primary_mailbox_connected: z.boolean(),
  primary_mailbox_ref_sha256: sha256Schema.nullable(),
  team_ref_sha256: sha256Schema.nullable(),
  admin_email_sha256: sha256Schema.nullable(),
  seat_count: z.number().int().min(0).max(100),
  billing_frequency: z.enum(["UNKNOWN", "FREE", "MONTHLY", "ANNUAL", "USAGE"]),
  external_account_ref_sha256: sha256Schema.nullable(),
  mfa_status: z.enum(["UNKNOWN", "ENABLED", "DISABLED"]),
  recovery_status: z.enum(["UNKNOWN", "VERIFIED", "INCOMPLETE"]),
  monthly_budget_mxn: z.number().min(0).max(1_000_000),
  hard_cap_mxn: z.number().min(0).max(1_000_000),
  evidence_sha256: sha256Schema,
  renewal_at: nullableTimestampSchema,
  delivery_status: z.enum(["BLOCKED", "READY", "SUSPENDED", "CANCELLED"]),
  last_audited_at: nullableTimestampSchema,
  verified_at: nullableTimestampSchema,
  active: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.hard_cap_mxn < value.monthly_budget_mxn) {
    context.addIssue({ code: "custom", message: "PROVIDER_HARD_CAP_UNDER_BUDGET" });
  }
  if (value.active && (
    value.ownership_status !== "TECKEL_OWNED"
    || value.terms_status !== "VERIFIED"
    || value.legal_owner !== "TECKEL"
    || value.custody_model !== "TECKEL_MANAGED_FOR_ENNCO"
    || value.workspace_mode !== "ENNCO_DEDICATED"
    || value.sender_identity !== "FRANCISCO_CUELLAR"
    || value.terms_risk !== "ACCEPTED_BY_TECKEL"
    || value.legacy_teckel_assets !== "ARCHIVED"
    || value.active_sequence_count !== 0
    || value.teckel_mailbox_active_count !== 0
    || !value.primary_mailbox_connected
    || value.primary_mailbox_ref_sha256 === null
    || value.team_ref_sha256 === null
    || value.admin_email_sha256 === null
    || value.seat_count !== 1
    || !["MONTHLY", "ANNUAL"].includes(value.billing_frequency)
    || value.external_account_ref_sha256 === null
    || value.mfa_status !== "ENABLED"
    || value.recovery_status !== "VERIFIED"
    || value.verified_at === null
  )) {
    context.addIssue({ code: "custom", message: "ACTIVE_APOLLO_ACCOUNT_CONTRADICTION" });
  }
});

const budgetSchema = z.object({
  cycle_start: z.iso.date(),
  cycle_end: z.iso.date(),
  credit_limit: z.number().int().min(0).max(1_000_000),
  credits_consumed: z.number().int().min(0).max(1_000_000),
  research_credit_cap: z.number().int().min(0).max(300),
  infrastructure_credit_spend: z.number().int().min(0).max(3_600),
  minimum_credit_buffer: z.literal(110),
  phone_enrichment_allowed: z.literal(false),
  status: z.enum(["ACTIVE", "EXHAUSTED", "BLOCKED", "CLOSED"]),
  evidence_sha256: sha256Schema,
  observed_at: timestampSchema,
}).strict().superRefine((value, context) => {
  if (value.cycle_end <= value.cycle_start) {
    context.addIssue({ code: "custom", message: "PROVIDER_BUDGET_CYCLE_INVALID" });
  }
  if (value.credits_consumed > value.credit_limit || value.research_credit_cap > value.credit_limit) {
    context.addIssue({ code: "custom", message: "PROVIDER_BUDGET_CAP_CONTRADICTION" });
  }
  if (value.credit_limit - value.credits_consumed < value.minimum_credit_buffer) {
    context.addIssue({ code: "custom", message: "PROVIDER_CREDIT_BUFFER_UNDER_MINIMUM" });
  }
  if (value.infrastructure_credit_spend + value.research_credit_cap + value.minimum_credit_buffer > value.credit_limit) {
    context.addIssue({ code: "custom", message: "PROVIDER_CREDIT_ALLOCATION_EXCEEDS_LIMIT" });
  }
});

const domainSchema = z.object({
  normalized_domain: normalizedDomainSchema,
  asset_source: z.literal("APOLLO_GENERATED"),
  ownership_status: z.enum(["UNKNOWN", "ENNCO_OWNED", "TECKEL_OWNED", "THIRD_PARTY"]),
  lifecycle_status: z.enum(["CANDIDATE", "REGISTERED", "DNS_CONFIGURED", "AUTHENTICATED", "WARMING", "READY", "QUARANTINED"]),
  auth_spf: z.boolean(),
  auth_dkim: z.boolean(),
  auth_dmarc: z.boolean(),
  auth_tls: z.boolean(),
  postmaster_verified: z.boolean(),
  reputation_status: z.enum(["UNKNOWN", "HEALTHY", "DEGRADED", "BLOCKED"]),
  registered_at: nullableTimestampSchema,
  expires_at: nullableTimestampSchema,
  evidence_sha256: sha256Schema,
  verified_at: nullableTimestampSchema,
}).strict();

const mailboxSchema = z.object({
  normalized_email: normalizedEmailSchema,
  domain: normalizedDomainSchema,
  domain_ready_at: nullableTimestampSchema,
  auth_spf: z.boolean(),
  auth_dkim: z.boolean(),
  auth_dmarc: z.boolean(),
  auth_tls: z.boolean(),
  health_status: z.enum(["UNKNOWN", "HEALTHY", "DEGRADED", "SUSPENDED"]),
  kill_switch: z.boolean(),
  provider_external_ref_sha256: sha256Schema.nullable(),
  ownership_status: z.enum(["UNKNOWN", "ENNCO_OWNED", "TECKEL_OWNED", "THIRD_PARTY"]),
  credential_status: z.enum(["UNKNOWN", "OAUTH_CONNECTED", "ERROR", "REVOKED"]),
  warmup_started_at: nullableTimestampSchema,
  warmup_status: z.enum(["NOT_STARTED", "WARMING", "HEALTHY", "DEGRADED", "BLOCKED"]),
  sender_identity_verified: z.boolean(),
  gmail_seed_verified: z.boolean(),
  outlook_seed_verified: z.boolean(),
  yahoo_seed_verified: z.boolean(),
  reply_sync_verified: z.boolean(),
  list_unsubscribe_verified: z.boolean(),
  one_click_unsubscribe_verified: z.boolean(),
  provider_evidence_sha256: sha256Schema,
  provider_daily_limit: z.number().int().min(0).max(20),
  last_provider_health_at: nullableTimestampSchema,
}).strict().superRefine((value, context) => {
  if (value.normalized_email.split("@").at(1) !== value.domain) {
    context.addIssue({ code: "custom", message: "PROVIDER_MAILBOX_DOMAIN_DRIFT" });
  }
  if (!value.kill_switch && value.warmup_status !== "HEALTHY") {
    context.addIssue({ code: "custom", message: "PROVIDER_MAILBOX_KILL_SWITCH_CONTRADICTION" });
  }
});

export const providerActivationGateCodes = [
  "CONTRACT_ARCHIVED", "PRIVACY_APPROVED", "APOLLO_TERMS_ACCEPTED", "APOLLO_TECKEL_MANAGED_ACCEPTED",
  "MFA_RECOVERY", "BUDGET_APPROVED", "GOOGLE_CLOUD_READY", "RESEND_READY", "SENTRY_READY",
  "CHECKLY_READY", "OPERATOR_PRIMARY", "OPERATOR_COVERAGE", "ANEXO_A_BOUND", "COPY_APPROVED", "PILOT_APPROVED",
] as const;

const gateSchema = z.object({
  gate_code: z.enum(providerActivationGateCodes),
  status: z.enum(["UNKNOWN", "PASS", "FAIL"]),
  evidence_sha256: sha256Schema,
  evidence_class: z.enum(["synthetic_demo", "live"]),
  recorded_at: timestampSchema,
  expires_at: nullableTimestampSchema,
}).strict();

export const outboundProviderSnapshotSchema = z.object({
  account: accountSchema,
  budget: budgetSchema,
  domains: z.array(domainSchema).max(2),
  mailboxes: z.array(mailboxSchema).max(3),
  gates: z.array(gateSchema).max(15),
}).strict().superRefine((value, context) => {
  const unique = (items: string[]) => new Set(items).size === items.length;
  if (!unique(value.domains.map((domain) => domain.normalized_domain))) {
    context.addIssue({ code: "custom", message: "PROVIDER_DOMAIN_DUPLICATE" });
  }
  if (!unique(value.mailboxes.map((mailbox) => mailbox.normalized_email))) {
    context.addIssue({ code: "custom", message: "PROVIDER_MAILBOX_DUPLICATE" });
  }
  if (!unique(value.gates.map((gate) => gate.gate_code))) {
    context.addIssue({ code: "custom", message: "PROVIDER_GATE_DUPLICATE" });
  }
  const domains = new Set(value.domains.map((domain) => domain.normalized_domain));
  if (value.mailboxes.some((mailbox) => !domains.has(mailbox.domain))) {
    context.addIssue({ code: "custom", message: "PROVIDER_MAILBOX_DOMAIN_NOT_IN_SNAPSHOT" });
  }
});

export type OutboundProviderSnapshot = z.infer<typeof outboundProviderSnapshotSchema>;

export const outboundProviderSnapshotResultSchema = z.object({
  status: z.enum(["CREATED", "UPDATED", "DUPLICATE"]),
  provider_account_id: z.uuid(),
  request_sha256: sha256Schema,
  domains_recorded: z.number().int().min(0).max(2).optional(),
  mailboxes_recorded: z.number().int().min(0).max(3).optional(),
  gates_recorded: z.number().int().min(0).max(15).optional(),
  readiness: z.unknown(),
}).passthrough();
