import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createPrequoteIngestProof } from "@/lib/prequote/ingest-proof";

describe("public prequote ingest proof", () => {
  it("binds organization, idempotency, nonce, payload, expiry and rate identity", () => {
    const secret = "synthetic-ingest-secret-at-least-32-characters";
    const proof = createPrequoteIngestProof({
      organizationId: "11111111-1111-4111-8111-111111111111",
      idempotencyKey: "m3-proof-idempotency-0001",
      clientAddress: "198.51.100.10",
      payload: { synthetic: true, value: 42 },
      secret,
      now: new Date("2026-08-11T18:00:00.000Z"),
      requestNonce: "21111111-1111-4111-8111-111111111111",
    });

    expect(proof.requestExpiresAtEpoch).toBe(1786471500);
    expect(proof.payloadSha256).toBe(createHash("sha256").update(proof.payloadText).digest("hex"));
    const signedValue = [
      "11111111-1111-4111-8111-111111111111",
      "m3-proof-idempotency-0001",
      "21111111-1111-4111-8111-111111111111",
      "1786471500",
      proof.payloadSha256,
      proof.rateLimitKeySha256,
    ].join("\n");
    expect(proof.requestSignature).toBe(createHmac("sha256", secret).update(signedValue).digest("hex"));
  });

  it("changes the signature when the rate identity changes", () => {
    const shared = {
      organizationId: "11111111-1111-4111-8111-111111111111",
      idempotencyKey: "m3-proof-idempotency-0002",
      payload: { synthetic: true },
      secret: "synthetic-ingest-secret-at-least-32-characters",
      now: new Date("2026-08-11T18:00:00.000Z"),
      requestNonce: "22111111-1111-4111-8111-111111111111",
    };
    const first = createPrequoteIngestProof({ ...shared, clientAddress: "198.51.100.10" });
    const second = createPrequoteIngestProof({ ...shared, clientAddress: "198.51.100.11" });

    expect(first.rateLimitKeySha256).not.toBe(second.rateLimitKeySha256);
    expect(first.requestSignature).not.toBe(second.requestSignature);
  });
});
