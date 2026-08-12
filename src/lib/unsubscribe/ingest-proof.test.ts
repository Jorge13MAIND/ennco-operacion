import { describe, expect, it } from "vitest";

import { createUnsubscribeIngestProof } from "@/lib/unsubscribe/ingest-proof";

describe("unsubscribe ingest proof", () => {
  it("binds the proof to the organization, enrollment, token nonce and idempotency key", () => {
    const input = {
      organizationId: "11111111-1111-4111-8111-111111111111",
      enrollmentId: "22222222-2222-4222-8222-222222222222",
      tokenNonce: "33333333-3333-4333-8333-333333333333",
      idempotencyKey: "unsubscribe:synthetic:one",
      secret: "unsubscribe-ingest-secret-for-local-tests-only",
      now: new Date("2026-08-12T12:00:00.000Z"),
      requestNonce: "44444444-4444-4444-8444-444444444444",
    };
    const first = createUnsubscribeIngestProof(input);
    const drift = createUnsubscribeIngestProof({ ...input, enrollmentId: "55555555-5555-4555-8555-555555555555" });
    expect(first.requestSignature).not.toBe(drift.requestSignature);
    expect(first.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
