import { describe, expect, it } from "vitest";

import {
  buildResearchChecksum,
  buildResearchIdempotencyKey,
  canonicalResearchJson,
} from "@/lib/research/integrity";

const organizationId = "11111111-1111-4111-8111-111111111111";

describe("research deterministic integrity", () => {
  it("canonicalizes object keys while preserving array order", () => {
    expect(canonicalResearchJson({ beta: 2, alpha: [1, 2] }))
      .toBe(canonicalResearchJson({ alpha: [1, 2], beta: 2 }));
    expect(canonicalResearchJson({ alpha: [1, 2] }))
      .not.toBe(canonicalResearchJson({ alpha: [2, 1] }));
  });

  it("rejects non-JSON, non-finite and cyclic payloads", () => {
    expect(() => canonicalResearchJson({ value: undefined })).toThrow("CANONICAL_JSON_UNDEFINED_VALUE");
    expect(() => canonicalResearchJson({ value: Number.NaN })).toThrow("CANONICAL_JSON_NON_FINITE_NUMBER");
    expect(() => canonicalResearchJson(new Date())).toThrow("CANONICAL_JSON_UNSUPPORTED_OBJECT");
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => canonicalResearchJson(cyclic)).toThrow("CANONICAL_JSON_CYCLE");
  });

  it("produces stable, domain-separated checksums", () => {
    const first = buildResearchChecksum("account.fact", { value: "synthetic" });
    const replay = buildResearchChecksum("account.fact", { value: "synthetic" });
    const otherScope = buildResearchChecksum("contact.fact", { value: "synthetic" });
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(replay).toBe(first);
    expect(otherScope).not.toBe(first);
  });

  it("builds deterministic idempotency keys and detects material payload changes", () => {
    const input = {
      action: "account.upsert",
      organizationId,
      naturalKey: "synthetic-account",
      payload: { domain: "synthetic.invalid", state: "GUANAJUATO" },
    };
    expect(buildResearchIdempotencyKey(input)).toBe(buildResearchIdempotencyKey({
      ...input,
      payload: { state: "GUANAJUATO", domain: "synthetic.invalid" },
    }));
    expect(buildResearchIdempotencyKey(input)).not.toBe(buildResearchIdempotencyKey({
      ...input,
      payload: { domain: "changed.invalid", state: "GUANAJUATO" },
    }));
  });

  it("rejects invalid idempotency namespaces and organization identifiers", () => {
    expect(() => buildResearchIdempotencyKey({
      action: "Account Upsert",
      organizationId,
      naturalKey: "synthetic",
      payload: {},
    })).toThrow("RESEARCH_IDEMPOTENCY_ACTION_INVALID");
    expect(() => buildResearchIdempotencyKey({
      action: "account.upsert",
      organizationId: "not-a-uuid",
      naturalKey: "synthetic",
      payload: {},
    })).toThrow("RESEARCH_IDEMPOTENCY_ORGANIZATION_INVALID");
  });
});
