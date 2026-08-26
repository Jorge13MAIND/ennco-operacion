import { describe, expect, it } from "vitest";
import {
  createUnknownOutboundProviderReadiness,
  isOutboundProviderReleaseAllowed,
  parseOutboundProviderReadiness,
} from "@/lib/infrastructure/provider";

const organizationId = "24000000-0000-4000-8000-000000000001";
const evaluatedAt = "2026-10-03T16:00:00.000Z";

function readyFixture() {
  return {
    status: "READ_ONLY",
    state: "READY",
    release_state: "READY_FOR_CANARY",
    organization_id: organizationId,
    evaluated_at: evaluatedAt,
    provider: "Apollo",
    provider_account_id: "24300000-0000-4000-8000-000000000001",
    plan: "Professional",
    ownership: "TECKEL_OWNED",
    custody_model: "TECKEL_MANAGED_FOR_ENNCO",
    workspace_mode: "ENNCO_DEDICATED",
    sender_identity: "FRANCISCO_CUELLAR",
    terms_risk: "ACCEPTED_BY_TECKEL",
    legacy_teckel_assets: "ARCHIVED",
    legacy_contact_count: 192,
    legacy_sequence_count: 13,
    active_sequence_count: 0,
    teckel_mailbox_active_count: 0,
    primary_mailbox_connected: true,
    team_bound: true,
    domains_ready: 2,
    domains_target: 2,
    mailboxes_ready: 3,
    mailboxes_target: 3,
    warmup_days: 44,
    warmup_required_days: 42,
    activation_gates_passed: 15,
    activation_gates_required: 15,
    live_gates_passed: 15,
    credit_limit: 4_010,
    credits_consumed: 0,
    credits_remaining: 4_010,
    research_credit_cap: 300,
    infrastructure_credit_spend: 3_600,
    minimum_credit_buffer: 110,
    blockers: [],
  };
}

describe("outbound provider readiness", () => {
  it("fails closed when the RPC is unavailable", () => {
    const result = parseOutboundProviderReadiness({
      rpcAvailable: false,
      rpcData: null,
      expectedOrganizationId: organizationId,
      evaluatedAt,
    });
    expect(result.state).toBe("UNKNOWN");
    expect(result.release_state).toBe("HOLD");
    expect(result.blockers).toEqual(["PROVIDER_READINESS_RPC_UNAVAILABLE"]);
  });

  it("accepts only the dedicated Teckel-managed ENNCO contract", () => {
    const result = parseOutboundProviderReadiness({
      rpcAvailable: true,
      rpcData: readyFixture(),
      expectedOrganizationId: organizationId,
      evaluatedAt,
    });
    expect(isOutboundProviderReleaseAllowed(result)).toBe(true);
  });

  it.each([
    ["ENNCO ownership drift", { ownership: "ENNCO_OWNED" }],
    ["shared workspace", { workspace_mode: "UNKNOWN" }],
    ["George sender identity", { sender_identity: "UNKNOWN" }],
    ["legacy assets active", { legacy_teckel_assets: "ACTIVE" }],
    ["active legacy sequence", { active_sequence_count: 1 }],
    ["Teckel mailbox active", { teckel_mailbox_active_count: 1 }],
    ["primary mailbox disconnected", { primary_mailbox_connected: false }],
    ["team not bound", { team_bound: false }],
    ["41-day warmup", { warmup_days: 41 }],
    ["synthetic gate gap", { live_gates_passed: 14 }],
    ["credit buffer spent", { credits_consumed: 3_901, credits_remaining: 109 }],
    ["mailbox missing", { mailboxes_ready: 2 }],
  ])("rejects a false ready state: %s", (_name, drift) => {
    const result = parseOutboundProviderReadiness({
      rpcAvailable: true,
      rpcData: { ...readyFixture(), ...drift },
      expectedOrganizationId: organizationId,
      evaluatedAt,
    });
    expect(result.state).toBe("UNKNOWN");
    expect(result.release_state).toBe("HOLD");
  });

  it("rejects tenant and clock drift", () => {
    const tenantDrift = parseOutboundProviderReadiness({
      rpcAvailable: true,
      rpcData: readyFixture(),
      expectedOrganizationId: "24000000-0000-4000-8000-000000000002",
      evaluatedAt,
    });
    const clockDrift = parseOutboundProviderReadiness({
      rpcAvailable: true,
      rpcData: readyFixture(),
      expectedOrganizationId: organizationId,
      evaluatedAt: "2026-10-03T16:01:00.000Z",
    });
    expect(tenantDrift.blockers).toEqual(["PROVIDER_READINESS_ORGANIZATION_DRIFT"]);
    expect(clockDrift.blockers).toEqual(["PROVIDER_READINESS_EVALUATION_DRIFT"]);
  });

  it("keeps the synthetic baseline explicitly unknown", () => {
    const value = createUnknownOutboundProviderReadiness({ evaluatedAt, reasonCode: "SYNTHETIC_DEMO" });
    expect(value.plan).toContain("pendiente");
    expect(isOutboundProviderReleaseAllowed(value)).toBe(false);
  });
});
