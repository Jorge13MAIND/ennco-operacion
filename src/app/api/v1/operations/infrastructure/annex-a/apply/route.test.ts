import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMutationContext, rpc } = vi.hoisted(() => ({ getMutationContext: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/operations/route", () => ({ getMutationContext }));

import { POST } from "@/app/api/v1/operations/infrastructure/annex-a/apply/route";

const organizationId = "11111111-1111-4111-8111-111111111111";

describe("POST Annex A infrastructure apply", () => {
  beforeEach(() => {
    rpc.mockReset();
    getMutationContext.mockReset();
    getMutationContext.mockResolvedValue({ ok: true, organizationId, client: { rpc } });
  });

  it("authenticates before applying the frozen server snapshot", async () => {
    rpc.mockResolvedValue({ data: {
      status: "APPLIED",
      manifest_id: "22222222-2222-4222-8222-222222222222",
      annex_id: "ENNCO-ANNEX-A-2026-08-13",
      snapshot_sha256: "8e986eff74dee10d3f619f7562ee6b7d18207c3c5e080cd82656cc0e88d46af1",
      entry_count: 3,
      alias_count: 12,
      domain_count: 6,
      matched_account_count: 3,
      outreach_eligible_records: 0,
      release_state: "HOLD",
    }, error: null });
    const response = await POST(new Request("https://example.invalid/api", {
      method: "POST", headers: { "Idempotency-Key": "a".repeat(64) },
    }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("apply_annex_a_suppression_snapshot", expect.objectContaining({
      target_organization_id: organizationId,
      target_idempotency_key: "a".repeat(64),
      target_snapshot: expect.objectContaining({ external_send_authorized: false, entries: expect.any(Array) }),
    }));
  });

  it("rejects a missing key without calling the database", async () => {
    const response = await POST(new Request("https://example.invalid/api", { method: "POST" }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not process the request after authorization denial", async () => {
    getMutationContext.mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ error: "DENIED" }), { status: 403 }),
    });
    const response = await POST(new Request("https://example.invalid/api", {
      method: "POST", headers: { "Idempotency-Key": "a".repeat(64) },
    }));
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});
