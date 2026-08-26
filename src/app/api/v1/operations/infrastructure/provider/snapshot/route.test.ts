import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMutationContext, rpc } = vi.hoisted(() => ({ getMutationContext: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/operations/route", () => ({ getMutationContext }));

import { POST } from "@/app/api/v1/operations/infrastructure/provider/snapshot/route";

const organizationId = "11111111-1111-4111-8111-111111111111";
const body = {
  account: {
    provider_code: "APOLLO", environment: "PRODUCTION", ownership_status: "UNKNOWN",
    terms_status: "UNKNOWN", plan_name: "Professional", legal_owner: "UNKNOWN", seat_count: 1,
    billing_frequency: "MONTHLY", external_account_ref_sha256: null, mfa_status: "UNKNOWN",
    recovery_status: "UNKNOWN", monthly_budget_mxn: 1782, hard_cap_mxn: 1782,
    evidence_sha256: "a".repeat(64), renewal_at: null, delivery_status: "BLOCKED",
    last_audited_at: null, verified_at: null, active: false,
  },
  budget: {
    cycle_start: "2026-08-01", cycle_end: "2026-09-01", credit_limit: 500,
    credits_consumed: 0, research_credit_cap: 500, infrastructure_credit_spend: 0,
    phone_enrichment_allowed: false, status: "BLOCKED", evidence_sha256: "b".repeat(64),
    observed_at: "2026-08-20T18:00:00.000Z",
  },
  domains: [], mailboxes: [],
  gates: [{ gate_code: "OPERATOR_COVERAGE", status: "PASS", evidence_sha256: "c".repeat(64), evidence_class: "live", recorded_at: "2026-08-20T18:00:00.000Z", expires_at: null }],
};

function request(payload: unknown = body, key = "d".repeat(64)): Request {
  return new Request("https://example.invalid/api/v1/operations/infrastructure/provider/snapshot", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(payload),
  });
}

describe("POST provider infrastructure snapshot", () => {
  beforeEach(() => {
    rpc.mockReset();
    getMutationContext.mockReset();
    getMutationContext.mockResolvedValue({ ok: true, organizationId, client: { rpc } });
  });

  it("authenticates and applies only the strict fail-closed snapshot", async () => {
    rpc.mockResolvedValue({ data: {
      status: "CREATED",
      provider_account_id: "22222222-2222-4222-8222-222222222222",
      request_sha256: "e".repeat(64),
      domains_recorded: 0,
      mailboxes_recorded: 0,
      gates_recorded: 1,
      readiness: { status: "READ_ONLY", state: "BLOCKED", release_state: "HOLD" },
    }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("apply_outbound_provider_snapshot", {
      target_organization_id: organizationId,
      target_snapshot: body,
      target_idempotency_key: "d".repeat(64),
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rejects obsolete backup, cap drift and extra fields before database mutation", async () => {
    for (const invalid of [
      { ...body, gates: [{ ...body.gates[0], gate_code: "OPERATOR_BACKUP" }] },
      { ...body, budget: { ...body.budget, credit_limit: 501 } },
      { ...body, unexpected: true },
    ]) {
      const response = await POST(request(invalid));
      expect(response.status).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("authenticates before parsing and requires a SHA256 idempotency key", async () => {
    getMutationContext.mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ error: "DENIED" }), { status: 403 }),
    });
    expect((await POST(new Request("https://example.invalid/api", { method: "POST", body: "not-json" }))).status).toBe(403);
    expect((await POST(request(body, "invalid"))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
