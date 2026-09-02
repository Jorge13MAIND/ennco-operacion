import { NextResponse } from "next/server";

import { completeDirectLaneAuthorization } from "@/lib/correos/client";
import { DIRECT_LANE_OAUTH_COOKIE, DIRECT_LANE_OAUTH_COOKIE_PATH, requireDirectLaneOAuthClient } from "@/lib/correos/oauth";
import { directLaneCredentialSha256, sealDirectLaneSecret } from "@/lib/correos/vault";
import { exchangeGmailAuthorizationCode, stateMatches, unsealGmailOAuthCookie } from "@/lib/gmail/oauth";
import type { RuntimeConfig } from "@/lib/runtime/config";

const privateHeaders = { "Cache-Control": "private, no-store" } as const;

function finish(appUrl: string, estado: string, email?: string): NextResponse {
  const url = new URL("/correos/conectar", appUrl);
  url.searchParams.set("estado", estado);
  if (email) url.searchParams.set("buzon", email);
  const response = NextResponse.redirect(url, { status: 303, headers: privateHeaders });
  response.cookies.set(DIRECT_LANE_OAUTH_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: DIRECT_LANE_OAUTH_COOKIE_PATH, maxAge: 0 });
  return response;
}

/**
 * Paso 3 de la invitación: Google regresa con code + state. Se abre la cookie
 * sellada, se comprueba el estado, se canjea el código con PKCE, se exige que
 * la identidad de Google sea el buzón invitado, se cifra el refresh token con
 * la llave de la bóveda y se persiste vía RPC con prueba HMAC. El secreto en
 * claro no toca la base ni los logs.
 */
export async function handleDirectLaneOAuthCallback(request: Request, config: RuntimeConfig, sealedCookie: string): Promise<NextResponse> {
  let oauth;
  try {
    oauth = requireDirectLaneOAuthClient(config);
  } catch {
    return finish(config.appUrl, "no-configurado");
  }
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!state || !code || url.searchParams.has("error")) return finish(config.appUrl, "rechazada");
  try {
    const cookie = unsealGmailOAuthCookie(sealedCookie, oauth.stateSecret);
    if (cookie.organizationId !== config.organizationId || !stateMatches(state, cookie.stateSha256)) {
      throw new Error("DIRECT_LANE_STATE_MISMATCH");
    }
    const exchanged = await exchangeGmailAuthorizationCode({
      config: { clientId: oauth.clientId, clientSecret: oauth.clientSecret, redirectUri: oauth.redirectUri },
      code,
      verifier: cookie.verifier,
      expectedEmail: cookie.normalizedEmail,
    });
    const envelope = sealDirectLaneSecret(exchanged.refreshToken, oauth.vaultKey);
    const credentialSha256 = directLaneCredentialSha256({
      ciphertext: envelope.ciphertext,
      keyId: envelope.keyId,
      subjectSha256: exchanged.subjectSha256,
      normalizedEmail: exchanged.normalizedEmail,
      scopes: exchanged.grantedScopes,
    });
    const result = await completeDirectLaneAuthorization(config, {
      stateSha256: cookie.stateSha256,
      normalizedEmail: exchanged.normalizedEmail,
      googleSubjectSha256: exchanged.subjectSha256,
      ciphertext: envelope.ciphertext,
      keyId: envelope.keyId,
      credentialSha256,
      scopes: exchanged.grantedScopes,
      tokenIssuedAt: exchanged.issuedAt,
    });
    return finish(config.appUrl, result.status === "CONNECTED" ? "conectado" : "duplicado", exchanged.normalizedEmail);
  } catch (error) {
    const code = error instanceof Error && error.message === "GMAIL_OAUTH_IDENTITY_MISMATCH" ? "identidad" : "rechazada";
    return finish(config.appUrl, code);
  }
}
