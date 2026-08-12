import { describe, expect, it } from "vitest";

import { buildUnsubscribeUrl, createUnsubscribeToken, verifyUnsubscribeToken } from "@/lib/unsubscribe/token";

const secret = "unsubscribe-signing-secret-for-local-tests-only";
const organizationId = "11111111-1111-4111-8111-111111111111";
const enrollmentId = "22222222-2222-4222-8222-222222222222";
const nonce = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-08-12T12:00:00.000Z");

describe("one-click unsubscribe token", () => {
  it("binds tenant, enrollment, nonce and expiry without putting an email in the URL", () => {
    const { token } = createUnsubscribeToken({ organizationId, enrollmentId, nonce, secret, now, lifetimeSeconds: 3600 });
    const payload = verifyUnsubscribeToken(token, secret, new Date("2026-08-12T12:30:00.000Z"));
    expect(payload).toMatchObject({ organizationId, enrollmentId, nonce });
    const url = buildUnsubscribeUrl("https://operacion.ennco.com.mx", token);
    expect(url).toContain("/api/v1/unsubscribe?token=");
    expect(url).not.toContain("@");
  });

  it("rejects tampering and expiry", () => {
    const { token } = createUnsubscribeToken({ organizationId, enrollmentId, nonce, secret, now, lifetimeSeconds: 60 });
    expect(() => verifyUnsubscribeToken(`${token}x`, secret, now)).toThrow("UNSUBSCRIBE_TOKEN_INVALID");
    expect(() => verifyUnsubscribeToken(token, secret, new Date("2026-08-12T12:02:00.000Z"))).toThrow("UNSUBSCRIBE_TOKEN_EXPIRED");
  });
});
