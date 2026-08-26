import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMutationContext: vi.fn(),
  requireOperationsAccess: vi.fn(),
  getRuntimeConfig: vi.fn(),
  requireGmailOAuthConfig: vi.fn(),
  encryptText: vi.fn(),
  rpc: vi.fn(),
  cookieGet: vi.fn(),
  exchangeGmailAuthorizationCode: vi.fn(),
}));

vi.mock("@/lib/operations/route", () => ({ getMutationContext: mocks.getMutationContext }));
vi.mock("@/lib/auth/authorization", () => ({ requireOperationsAccess: mocks.requireOperationsAccess }));
vi.mock("@/lib/runtime/config", () => ({ getRuntimeConfig: mocks.getRuntimeConfig }));
vi.mock("@/lib/gmail/oauth-server", () => ({
  requireGmailOAuthConfig: mocks.requireGmailOAuthConfig,
  createGoogleKmsEnvelopeClient: () => ({ encryptText: mocks.encryptText }),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookieGet }) }));
vi.mock("@/lib/gmail/oauth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gmail/oauth")>();
  return { ...actual, exchangeGmailAuthorizationCode: mocks.exchangeGmailAuthorizationCode };
});

import { GET as callback } from "@/app/api/v1/operations/infrastructure/gmail/oauth/callback/route";
import { POST as start } from "@/app/api/v1/operations/infrastructure/gmail/oauth/start/route";
import {
  GMAIL_OAUTH_SCOPES,
  createCredentialSha256,
  sealGmailOAuthCookie,
  sha256,
} from "@/lib/gmail/oauth";

const organizationId = "30000000-0000-4000-8000-000000000001";
const mailboxId = "30200000-0000-4000-8000-000000000001";
const stateSecret = "synthetic-state-secret-at-least-thirty-two-characters";
const oauthConfig = {
  clientId: "synthetic-client.apps.googleusercontent.com",
  clientSecret: "synthetic-client-secret-never-production",
  redirectUri: "https://operacion.ennco.com.mx/api/v1/operations/infrastructure/gmail/oauth/callback",
  kmsKeyName: "projects/ennco/locations/us/keyRings/oauth/cryptoKeys/gmail",
  stateSecret,
  completionSecret: "synthetic-completion-secret-at-least-thirty-two-characters",
};

describe("Gmail OAuth routes", () => {
  it("creates a short-lived authorization URL only after the authenticated DB gate", async () => {
    mocks.getMutationContext.mockResolvedValueOnce({ ok: true, organizationId, client: { rpc: mocks.rpc } });
    mocks.getRuntimeConfig.mockReturnValueOnce({ gmailOauthReleased: true });
    mocks.requireGmailOAuthConfig.mockReturnValueOnce(oauthConfig);
    mocks.rpc.mockResolvedValueOnce({
      data: {
        status: "STARTED",
        authorization_id: "30300000-0000-4000-8000-000000000001",
        mailbox_id: mailboxId,
        expires_at: new Date(Date.now() + 8 * 60 * 1000).toISOString(),
        request_sha256: "a".repeat(64),
      },
      error: null,
    });

    const response = await start(new Request("https://operacion.ennco.com.mx/api/v1/operations/infrastructure/gmail/oauth/start", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://operacion.ennco.com.mx" },
      body: JSON.stringify({ mailbox_id: mailboxId }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    const authorizationUrl = new URL(body.authorization_url);
    expect(authorizationUrl.origin).toBe("https://accounts.google.com");
    expect(authorizationUrl.searchParams.get("login_hint")).toBe("contacto@ennco.com.mx");
    expect(response.headers.get("set-cookie")).toContain("ennco_gmail_oauth=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(mocks.rpc).toHaveBeenCalledWith("begin_gmail_oauth_authorization", expect.objectContaining({
      target_organization_id: organizationId,
      target_mailbox_id: mailboxId,
      target_scopes: [...GMAIL_OAUTH_SCOPES],
    }));
  });

  it("returns a safe unavailable response when OAuth is not released", async () => {
    mocks.getMutationContext.mockResolvedValueOnce({ ok: true, organizationId, client: { rpc: mocks.rpc } });
    mocks.getRuntimeConfig.mockReturnValueOnce({ gmailOauthReleased: false });
    mocks.requireGmailOAuthConfig.mockImplementationOnce(() => { throw new Error("GMAIL_OAUTH_NOT_RELEASED"); });
    const response = await start(new Request("https://operacion.ennco.com.mx/api/v1/operations/infrastructure/gmail/oauth/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mailbox_id: mailboxId }),
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "GMAIL_OAUTH_NOT_RELEASED" });
  });

  it("encrypts the refresh token before persistence and completes with ciphertext only", async () => {
    const state = "state-value-for-callback";
    const stateSha256 = sha256(state);
    const ciphertext = Buffer.from("synthetic-kms-ciphertext-long-enough").toString("base64");
    const subjectSha256 = "b".repeat(64);
    const keyVersion = "7";
    const credentialSha256 = createCredentialSha256({
      ciphertext,
      keyName: oauthConfig.kmsKeyName,
      keyVersion,
      subjectSha256,
      normalizedEmail: "contacto@ennco.com.mx",
      scopes: GMAIL_OAUTH_SCOPES,
    });
    mocks.requireOperationsAccess.mockResolvedValueOnce({
      evidenceClass: "live",
      organizationId,
      userId: "30100000-0000-4000-8000-000000000001",
      role: "teckel_admin",
    });
    mocks.getRuntimeConfig.mockReturnValueOnce({ appUrl: "https://operacion.ennco.com.mx", gmailOauthReleased: true });
    mocks.requireGmailOAuthConfig.mockReturnValueOnce(oauthConfig);
    mocks.cookieGet.mockReturnValueOnce({ value: sealGmailOAuthCookie({
      organizationId,
      mailboxId,
      normalizedEmail: "contacto@ennco.com.mx",
      stateSha256,
      verifier: "v".repeat(64),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    }, stateSecret) });
    mocks.exchangeGmailAuthorizationCode.mockResolvedValueOnce({
      refreshToken: "raw-refresh-token-never-persisted",
      normalizedEmail: "contacto@ennco.com.mx",
      subjectSha256,
      grantedScopes: [...GMAIL_OAUTH_SCOPES],
      issuedAt: "2026-08-25T18:00:00.000Z",
    });
    mocks.encryptText.mockResolvedValueOnce({ ciphertext, keyName: oauthConfig.kmsKeyName, keyVersion });
    mocks.rpc.mockResolvedValueOnce({
      data: {
        status: "CONNECTED",
        authorization_id: "30300000-0000-4000-8000-000000000001",
        credential_id: "30400000-0000-4000-8000-000000000001",
        mailbox_id: mailboxId,
        credential_sha256: credentialSha256,
      },
      error: null,
    });

    const response = await callback(new Request(`${oauthConfig.redirectUri}?state=${encodeURIComponent(state)}&code=synthetic-code`));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://operacion.ennco.com.mx/operacion/infraestructura?gmail_oauth=connected");
    expect(mocks.encryptText).toHaveBeenCalledWith("raw-refresh-token-never-persisted");
    expect(mocks.rpc).toHaveBeenCalledWith("complete_gmail_oauth_authorization", expect.objectContaining({
      target_ciphertext: ciphertext,
      target_credential_sha256: credentialSha256,
      target_normalized_email: "contacto@ennco.com.mx",
    }));
    expect(JSON.stringify(mocks.rpc.mock.calls.at(-1))).not.toContain("raw-refresh-token-never-persisted");
  });
});
