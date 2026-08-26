import { describe, expect, it, vi } from "vitest";

import {
  GMAIL_OAUTH_SCOPES,
  GoogleKmsEnvelopeClient,
  canonicalizeScopes,
  createCredentialSha256,
  createGmailAuthorizationUrl,
  createGmailOAuthCompletionProof,
  createPkceChallenge,
  exchangeGmailAuthorizationCode,
  sealGmailOAuthCookie,
  sha256,
  stateMatches,
  unsealGmailOAuthCookie,
} from "@/lib/gmail/oauth";

const config = {
  clientId: "synthetic-client.apps.googleusercontent.com",
  clientSecret: "synthetic-client-secret-never-production",
  redirectUri: "https://operacion.ennco.com.mx/api/v1/operations/infrastructure/gmail/oauth/callback",
};

const stateSecret = "synthetic-state-secret-at-least-thirty-two-characters";

describe("Gmail OAuth and KMS controls", () => {
  it("builds an offline PKCE authorization request with the exact minimal scopes", () => {
    const verifier = "v".repeat(64);
    const url = new URL(createGmailAuthorizationUrl({
      config,
      state: "s".repeat(43),
      codeChallenge: createPkceChallenge(verifier),
      normalizedEmail: "contacto@ennco.com.mx",
    }));

    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(canonicalizeScopes(url.searchParams.get("scope")?.split(" ") ?? [])).toEqual([...GMAIL_OAUTH_SCOPES].sort());
    expect(url.searchParams.get("login_hint")).toBe("contacto@ennco.com.mx");
  });

  it("seals the verifier in an authenticated short-lived cookie", () => {
    const state = "state-value-never-persisted-raw";
    const cookie = sealGmailOAuthCookie({
      organizationId: "30000000-0000-4000-8000-000000000001",
      mailboxId: "30100000-0000-4000-8000-000000000001",
      normalizedEmail: "contacto@ennco.com.mx",
      stateSha256: sha256(state),
      verifier: "v".repeat(64),
      expiresAt: "2026-08-25T18:10:00.000Z",
    }, stateSecret);

    expect(cookie).not.toContain("contacto@ennco.com.mx");
    expect(unsealGmailOAuthCookie(cookie, stateSecret, Date.parse("2026-08-25T18:05:00.000Z"))).toMatchObject({
      normalizedEmail: "contacto@ennco.com.mx",
      stateSha256: sha256(state),
    });
    expect(stateMatches(state, sha256(state))).toBe(true);
    expect(stateMatches(`${state}-drift`, sha256(state))).toBe(false);
    expect(() => unsealGmailOAuthCookie(`${cookie}x`, stateSecret, Date.parse("2026-08-25T18:05:00.000Z"))).toThrow("GMAIL_OAUTH_COOKIE_INVALID");
    expect(() => unsealGmailOAuthCookie(cookie, stateSecret, Date.parse("2026-08-25T18:11:00.000Z"))).toThrow("GMAIL_OAUTH_COOKIE_EXPIRED");
  });

  it("accepts only the exact verified mailbox identity and complete scopes", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "access-token-at-least-twenty-characters",
        expires_in: 3600,
        refresh_token: "refresh-token-at-least-twenty-characters",
        scope: GMAIL_OAUTH_SCOPES.join(" "),
        token_type: "Bearer",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        sub: "google-subject-synthetic",
        email: "contacto@ennco.com.mx",
        email_verified: true,
      }), { status: 200 }));

    const result = await exchangeGmailAuthorizationCode({
      config,
      code: "synthetic-code",
      verifier: "v".repeat(64),
      expectedEmail: "contacto@ennco.com.mx",
      fetchImpl,
      now: new Date("2026-08-25T18:00:00.000Z"),
    });

    expect(result).toEqual({
      refreshToken: "refresh-token-at-least-twenty-characters",
      normalizedEmail: "contacto@ennco.com.mx",
      subjectSha256: sha256("google-subject-synthetic"),
      grantedScopes: [...GMAIL_OAUTH_SCOPES].sort(),
      issuedAt: "2026-08-25T18:00:00.000Z",
    });
    expect(fetchImpl.mock.calls[0]?.[1]?.body?.toString()).not.toContain("refresh-token");
  });

  it("fails closed on identity drift or missing offline refresh token", async () => {
    const token = {
      access_token: "access-token-at-least-twenty-characters",
      expires_in: 3600,
      refresh_token: "refresh-token-at-least-twenty-characters",
      scope: GMAIL_OAUTH_SCOPES.join(" "),
      token_type: "Bearer",
    };
    const mismatchFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(token), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        sub: "other-subject",
        email: "otro@ennco.com.mx",
        email_verified: true,
      }), { status: 200 }));
    await expect(exchangeGmailAuthorizationCode({
      config,
      code: "synthetic-code",
      verifier: "v".repeat(64),
      expectedEmail: "contacto@ennco.com.mx",
      fetchImpl: mismatchFetch,
    })).rejects.toThrow("GMAIL_OAUTH_IDENTITY_MISMATCH");

    const missingRefreshFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...token, refresh_token: undefined }), { status: 200 }));
    await expect(exchangeGmailAuthorizationCode({
      config,
      code: "synthetic-code",
      verifier: "v".repeat(64),
      expectedEmail: "contacto@ennco.com.mx",
      fetchImpl: missingRefreshFetch,
    })).rejects.toThrow("GMAIL_OAUTH_TOKEN_EXCHANGE_FAILED");
  });

  it("resolves an enabled KMS primary version and never sends plaintext outside the encrypt request", async () => {
    const keyName = "projects/ennco/locations/us/keyRings/oauth/cryptoKeys/gmail";
    const syntheticCiphertext = Buffer.from("synthetic-kms-ciphertext-long-enough").toString("base64");
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        primary: { name: `${keyName}/cryptoKeyVersions/7`, state: "ENABLED" },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ciphertext: syntheticCiphertext }), { status: 200 }));
    const client = new GoogleKmsEnvelopeClient({
      keyName,
      accessTokenProvider: async () => "synthetic-google-access-token",
      fetchImpl,
    });

    const envelope = await client.encryptText("refresh-token-never-log-this");
    expect(envelope).toEqual({
      ciphertext: syntheticCiphertext,
      keyName,
      keyVersion: "7",
    });
    expect(String(fetchImpl.mock.calls[1]?.[1]?.body)).not.toContain("refresh-token-never-log-this");
    expect(String(fetchImpl.mock.calls[1]?.[1]?.body)).toContain(Buffer.from("refresh-token-never-log-this").toString("base64"));
  });

  it("binds the credential checksum to ciphertext, key, identity and scopes", () => {
    const baseline = createCredentialSha256({
      ciphertext: Buffer.from("ciphertext").toString("base64"),
      keyName: "projects/ennco/locations/us/keyRings/oauth/cryptoKeys/gmail",
      keyVersion: "7",
      subjectSha256: "a".repeat(64),
      normalizedEmail: "contacto@ennco.com.mx",
      scopes: GMAIL_OAUTH_SCOPES,
    });
    expect(baseline).toMatch(/^[a-f0-9]{64}$/u);
    expect(createCredentialSha256({
      ciphertext: Buffer.from("ciphertext-drift").toString("base64"),
      keyName: "projects/ennco/locations/us/keyRings/oauth/cryptoKeys/gmail",
      keyVersion: "7",
      subjectSha256: "a".repeat(64),
      normalizedEmail: "contacto@ennco.com.mx",
      scopes: GMAIL_OAUTH_SCOPES,
    })).not.toBe(baseline);
  });

  it("binds completion to a server-only proof", () => {
    const secret = "synthetic-completion-secret-at-least-thirty-two-characters";
    const proof = createGmailOAuthCompletionProof({
      organizationId: "30000000-0000-4000-8000-000000000001",
      stateSha256: "a".repeat(64),
      credentialSha256: "b".repeat(64),
      secret,
    });
    expect(proof).toMatch(/^[a-f0-9]{64}$/u);
    expect(createGmailOAuthCompletionProof({
      organizationId: "30000000-0000-4000-8000-000000000001",
      stateSha256: "a".repeat(64),
      credentialSha256: "c".repeat(64),
      secret,
    })).not.toBe(proof);
  });
});
