import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  GMAIL_OAUTH_SCOPES,
  createGmailAuthorizationUrl,
  createPkceChallenge,
  gmailOAuthStartResultSchema,
  randomBase64Url,
  sealGmailOAuthCookie,
  sha256,
} from "@/lib/gmail/oauth";
import { requireGmailOAuthConfig } from "@/lib/gmail/oauth-server";
import { getMutationContext } from "@/lib/operations/route";
import { getRuntimeConfig } from "@/lib/runtime/config";

const bodySchema = z.object({ mailbox_id: z.uuid() }).strict();
const privateHeaders = { "Cache-Control": "private, no-store" } as const;

export async function POST(request: Request): Promise<NextResponse> {
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  let oauthConfig;
  try {
    oauthConfig = requireGmailOAuthConfig(getRuntimeConfig());
  } catch {
    return NextResponse.json({ error: "GMAIL_OAUTH_NOT_RELEASED" }, { status: 503, headers: privateHeaders });
  }
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "GMAIL_OAUTH_START_INPUT_INVALID" }, { status: 400, headers: privateHeaders });
  }

  const state = randomBase64Url(32);
  const verifier = randomBase64Url(64);
  const stateSha256 = sha256(state);
  const expiresAt = new Date(Date.now() + 8 * 60 * 1000).toISOString();
  const idempotencyKey = sha256(`gmail-oauth-start\n${context.organizationId}\n${body.data.mailbox_id}\n${stateSha256}`);
  const { data, error } = await context.client.rpc("begin_gmail_oauth_authorization", {
    target_organization_id: context.organizationId,
    target_mailbox_id: body.data.mailbox_id,
    target_state_sha256: stateSha256,
    target_pkce_challenge: createPkceChallenge(verifier),
    target_redirect_uri_sha256: createHash("sha256").update(oauthConfig.redirectUri).digest("hex"),
    target_scopes: [...GMAIL_OAUTH_SCOPES],
    target_expires_at: expiresAt,
    target_idempotency_key: idempotencyKey,
  });
  if (error) {
    return NextResponse.json({ error: "GMAIL_OAUTH_START_REJECTED" }, { status: 409, headers: privateHeaders });
  }
  const result = gmailOAuthStartResultSchema.safeParse(data);
  if (!result.success) {
    return NextResponse.json({ error: "GMAIL_OAUTH_START_RESPONSE_INVALID" }, { status: 409, headers: privateHeaders });
  }
  const response = NextResponse.json({
    status: result.data.status,
    authorization_url: createGmailAuthorizationUrl({
      config: oauthConfig,
      state,
      codeChallenge: createPkceChallenge(verifier),
      normalizedEmail: "contacto@ennco.com.mx",
    }),
    expires_at: result.data.expires_at,
  }, { status: 200, headers: privateHeaders });
  response.cookies.set("ennco_gmail_oauth", sealGmailOAuthCookie({
    organizationId: context.organizationId,
    mailboxId: body.data.mailbox_id,
    normalizedEmail: "contacto@ennco.com.mx",
    stateSha256,
    verifier,
    expiresAt,
  }, oauthConfig.stateSecret), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/v1/operations/infrastructure/gmail/oauth",
    expires: new Date(expiresAt),
  });
  return response;
}
