import { describe, expect, it, vi } from "vitest";

import { GmailTokenError, getGmailAccessToken, invalidateGmailAccessToken } from "@/lib/dispatch/gmail-token";

const baseInput = {
  refreshToken: "refresh-token-synthetic-never-log-1234",
  clientId: "client-id-synthetic-long-enough",
  clientSecret: "client-secret-synthetic-long-enough",
};

function tokenResponse(token: string, expiresIn = 3600): Response {
  return new Response(JSON.stringify({ access_token: token, expires_in: expiresIn }), { status: 200 });
}

describe("Gmail dispatch token broker", () => {
  it("refreshes once and serves the cached token until near expiry", async () => {
    const credentialSha256 = "cache-test-".padEnd(64, "a");
    let clock = 1_000_000;
    const fetchImpl = vi.fn(async () => tokenResponse("access-token-one-long-enough"));

    const first = await getGmailAccessToken({ ...baseInput, credentialSha256, fetchImpl, now: () => clock });
    clock += 30 * 60 * 1000;
    const second = await getGmailAccessToken({ ...baseInput, credentialSha256, fetchImpl, now: () => clock });
    expect(first).toBe(second);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    clock += 25 * 60 * 1000;
    await getGmailAccessToken({ ...baseInput, credentialSha256, fetchImpl, now: () => clock });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("drops the cache and fails closed when Google rejects the refresh token", async () => {
    const credentialSha256 = "reject-test-".padEnd(64, "b");
    const good = vi.fn(async () => tokenResponse("access-token-two-long-enough"));
    await getGmailAccessToken({ ...baseInput, credentialSha256, fetchImpl: good });

    invalidateGmailAccessToken(credentialSha256);
    const rejecting = vi.fn(async () => new Response("{}", { status: 401 }));
    await expect(getGmailAccessToken({ ...baseInput, credentialSha256, fetchImpl: rejecting }))
      .rejects.toMatchObject({ code: "GMAIL_REFRESH_TOKEN_REJECTED" });
  });

  it("rejects malformed refresh tokens and provider outages without leaking material", async () => {
    const credentialSha256 = "invalid-test-".padEnd(64, "c");
    await expect(getGmailAccessToken({ ...baseInput, refreshToken: "short", credentialSha256 }))
      .rejects.toBeInstanceOf(GmailTokenError);

    const outage = vi.fn(async () => { throw new Error(baseInput.refreshToken); });
    let error: unknown;
    try {
      await getGmailAccessToken({ ...baseInput, credentialSha256, fetchImpl: outage });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: "GMAIL_TOKEN_ENDPOINT_UNAVAILABLE" });
    expect(String(error)).not.toContain(baseInput.refreshToken);
  });
});
