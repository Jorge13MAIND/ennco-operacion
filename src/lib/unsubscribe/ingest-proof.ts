import { createHash, createHmac, randomUUID } from "node:crypto";

export type UnsubscribeIngestProof = {
  requestNonce: string;
  requestExpiresAtEpoch: number;
  payloadSha256: string;
  requestSignature: string;
};

export function createUnsubscribeIngestProof(input: {
  organizationId: string;
  enrollmentId: string;
  tokenNonce: string;
  idempotencyKey: string;
  secret: string;
  now?: Date;
  requestNonce?: string;
}): UnsubscribeIngestProof {
  if (input.secret.length < 32) throw new Error("UNSUBSCRIBE_INGEST_SECRET_TOO_SHORT");
  const requestNonce = input.requestNonce ?? randomUUID();
  const requestExpiresAtEpoch = Math.floor((input.now ?? new Date()).getTime() / 1000) + 300;
  const payloadSha256 = createHash("sha256")
    .update(`${input.organizationId}:${input.enrollmentId}:${input.tokenNonce}`)
    .digest("hex");
  const canonical = [
    input.organizationId,
    input.enrollmentId,
    input.tokenNonce,
    input.idempotencyKey,
    requestNonce,
    String(requestExpiresAtEpoch),
    payloadSha256,
  ].join(":");
  return {
    requestNonce,
    requestExpiresAtEpoch,
    payloadSha256,
    requestSignature: createHmac("sha256", input.secret).update(canonical).digest("hex"),
  };
}
