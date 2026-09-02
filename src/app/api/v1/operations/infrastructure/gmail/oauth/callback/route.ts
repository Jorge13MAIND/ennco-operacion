import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/authorization";
import { handleDirectLaneOAuthCallback } from "@/lib/correos/callback";
import { DIRECT_LANE_OAUTH_COOKIE } from "@/lib/correos/oauth";
import {
  createCredentialSha256,
  createGmailOAuthCompletionProof,
  exchangeGmailAuthorizationCode,
  gmailOAuthCompleteResultSchema,
  sha256,
  stateMatches,
  unsealGmailOAuthCookie,
} from "@/lib/gmail/oauth";
import { createGoogleKmsEnvelopeClient, requireGmailOAuthConfig } from "@/lib/gmail/oauth-server";
import { getRuntimeConfig } from "@/lib/runtime/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function resultRedirect(appUrl: string, result: "connected" | "rejected"): NextResponse {
  const url = new URL("/operacion/infraestructura", appUrl);
  url.searchParams.set("gmail_oauth", result);
  return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request): Promise<NextResponse> {
  // Carril directo (M041): la invitación no exige sesión del Control Room.
  // Comparte esta URI porque es la registrada en el cliente OAuth de Google.
  const runtime = getRuntimeConfig();
  if (runtime.directLaneReleased) {
    const directLaneCookie = (await cookies()).get(DIRECT_LANE_OAUTH_COOKIE)?.value;
    if (directLaneCookie) return handleDirectLaneOAuthCallback(request, runtime, directLaneCookie);
  }

  const access = await requireOperationsAccess();
  if (access.evidenceClass !== "live" || !access.organizationId || !access.userId) {
    return resultRedirect(runtime.appUrl, "rejected");
  }
  let oauthConfig;
  try {
    oauthConfig = requireGmailOAuthConfig(runtime);
  } catch {
    return resultRedirect(runtime.appUrl, "rejected");
  }
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!state || !code || url.searchParams.has("error")) return resultRedirect(runtime.appUrl, "rejected");

  const cookieStore = await cookies();
  const sealedCookie = cookieStore.get("ennco_gmail_oauth")?.value;
  if (!sealedCookie) return resultRedirect(runtime.appUrl, "rejected");
  try {
    const oauthCookie = unsealGmailOAuthCookie(sealedCookie, oauthConfig.stateSecret);
    if (
      oauthCookie.organizationId !== access.organizationId
      || !stateMatches(state, oauthCookie.stateSha256)
    ) {
      throw new Error("GMAIL_OAUTH_STATE_MISMATCH");
    }
    const exchanged = await exchangeGmailAuthorizationCode({
      config: oauthConfig,
      code,
      verifier: oauthCookie.verifier,
      expectedEmail: oauthCookie.normalizedEmail,
    });
    const envelope = await createGoogleKmsEnvelopeClient(oauthConfig.kmsKeyName).encryptText(exchanged.refreshToken);
    const credentialSha256 = createCredentialSha256({
      ciphertext: envelope.ciphertext,
      keyName: envelope.keyName,
      keyVersion: envelope.keyVersion,
      subjectSha256: exchanged.subjectSha256,
      normalizedEmail: exchanged.normalizedEmail,
      scopes: exchanged.grantedScopes,
    });
    const client = await createSupabaseServerClient();
    const completionIdempotencyKey = sha256(`gmail-oauth-complete\n${oauthCookie.stateSha256}\n${credentialSha256}`);
    const completionProof = createGmailOAuthCompletionProof({
      organizationId: access.organizationId,
      stateSha256: oauthCookie.stateSha256,
      credentialSha256,
      secret: oauthConfig.completionSecret,
    });
    const { data, error } = await client.rpc("complete_gmail_oauth_authorization", {
      target_organization_id: access.organizationId,
      target_state_sha256: oauthCookie.stateSha256,
      target_ciphertext: envelope.ciphertext,
      target_kms_key_name: envelope.keyName,
      target_kms_key_version: envelope.keyVersion,
      target_google_subject_sha256: exchanged.subjectSha256,
      target_normalized_email: exchanged.normalizedEmail,
      target_scopes: exchanged.grantedScopes,
      target_token_issued_at: exchanged.issuedAt,
      target_credential_sha256: credentialSha256,
      target_idempotency_key: completionIdempotencyKey,
      target_completion_proof: completionProof,
    });
    if (error || !gmailOAuthCompleteResultSchema.safeParse(data).success) {
      throw new Error("GMAIL_OAUTH_COMPLETION_REJECTED");
    }
    const response = resultRedirect(runtime.appUrl, "connected");
    response.cookies.set("ennco_gmail_oauth", "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/v1/operations/infrastructure/gmail/oauth",
      maxAge: 0,
    });
    return response;
  } catch {
    const response = resultRedirect(runtime.appUrl, "rejected");
    response.cookies.set("ennco_gmail_oauth", "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/v1/operations/infrastructure/gmail/oauth",
      maxAge: 0,
    });
    return response;
  }
}
