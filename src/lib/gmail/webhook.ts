import { OAuth2Client } from "google-auth-library";
import { z } from "zod";

const gmailNotificationSchema = z.object({
  emailAddress: z.email().transform((value) => value.toLowerCase()),
  historyId: z.string().regex(/^[0-9]{1,32}$/),
}).strict();

const pubSubEnvelopeSchema = z.object({
  message: z.object({
    data: z.string().min(4).max(20_000),
    messageId: z.string().min(1).max(255).regex(/^[A-Za-z0-9._:-]+$/),
    publishTime: z.iso.datetime({ offset: true }),
  }).strict(),
  subscription: z.string().min(3).max(512),
}).strict();

export type GmailPushPayload = {
  emailAddress: string;
  historyId: string;
  messageId: string;
  publishTime: string;
  subscription: string;
};

export function parseGmailPushEnvelope(value: unknown, expectedSubscription: string): GmailPushPayload {
  const envelope = pubSubEnvelopeSchema.parse(value);
  if (envelope.subscription !== expectedSubscription) throw new Error("PUBSUB_SUBSCRIPTION_MISMATCH");

  let decoded: unknown;
  try {
    const text = Buffer.from(envelope.message.data, "base64url").toString("utf8");
    if (!text || Buffer.byteLength(text, "utf8") > 4_096) throw new Error("PAYLOAD_SIZE");
    decoded = JSON.parse(text) as unknown;
  } catch {
    throw new Error("GMAIL_NOTIFICATION_INVALID");
  }
  const notification = gmailNotificationSchema.parse(decoded);
  return {
    ...notification,
    messageId: envelope.message.messageId,
    publishTime: envelope.message.publishTime,
    subscription: envelope.subscription,
  };
}

export type PubSubIdentity = {
  email: string;
  emailVerified: boolean;
  audience: string | string[];
  issuer: string;
};

export type PubSubTokenVerifier = (token: string, audience: string) => Promise<PubSubIdentity>;

async function googleTokenVerifier(token: string, audience: string): Promise<PubSubIdentity> {
  const client = new OAuth2Client();
  const ticket = await client.verifyIdToken({ idToken: token, audience });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload.aud || !payload.iss) throw new Error("PUBSUB_IDENTITY_INCOMPLETE");
  return {
    email: payload.email,
    emailVerified: payload.email_verified === true,
    audience: payload.aud,
    issuer: payload.iss,
  };
}

export async function verifyPubSubAuthorization(input: {
  authorization: string | null;
  audience: string;
  serviceAccount: string;
  verifier?: PubSubTokenVerifier;
}): Promise<PubSubIdentity> {
  const match = input.authorization?.match(/^Bearer ([A-Za-z0-9._-]+)$/);
  const token = match?.[1];
  if (!token) throw new Error("PUBSUB_AUTHORIZATION_REQUIRED");
  const identity = await (input.verifier ?? googleTokenVerifier)(token, input.audience);
  const audiences = Array.isArray(identity.audience) ? identity.audience : [identity.audience];
  if (
    !identity.emailVerified
    || identity.email.toLowerCase() !== input.serviceAccount.toLowerCase()
    || !audiences.includes(input.audience)
    || !["accounts.google.com", "https://accounts.google.com"].includes(identity.issuer)
  ) {
    throw new Error("PUBSUB_IDENTITY_REJECTED");
  }
  return identity;
}
