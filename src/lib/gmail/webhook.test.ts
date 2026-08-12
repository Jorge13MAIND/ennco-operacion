import { describe, expect, it, vi } from "vitest";

import { parseGmailPushEnvelope, verifyPubSubAuthorization } from "@/lib/gmail/webhook";

const subscription = "projects/synthetic/subscriptions/ennco-gmail";

function envelope(notification: unknown = { emailAddress: "Francisco@Outreach.Invalid", historyId: "1001" }) {
  return {
    message: {
      data: Buffer.from(JSON.stringify(notification)).toString("base64url"),
      messageId: "pubsub-1001",
      publishTime: "2026-08-11T20:00:00.000Z",
    },
    subscription,
  };
}

describe("Gmail Pub/Sub webhook", () => {
  it("decodes only the expected envelope and subscription", () => {
    expect(parseGmailPushEnvelope(envelope(), subscription)).toEqual({
      emailAddress: "francisco@outreach.invalid",
      historyId: "1001",
      messageId: "pubsub-1001",
      publishTime: "2026-08-11T20:00:00.000Z",
      subscription,
    });
    expect(() => parseGmailPushEnvelope(envelope(), "projects/other/subscriptions/other")).toThrow(
      "PUBSUB_SUBSCRIPTION_MISMATCH",
    );
    expect(() => parseGmailPushEnvelope(envelope({ emailAddress: "a@b.test", historyId: "x" }), subscription)).toThrow();
  });

  it("requires the configured Google identity, audience and verified email", async () => {
    const verifier = vi.fn(async () => ({
      email: "pubsub@synthetic.iam.gserviceaccount.com",
      emailVerified: true,
      audience: "https://operacion.invalid/api/v1/webhooks/gmail",
      issuer: "https://accounts.google.com",
    }));
    await expect(verifyPubSubAuthorization({
      authorization: "Bearer synthetic.token.value",
      audience: "https://operacion.invalid/api/v1/webhooks/gmail",
      serviceAccount: "pubsub@synthetic.iam.gserviceaccount.com",
      verifier,
    })).resolves.toMatchObject({ emailVerified: true });
    expect(verifier).toHaveBeenCalledOnce();

    await expect(verifyPubSubAuthorization({
      authorization: "Bearer synthetic.token.value",
      audience: "https://operacion.invalid/api/v1/webhooks/gmail",
      serviceAccount: "other@synthetic.iam.gserviceaccount.com",
      verifier,
    })).rejects.toThrow("PUBSUB_IDENTITY_REJECTED");
  });
});
