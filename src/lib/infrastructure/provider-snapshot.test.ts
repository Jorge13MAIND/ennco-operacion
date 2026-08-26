import { describe, expect, it } from "vitest";
import { outboundProviderSnapshotSchema } from "@/lib/infrastructure/provider-snapshot";

const snapshot = {
  account: {
    provider_code: "APOLLO",
    environment: "PRODUCTION",
    ownership_status: "UNKNOWN",
    terms_status: "UNKNOWN",
    plan_name: "Professional",
    legal_owner: "UNKNOWN",
    custody_model: "UNKNOWN",
    workspace_mode: "UNKNOWN",
    sender_identity: "UNKNOWN",
    terms_risk: "UNKNOWN",
    legacy_teckel_assets: "UNKNOWN",
    legacy_contact_count: 192,
    legacy_sequence_count: 13,
    active_sequence_count: 1,
    teckel_mailbox_active_count: 2,
    primary_mailbox_connected: false,
    primary_mailbox_ref_sha256: null,
    team_ref_sha256: null,
    admin_email_sha256: null,
    seat_count: 1,
    billing_frequency: "MONTHLY",
    external_account_ref_sha256: null,
    mfa_status: "UNKNOWN",
    recovery_status: "UNKNOWN",
    monthly_budget_mxn: 1782,
    hard_cap_mxn: 1782,
    evidence_sha256: "a".repeat(64),
    renewal_at: null,
    delivery_status: "BLOCKED",
    last_audited_at: null,
    verified_at: null,
    active: false,
  },
  budget: {
    cycle_start: "2026-08-01",
    cycle_end: "2026-09-01",
    credit_limit: 4_010,
    credits_consumed: 0,
    research_credit_cap: 300,
    infrastructure_credit_spend: 3_600,
    minimum_credit_buffer: 110,
    phone_enrichment_allowed: false,
    status: "BLOCKED",
    evidence_sha256: "b".repeat(64),
    observed_at: "2026-08-20T18:00:00.000Z",
  },
  domains: [],
  mailboxes: [],
  gates: [{
    gate_code: "OPERATOR_COVERAGE",
    status: "PASS",
    evidence_sha256: "c".repeat(64),
    evidence_class: "live",
    recorded_at: "2026-08-20T18:00:00.000Z",
    expires_at: null,
  }],
};

describe("outbound provider snapshot contract", () => {
  it("accepts a fail-closed dedicated-workspace draft with single Teckel operator coverage", () => {
    expect(outboundProviderSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("rejects the obsolete backup gate and credit or infrastructure drift", () => {
    expect(outboundProviderSnapshotSchema.safeParse({
      ...snapshot,
      gates: [{ ...snapshot.gates[0], gate_code: "OPERATOR_BACKUP" }],
    }).success).toBe(false);
    expect(outboundProviderSnapshotSchema.safeParse({
      ...snapshot,
      budget: { ...snapshot.budget, research_credit_cap: 301 },
    }).success).toBe(false);
    expect(outboundProviderSnapshotSchema.safeParse({
      ...snapshot,
      budget: { ...snapshot.budget, infrastructure_credit_spend: 3_601 },
    }).success).toBe(false);
  });

  it("rejects false active account evidence and mailbox-domain drift", () => {
    expect(outboundProviderSnapshotSchema.safeParse({
      ...snapshot,
      account: { ...snapshot.account, active: true },
    }).success).toBe(false);
    expect(outboundProviderSnapshotSchema.safeParse({
      ...snapshot,
      domains: [{
        normalized_domain: "enncoindustrial.test",
        asset_source: "APOLLO_GENERATED",
        ownership_status: "TECKEL_OWNED",
        lifecycle_status: "REGISTERED",
        auth_spf: false,
        auth_dkim: false,
        auth_dmarc: false,
        auth_tls: false,
        postmaster_verified: false,
        reputation_status: "UNKNOWN",
        registered_at: "2026-08-20T18:00:00.000Z",
        expires_at: null,
        evidence_sha256: "d".repeat(64),
        verified_at: null,
      }],
      mailboxes: [{
        normalized_email: "francisco@other.test",
        domain: "other.test",
        domain_ready_at: null,
        auth_spf: false,
        auth_dkim: false,
        auth_dmarc: false,
        auth_tls: false,
        health_status: "UNKNOWN",
        kill_switch: true,
        provider_external_ref_sha256: null,
        ownership_status: "UNKNOWN",
        credential_status: "UNKNOWN",
        warmup_started_at: null,
        warmup_status: "NOT_STARTED",
        sender_identity_verified: false,
        gmail_seed_verified: false,
        outlook_seed_verified: false,
        yahoo_seed_verified: false,
        reply_sync_verified: false,
        list_unsubscribe_verified: false,
        one_click_unsubscribe_verified: false,
        provider_evidence_sha256: "e".repeat(64),
        provider_daily_limit: 0,
        last_provider_health_at: null,
      }],
    }).success).toBe(false);
  });
});
