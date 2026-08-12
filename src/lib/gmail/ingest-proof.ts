import { createHash, createHmac } from "node:crypto";

export type GmailIngestProof = {
  requestNonce: string;
  requestExpiresAtEpoch: number;
  payloadSha256: string;
  requestSignature: string;
  payloadText: string;
};

export function createGmailIngestProof(input: {
  organizationId: string;
  idempotencyKey: string;
  payload: unknown;
  secret: string;
  now?: Date;
  requestNonce?: string;
}): GmailIngestProof {
  const requestNonce = input.requestNonce ?? crypto.randomUUID();
  const requestExpiresAtEpoch = Math.floor((input.now ?? new Date()).getTime() / 1000) + 5 * 60;
  const payloadText = JSON.stringify(input.payload);
  const payloadSha256 = createHash("sha256").update(payloadText).digest("hex");
  const signedValue = [
    input.organizationId,
    input.idempotencyKey,
    requestNonce,
    String(requestExpiresAtEpoch),
    payloadSha256,
  ].join("\n");
  return {
    requestNonce,
    requestExpiresAtEpoch,
    payloadSha256,
    requestSignature: createHmac("sha256", input.secret).update(signedValue).digest("hex"),
    payloadText,
  };
}
