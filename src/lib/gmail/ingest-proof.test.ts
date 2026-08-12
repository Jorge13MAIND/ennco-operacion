import { describe, expect, it } from "vitest";

import { createGmailIngestProof } from "@/lib/gmail/ingest-proof";

describe("Gmail ingest proof", () => {
  it("binds organization, idempotency, nonce, expiry and payload", () => {
    const base = {
      organizationId: "11111111-1111-4111-8111-111111111111",
      idempotencyKey: `gmail:${"a".repeat(64)}`,
      payload: { historyId: "1001" },
      secret: "synthetic-gmail-secret-at-least-32-bytes",
      now: new Date("2026-08-11T20:00:00.000Z"),
      requestNonce: "22222222-2222-4222-8222-222222222222",
    };
    const proof = createGmailIngestProof(base);
    expect(proof.requestExpiresAtEpoch).toBe(1786478700);
    expect(proof.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(proof.requestSignature).toMatch(/^[a-f0-9]{64}$/);
    expect(createGmailIngestProof({ ...base, payload: { historyId: "1002" } }).requestSignature)
      .not.toBe(proof.requestSignature);
  });
});
