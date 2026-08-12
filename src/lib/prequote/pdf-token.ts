import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { PrequoteEstimate } from "@/lib/domain/types";

const tokenPayloadSchema = z.object({
  folio: z.string().regex(/^ENN-PRE-[A-F0-9]{8}$/),
  evidenceClass: z.enum(["synthetic_demo", "live"]),
  issuedAtEpoch: z.number().int().nonnegative(),
  expiresAtEpoch: z.number().int().positive(),
  estimate: z.custom<PrequoteEstimate>((value) => typeof value === "object" && value !== null),
});

export type PrequotePdfTokenPayload = z.infer<typeof tokenPayloadSchema>;

function signatureFor(payloadPart: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payloadPart).digest();
}

export function createPrequotePdfToken(input: {
  folio: string;
  evidenceClass: "synthetic_demo" | "live";
  estimate: PrequoteEstimate;
  secret: string;
  now?: Date;
  ttlSeconds?: number;
}): { token: string; expiresAt: string } {
  const now = input.now ?? new Date();
  const ttlSeconds = input.ttlSeconds ?? 15 * 60;
  if (ttlSeconds < 60 || ttlSeconds > 60 * 60) throw new Error("INVALID_PDF_TOKEN_TTL");

  const payload: PrequotePdfTokenPayload = {
    folio: input.folio,
    evidenceClass: input.evidenceClass,
    estimate: input.estimate,
    issuedAtEpoch: Math.floor(now.getTime() / 1000),
    expiresAtEpoch: Math.floor(now.getTime() / 1000) + ttlSeconds,
  };
  const payloadPart = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signaturePart = signatureFor(payloadPart, input.secret).toString("base64url");
  return {
    token: `${payloadPart}.${signaturePart}`,
    expiresAt: new Date(payload.expiresAtEpoch * 1000).toISOString(),
  };
}

export function verifyPrequotePdfToken(input: {
  token: string;
  expectedFolio: string;
  secret: string;
  now?: Date;
}): PrequotePdfTokenPayload {
  const [payloadPart, signaturePart, extra] = input.token.split(".");
  if (!payloadPart || !signaturePart || extra) throw new Error("INVALID_PDF_TOKEN");

  const expected = signatureFor(payloadPart, input.secret);
  const received = Buffer.from(signaturePart, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new Error("INVALID_PDF_TOKEN");
  }

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    throw new Error("INVALID_PDF_TOKEN");
  }
  const payload = tokenPayloadSchema.parse(rawPayload);
  if (payload.folio !== input.expectedFolio) throw new Error("PDF_TOKEN_FOLIO_MISMATCH");

  const nowEpoch = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (payload.expiresAtEpoch < nowEpoch || payload.issuedAtEpoch > nowEpoch + 30) {
    throw new Error("PDF_TOKEN_EXPIRED");
  }
  return payload;
}
