import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { z } from "zod";

export const GMAIL_OAUTH_SCOPES = [
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "openid",
] as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const base64UrlSchema = z.string().regex(/^[A-Za-z0-9_-]+$/u).min(32).max(256);
const timestampSchema = z.iso.datetime({ offset: true });

const sealedCookieSchema = z.object({
  organizationId: z.uuid(),
  mailboxId: z.uuid(),
  normalizedEmail: z.email(),
  stateSha256: sha256Schema,
  verifier: base64UrlSchema,
  expiresAt: timestampSchema,
}).strict();

const tokenResponseSchema = z.object({
  access_token: z.string().min(20),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(20),
  scope: z.string().min(1),
  token_type: z.literal("Bearer"),
}).passthrough();

const userInfoSchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.email().transform((value) => value.trim().toLowerCase()),
  email_verified: z.boolean(),
}).passthrough();

const cryptoKeySchema = z.object({
  primary: z.object({
    name: z.string().min(1),
    state: z.literal("ENABLED"),
  }).strict(),
}).passthrough();

const kmsEncryptResponseSchema = z.object({
  ciphertext: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/u).min(24).max(65536),
}).passthrough();

export const gmailOAuthStartResultSchema = z.object({
  status: z.enum(["STARTED", "DUPLICATE"]),
  authorization_id: z.uuid(),
  mailbox_id: z.uuid(),
  expires_at: timestampSchema,
  request_sha256: sha256Schema,
}).strict();

export const gmailOAuthCompleteResultSchema = z.object({
  status: z.enum(["CONNECTED", "DUPLICATE"]),
  authorization_id: z.uuid(),
  credential_id: z.uuid(),
  mailbox_id: z.uuid(),
  credential_sha256: sha256Schema,
}).strict();

export type GmailOAuthCookie = z.infer<typeof sealedCookieSchema>;

export type GmailOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type GmailOAuthExchangeResult = {
  refreshToken: string;
  normalizedEmail: string;
  subjectSha256: string;
  grantedScopes: string[];
  issuedAt: string;
};

export type KmsEnvelope = {
  ciphertext: string;
  keyName: string;
  keyVersion: string;
};

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomBase64Url(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function createPkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function canonicalizeScopes(scopes: readonly string[]): string[] {
  return [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))].sort();
}

export function createGmailAuthorizationUrl(input: {
  config: GmailOAuthConfig;
  state: string;
  codeChallenge: string;
  normalizedEmail: string;
}): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", input.config.clientId);
  url.searchParams.set("redirect_uri", input.config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_OAUTH_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("login_hint", input.normalizedEmail);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

function cookieKey(secret: string): Buffer {
  if (secret.length < 32) throw new Error("GMAIL_OAUTH_STATE_SECRET_INVALID");
  return createHash("sha256").update(secret).digest();
}

export function sealGmailOAuthCookie(payload: GmailOAuthCookie, secret: string): string {
  const parsed = sealedCookieSchema.parse(payload);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cookieKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(parsed), "utf8"),
    cipher.final(),
  ]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function unsealGmailOAuthCookie(value: string, secret: string, now = Date.now()): GmailOAuthCookie {
  const [version, ivValue, tagValue, ciphertextValue, extra] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue || extra) {
    throw new Error("GMAIL_OAUTH_COOKIE_INVALID");
  }
  try {
    const iv = Buffer.from(ivValue, "base64url");
    const tag = Buffer.from(tagValue, "base64url");
    const ciphertext = Buffer.from(ciphertextValue, "base64url");
    if (iv.toString("base64url") !== ivValue || tag.toString("base64url") !== tagValue
      || ciphertext.toString("base64url") !== ciphertextValue) {
      throw new Error("GMAIL_OAUTH_COOKIE_INVALID");
    }
    const decipher = createDecipheriv("aes-256-gcm", cookieKey(secret), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    const payload = sealedCookieSchema.parse(JSON.parse(plaintext));
    if (Date.parse(payload.expiresAt) <= now) throw new Error("GMAIL_OAUTH_COOKIE_EXPIRED");
    return payload;
  } catch (error) {
    if (error instanceof Error && error.message === "GMAIL_OAUTH_COOKIE_EXPIRED") throw error;
    throw new Error("GMAIL_OAUTH_COOKIE_INVALID");
  }
}

export function stateMatches(state: string, expectedSha256: string): boolean {
  if (!sha256Schema.safeParse(expectedSha256).success) return false;
  return timingSafeEqual(Buffer.from(sha256(state), "hex"), Buffer.from(expectedSha256, "hex"));
}

export async function exchangeGmailAuthorizationCode(input: {
  config: GmailOAuthConfig;
  code: string;
  verifier: string;
  expectedEmail: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<GmailOAuthExchangeResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const tokenBody = new URLSearchParams({
    client_id: input.config.clientId,
    client_secret: input.config.clientSecret,
    code: input.code,
    code_verifier: input.verifier,
    grant_type: "authorization_code",
    redirect_uri: input.config.redirectUri,
  });
  const tokenResponse = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody,
    cache: "no-store",
  });
  const tokenJson: unknown = await tokenResponse.json().catch(() => null);
  const tokens = tokenResponse.ok ? tokenResponseSchema.safeParse(tokenJson) : null;
  if (!tokens || !tokens.success) throw new Error("GMAIL_OAUTH_TOKEN_EXCHANGE_FAILED");

  const grantedScopes = canonicalizeScopes(tokens.data.scope.split(/\s+/u));
  if (GMAIL_OAUTH_SCOPES.some((required) => !grantedScopes.includes(required))) {
    throw new Error("GMAIL_OAUTH_SCOPE_INCOMPLETE");
  }
  const identityResponse = await fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", {
    method: "GET",
    headers: { Authorization: `Bearer ${tokens.data.access_token}` },
    cache: "no-store",
  });
  const identityJson: unknown = await identityResponse.json().catch(() => null);
  const identity = identityResponse.ok ? userInfoSchema.safeParse(identityJson) : null;
  if (!identity || !identity.success || !identity.data.email_verified) {
    throw new Error("GMAIL_OAUTH_IDENTITY_UNVERIFIED");
  }
  if (identity.data.email !== input.expectedEmail.trim().toLowerCase()) {
    throw new Error("GMAIL_OAUTH_IDENTITY_MISMATCH");
  }
  return {
    refreshToken: tokens.data.refresh_token,
    normalizedEmail: identity.data.email,
    subjectSha256: sha256(identity.data.sub),
    grantedScopes,
    issuedAt: (input.now ?? new Date()).toISOString(),
  };
}

export class GoogleKmsEnvelopeClient {
  constructor(private readonly input: {
    keyName: string;
    accessTokenProvider: () => Promise<string>;
    fetchImpl?: typeof fetch;
  }) {}

  async encryptText(plaintext: string): Promise<KmsEnvelope> {
    if (!plaintext) throw new Error("KMS_PLAINTEXT_REQUIRED");
    const fetchImpl = this.input.fetchImpl ?? fetch;
    const accessToken = await this.input.accessTokenProvider();
    if (!accessToken) throw new Error("KMS_ACCESS_TOKEN_REQUIRED");
    const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
    const keyResponse = await fetchImpl(`https://cloudkms.googleapis.com/v1/${this.input.keyName}`, {
      method: "GET",
      headers,
      cache: "no-store",
    });
    const keyJson: unknown = await keyResponse.json().catch(() => null);
    const key = keyResponse.ok ? cryptoKeySchema.safeParse(keyJson) : null;
    if (!key || !key.success || !key.data.primary.name.startsWith(`${this.input.keyName}/cryptoKeyVersions/`)) {
      throw new Error("KMS_PRIMARY_KEY_UNAVAILABLE");
    }
    const encryptResponse = await fetchImpl(`https://cloudkms.googleapis.com/v1/${key.data.primary.name}:encrypt`, {
      method: "POST",
      headers,
      body: JSON.stringify({ plaintext: Buffer.from(plaintext, "utf8").toString("base64") }),
      cache: "no-store",
    });
    const encryptJson: unknown = await encryptResponse.json().catch(() => null);
    const encrypted = encryptResponse.ok ? kmsEncryptResponseSchema.safeParse(encryptJson) : null;
    if (!encrypted || !encrypted.success) throw new Error("KMS_ENCRYPT_FAILED");
    return {
      ciphertext: encrypted.data.ciphertext,
      keyName: this.input.keyName,
      keyVersion: key.data.primary.name.split("/").at(-1) ?? "",
    };
  }
}

export function createCredentialSha256(input: {
  ciphertext: string;
  keyName: string;
  keyVersion: string;
  subjectSha256: string;
  normalizedEmail: string;
  scopes: readonly string[];
}): string {
  return sha256([
    input.ciphertext,
    input.keyName,
    input.keyVersion,
    input.subjectSha256,
    input.normalizedEmail.trim().toLowerCase(),
    canonicalizeScopes(input.scopes).join(" "),
  ].join("\n"));
}

export function createGmailOAuthCompletionProof(input: {
  organizationId: string;
  stateSha256: string;
  credentialSha256: string;
  secret: string;
}): string {
  if (input.secret.length < 32) throw new Error("GMAIL_OAUTH_COMPLETION_SECRET_INVALID");
  return createHmac("sha256", input.secret).update([
    input.organizationId,
    input.stateSha256,
    input.credentialSha256,
  ].join("\n")).digest("hex");
}
