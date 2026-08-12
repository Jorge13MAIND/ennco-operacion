import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  assessResearchInventoryRpcResultSchema,
  parseResearchMutationInput,
  researchRpcRejected,
  researchRpcResponse,
} from "@/lib/research/http";

const organizationId = "11111111-1111-4111-8111-111111111111";
const hash = "a".repeat(64);

describe("research HTTP trust boundary", () => {
  it("requires a SHA256 Idempotency-Key before reading the body", async () => {
    const request = new Request("https://operacion.invalid/api/v1/research/accounts", {
      method: "POST",
      body: "not-json",
    });
    const text = vi.spyOn(request, "text");
    const parsed = await parseResearchMutationInput({
      request,
      schema: z.object({ organizationId: z.uuid(), idempotencyKey: z.string(), name: z.string() }).strict(),
      trustedValues: { organizationId },
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("EXPECTED_PARSE_REJECTION");
    expect(parsed.response.status).toBe(400);
    expect((await parsed.response.json()).error).toBe("RESEARCH_IDEMPOTENCY_KEY_INVALID");
    expect(text).not.toHaveBeenCalled();
  });

  it("rejects organization and idempotency fields supplied by the body", async () => {
    const request = new Request("https://operacion.invalid/api/v1/research/accounts", {
      method: "POST",
      headers: { "Idempotency-Key": hash },
      body: JSON.stringify({ organizationId: "22222222-2222-4222-8222-222222222222", name: "Synthetic" }),
    });
    const parsed = await parseResearchMutationInput({
      request,
      schema: z.object({ organizationId: z.uuid(), idempotencyKey: z.string(), name: z.string() }).strict(),
      trustedValues: { organizationId },
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("EXPECTED_TRUSTED_FIELD_REJECTION");
    expect((await parsed.response.json()).error).toBe("RESEARCH_TRUSTED_FIELD_IN_BODY");
  });

  it("binds trusted session values and the header after strict body parsing", async () => {
    const request = new Request("https://operacion.invalid/api/v1/research/accounts", {
      method: "POST",
      headers: { "Idempotency-Key": hash },
      body: JSON.stringify({ name: "Synthetic" }),
    });
    const parsed = await parseResearchMutationInput({
      request,
      schema: z.object({ organizationId: z.uuid(), idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/u), name: z.string() }).strict(),
      trustedValues: { organizationId },
    });
    expect(parsed).toEqual({ ok: true, data: { organizationId, idempotencyKey: hash, name: "Synthetic" } });
  });

  it("rejects malformed, scalar, empty and oversized bodies", async () => {
    const bodies = ["not-json", "null", "[]", ""];
    for (const body of bodies) {
      const parsed = await parseResearchMutationInput({
        request: new Request("https://operacion.invalid/api", {
          method: "POST",
          headers: { "Idempotency-Key": hash },
          body,
        }),
        schema: z.object({ organizationId: z.uuid(), idempotencyKey: z.string() }).strict(),
        trustedValues: { organizationId },
      });
      expect(parsed.ok).toBe(false);
    }

    const oversized = await parseResearchMutationInput({
      request: new Request("https://operacion.invalid/api", {
        method: "POST",
        headers: { "Idempotency-Key": hash, "content-length": "2000001" },
        body: "{}",
      }),
      schema: z.object({ organizationId: z.uuid(), idempotencyKey: z.string() }).strict(),
      trustedValues: { organizationId },
    });
    expect(oversized.ok).toBe(false);
  });

  it("fails closed for unknown RPC fields and for commercial authorization drift", async () => {
    const valid = {
      status: "ASSESSED",
      decision: "PASS",
      verified_accounts: 75,
      verified_contacts: 150,
      target_accounts: 75,
      target_contacts: 150,
      outreach_state: "RESEARCH_ONLY_HOLD",
      outreach_eligible_records: 0,
      blockers: ["EXPLICIT_RELEASE_APPROVAL_REQUIRED"],
      assessment_checksum: hash,
    };
    expect(researchRpcResponse(assessResearchInventoryRpcResultSchema, valid).status).toBe(200);
    const unknown = researchRpcResponse(assessResearchInventoryRpcResultSchema, { ...valid, secret: "must-not-leak" });
    expect(unknown.status).toBe(502);
    expect(await unknown.json()).not.toHaveProperty("secret");
    expect(researchRpcResponse(assessResearchInventoryRpcResultSchema, {
      ...valid,
      outreach_state: "AUTHORIZED",
      outreach_eligible_records: 150,
    }).status).toBe(502);
  });

  it("returns a generic rejection with no database message", async () => {
    const response = researchRpcRejected("RESEARCH_ACCOUNT_REJECTED");
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ error: "RESEARCH_ACCOUNT_REJECTED" });
    expect(JSON.stringify(body)).not.toContain("database");
  });
});
