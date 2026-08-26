import { z } from "zod";

const tokenResponseSchema = z.object({
  access_token: z.string().min(16),
  expires_in: z.number().int().positive(),
}).passthrough();

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type CachedToken = { accessToken: string; expiresAtMs: number };

// Cache en scope de módulo: en una lambda caliente evita un refresh por tick.
// Los access tokens de Google viven ~1 h; se descartan 10 minutos antes.
// Lección D'Group 2026-06-23: un token pedido una sola vez al inicio expiró a
// la hora y tiró la corrida completa.
const tokenCache = new Map<string, CachedToken>();

const EXPIRY_SAFETY_MS = 10 * 60 * 1000;

export class GmailTokenError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "GmailTokenError";
  }
}

export function invalidateGmailAccessToken(credentialSha256: string): void {
  tokenCache.delete(credentialSha256);
}

export async function getGmailAccessToken(input: {
  refreshToken: string;
  credentialSha256: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: FetchLike;
  now?: () => number;
}): Promise<string> {
  const now = input.now ?? Date.now;
  const cached = tokenCache.get(input.credentialSha256);
  if (cached && cached.expiresAtMs > now()) return cached.accessToken;

  if (!input.refreshToken || input.refreshToken.trim().length < 20) {
    throw new GmailTokenError("GMAIL_REFRESH_TOKEN_INVALID");
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: input.refreshToken,
        client_id: input.clientId,
        client_secret: input.clientSecret,
      }).toString(),
      cache: "no-store",
    });
  } catch {
    throw new GmailTokenError("GMAIL_TOKEN_ENDPOINT_UNAVAILABLE");
  }
  if (response.status === 400 || response.status === 401) {
    tokenCache.delete(input.credentialSha256);
    throw new GmailTokenError("GMAIL_REFRESH_TOKEN_REJECTED");
  }
  if (!response.ok) throw new GmailTokenError("GMAIL_TOKEN_ENDPOINT_ERROR");

  const json: unknown = await response.json().catch(() => null);
  const parsed = tokenResponseSchema.safeParse(json);
  if (!parsed.success) throw new GmailTokenError("GMAIL_TOKEN_RESPONSE_INVALID");

  const expiresAtMs = now() + parsed.data.expires_in * 1000 - EXPIRY_SAFETY_MS;
  if (expiresAtMs > now()) {
    tokenCache.set(input.credentialSha256, { accessToken: parsed.data.access_token, expiresAtMs });
  }
  return parsed.data.access_token;
}
