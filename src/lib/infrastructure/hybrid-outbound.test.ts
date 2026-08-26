import { describe, expect, it } from "vitest";

import {
  isHybridOutboundReleaseAllowed,
  parseHybridOutboundReadiness,
} from "@/lib/infrastructure/hybrid-outbound";

const evaluatedAt = "2026-08-25T12:00:00-06:00";
const organizationId = "29000000-0000-4000-8000-000000000001";

function readyPayload(delivery?: { valid: number; attempted: number; rate: number | null }) {
  return {
    status: "READ_ONLY",
    state: "READY",
    effective_release: "READY_FOR_CANARY",
    organization_id: organizationId,
    evaluated_at: evaluatedAt,
    primary_mailbox_ready: true,
    isolated_mailboxes_ready: 0,
    isolated_mailboxes_target: 3,
    mailboxes: [{
      status: "READ_ONLY",
      state: "READY",
      effective_release: "READY_FOR_CANARY",
      organization_id: organizationId,
      mailbox_id: "29000000-0000-4000-8000-000000000010",
      normalized_email: "contacto@ennco.com.mx",
      route: "EXISTING_PRIMARY_GMAIL_RAMP",
      domain_role: "PRIMARY_CORPORATE",
      custody_status: "TECKEL_MANAGED_FOR_ENNCO",
      evaluated_at: evaluatedAt,
      domain_age_days: 333,
      warmup_days: 0,
      valid_deliveries: delivery?.valid ?? 0,
      attempted_deliveries: delivery?.attempted ?? 0,
      hard_bounces: 0,
      spam_complaints: 0,
      delivery_rate: delivery?.rate ?? null,
      reply_sync_p95_seconds: 45,
      positive_reply_sla_breaches: 0,
      daily_cap: 5,
      blockers: [],
    }],
    inventory: {
      minimum_accounts: 75,
      minimum_contacts: 150,
      operational_accounts: 150,
      operational_contacts: 300,
      verified_accounts: 75,
      verified_contacts: 150,
    },
    blockers: ["ISOLATED_MAILBOX_COUNT_NOT_THREE"],
  };
}

describe("hybrid outbound readiness", () => {
  it("allows the accelerated primary lane without pretending isolated warmup is ready", () => {
    const result = parseHybridOutboundReadiness({
      rpcAvailable: true,
      rpcData: readyPayload(),
      expectedOrganizationId: organizationId,
      evaluatedAt,
    });
    expect(result.state).toBe("READY");
    expect(result.isolated_mailboxes_ready).toBe(0);
    expect(isHybridOutboundReleaseAllowed(result)).toBe(true);
  });

  it("keeps an eligible mailbox on hold until an exact active release exists", () => {
    const payload = readyPayload();
    payload.effective_release = "HOLD";
    payload.blockers = ["EXACT_ACTIVE_RELEASE_MISSING"];
    const result = parseHybridOutboundReadiness({
      rpcAvailable: true,
      rpcData: payload,
      expectedOrganizationId: organizationId,
      evaluatedAt,
    });
    expect(result.state).toBe("READY");
    expect(result.effective_release).toBe("HOLD");
    expect(isHybridOutboundReleaseAllowed(result)).toBe(false);
  });

  it("fails closed on a forged delivery rate", () => {
    const payload = readyPayload({ valid: 20, attempted: 21, rate: 1 });
    const result = parseHybridOutboundReadiness({
      rpcAvailable: true,
      rpcData: payload,
      expectedOrganizationId: organizationId,
      evaluatedAt,
    });
    expect(result.state).toBe("UNKNOWN");
    expect(result.blockers).toEqual(["HYBRID_OUTBOUND_SCHEMA_INVALID"]);
  });

  it("fails closed on organization drift", () => {
    const payload = readyPayload();
    payload.organization_id = "29000000-0000-4000-8000-000000000099";
    const result = parseHybridOutboundReadiness({
      rpcAvailable: true,
      rpcData: payload,
      expectedOrganizationId: organizationId,
      evaluatedAt,
    });
    expect(result.blockers).toEqual(["HYBRID_OUTBOUND_ORGANIZATION_DRIFT"]);
  });

  it("fails closed when the RPC is absent", () => {
    const result = parseHybridOutboundReadiness({
      rpcAvailable: false,
      rpcData: null,
      expectedOrganizationId: organizationId,
      evaluatedAt,
    });
    expect(result.state).toBe("UNKNOWN");
    expect(result.effective_release).toBe("HOLD");
    expect(result.inventory.operational_contacts).toBe(300);
  });
});
