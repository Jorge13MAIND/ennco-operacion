import { NextResponse } from "next/server";
import { z } from "zod";

import { armDirectLaneAuthorization, readDirectLaneInvitation } from "@/lib/correos/client";
import { invitationTokenSha256, DIRECT_LANE_OAUTH_COOKIE, DIRECT_LANE_OAUTH_COOKIE_PATH, requireDirectLaneOAuthClient } from "@/lib/correos/oauth";
import { createGmailAuthorizationUrl, createPkceChallenge, randomBase64Url, sealGmailOAuthCookie, sha256 } from "@/lib/gmail/oauth";
import { getRuntimeConfig, hasDedicatedSupabase } from "@/lib/runtime/config";
import { evaluateMutationRequest } from "@/lib/security/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const privateHeaders = { "Cache-Control": "private, no-store" } as const;

function rejected(appUrl: string, reason: string): NextResponse {
  const url = new URL("/correos/conectar", appUrl);
  url.searchParams.set("estado", reason);
  return NextResponse.redirect(url, { status: 303, headers: privateHeaders });
}

/**
 * Paso 2 de la invitación: el dueño del buzón presionó "Conectar". Se arma el
 * estado en la base (hash), se sella la cookie con el verificador PKCE y se
 * redirige a Google con login_hint = el buzón invitado. No exige sesión del
 * Control Room: la invitación ES la autorización.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const config = getRuntimeConfig();
  const origin = evaluateMutationRequest(request, config.appUrl);
  if (origin.decision !== "ALLOW") return rejected(config.appUrl, "origen");
  if (!hasDedicatedSupabase(config)) return rejected(config.appUrl, "no-disponible");
  let oauth;
  try {
    oauth = requireDirectLaneOAuthClient(config);
  } catch {
    return rejected(config.appUrl, "no-configurado");
  }
  const form = await request.formData().catch(() => null);
  const token = z.string().safeParse(form?.get("t"));
  const tokenSha256 = token.success ? invitationTokenSha256(token.data) : null;
  if (!tokenSha256) return rejected(config.appUrl, "invalida");

  const invitation = await readDirectLaneInvitation(config, tokenSha256).catch(() => null);
  if (!invitation || invitation.status !== "VALID" || !invitation.mailbox_id || !invitation.normalized_email) {
    return rejected(config.appUrl, "vencida");
  }
  const state = randomBase64Url(32);
  const verifier = randomBase64Url(64);
  const stateSha256 = sha256(state);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  try {
    await armDirectLaneAuthorization(config, tokenSha256, stateSha256);
  } catch {
    return rejected(config.appUrl, "vencida");
  }
  const response = NextResponse.redirect(createGmailAuthorizationUrl({
    config: { clientId: oauth.clientId, clientSecret: oauth.clientSecret, redirectUri: oauth.redirectUri },
    state,
    codeChallenge: createPkceChallenge(verifier),
    normalizedEmail: invitation.normalized_email,
  }), { status: 303, headers: privateHeaders });
  response.cookies.set(DIRECT_LANE_OAUTH_COOKIE, sealGmailOAuthCookie({
    organizationId: config.organizationId,
    mailboxId: invitation.mailbox_id,
    normalizedEmail: invitation.normalized_email,
    stateSha256,
    verifier,
    expiresAt,
  }, oauth.stateSecret), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: DIRECT_LANE_OAUTH_COOKIE_PATH,
    expires: new Date(expiresAt),
  });
  return response;
}
