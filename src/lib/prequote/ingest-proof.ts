import { createHash, createHmac } from "node:crypto";

export type PrequoteIngestProof = {
  requestNonce: string;
  requestExpiresAtEpoch: number;
  payloadSha256: string;
  requestSignature: string;
  rateLimitKeySha256: string;
  payloadText: string;
};

export function createPrequoteIngestProof(input: {
  organizationId: string;
  idempotencyKey: string;
  clientAddress: string;
  payload: unknown;
  secret: string;
  now?: Date;
  requestNonce?: string;
}): PrequoteIngestProof {
  const now = input.now ?? new Date();
  const requestNonce = input.requestNonce ?? crypto.randomUUID();
  const requestExpiresAtEpoch = Math.floor(now.getTime() / 1000) + 5 * 60;
  const payloadText = JSON.stringify(input.payload);
  const payloadSha256 = createHash("sha256").update(payloadText).digest("hex");
  const rateLimitKeySha256 = createHmac("sha256", input.secret)
    .update(`rate-limit\n${input.clientAddress}`)
    .digest("hex");
  const signedValue = [
    input.organizationId,
    input.idempotencyKey,
    requestNonce,
    String(requestExpiresAtEpoch),
    payloadSha256,
    rateLimitKeySha256,
  ].join("\n");

  return {
    requestNonce,
    requestExpiresAtEpoch,
    payloadSha256,
    requestSignature: createHmac("sha256", input.secret).update(signedValue).digest("hex"),
    rateLimitKeySha256,
    payloadText,
  };
}
