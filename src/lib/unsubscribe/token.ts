import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const tokenPayloadSchema = z.object({
  version: z.literal(1),
  organizationId: z.uuid(),
  enrollmentId: z.uuid(),
  nonce: z.uuid(),
  issuedAtEpoch: z.number().int().positive(),
  expiresAtEpoch: z.number().int().positive(),
}).refine((value) => value.expiresAtEpoch > value.issuedAtEpoch, "UNSUBSCRIBE_TOKEN_EXPIRY_INVALID");

export type UnsubscribeTokenPayload = z.infer<typeof tokenPayloadSchema>;

function signature(encodedPayload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(`ennco-unsubscribe-v1:${encodedPayload}`).digest();
}

export function createUnsubscribeToken(input: {
  organizationId: string;
  enrollmentId: string;
  secret: string;
  now?: Date;
  lifetimeSeconds?: number;
  nonce?: string;
}): { token: string; payload: UnsubscribeTokenPayload } {
  if (input.secret.length < 32) throw new Error("UNSUBSCRIBE_SIGNING_SECRET_TOO_SHORT");
  const issuedAtEpoch = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const lifetimeSeconds = input.lifetimeSeconds ?? 180 * 24 * 60 * 60;
  if (!Number.isInteger(lifetimeSeconds) || lifetimeSeconds < 60 || lifetimeSeconds > 370 * 24 * 60 * 60) {
    throw new Error("UNSUBSCRIBE_TOKEN_LIFETIME_INVALID");
  }
  const payload = tokenPayloadSchema.parse({
    version: 1,
    organizationId: input.organizationId,
    enrollmentId: input.enrollmentId,
    nonce: input.nonce ?? randomUUID(),
    issuedAtEpoch,
    expiresAtEpoch: issuedAtEpoch + lifetimeSeconds,
  });
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { token: `${encodedPayload}.${signature(encodedPayload, input.secret).toString("base64url")}`, payload };
}

export function verifyUnsubscribeToken(token: string, secret: string, now = new Date()): UnsubscribeTokenPayload {
  if (secret.length < 32) throw new Error("UNSUBSCRIBE_SIGNING_SECRET_TOO_SHORT");
  const [encodedPayload, encodedSignature, unexpected] = token.split(".");
  if (!encodedPayload || !encodedSignature || unexpected) throw new Error("UNSUBSCRIBE_TOKEN_INVALID");
  let provided: Buffer;
  let rawPayload: unknown;
  try {
    provided = Buffer.from(encodedSignature, "base64url");
    rawPayload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new Error("UNSUBSCRIBE_TOKEN_INVALID");
  }
  const expected = signature(encodedPayload, secret);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new Error("UNSUBSCRIBE_TOKEN_INVALID");
  }
  const payload = tokenPayloadSchema.parse(rawPayload);
  const nowEpoch = Math.floor(now.getTime() / 1000);
  if (payload.issuedAtEpoch > nowEpoch + 300 || payload.expiresAtEpoch < nowEpoch) {
    throw new Error("UNSUBSCRIBE_TOKEN_EXPIRED");
  }
  return payload;
}

export function buildUnsubscribeUrl(appUrl: string, token: string): string {
  const url = new URL("/api/v1/unsubscribe", appUrl);
  url.searchParams.set("token", token);
  return url.toString();
}
