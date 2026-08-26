import { NextResponse } from "next/server";

import { claimHybridDispatch, readHybridDispatchCredential, runDispatchHeartbeat, settleHybridDispatch } from "@/lib/dispatch/client";
import { authorizeCronRequest } from "@/lib/dispatch/cron-auth";
import { getGmailAccessToken, invalidateGmailAccessToken } from "@/lib/dispatch/gmail-token";
import { sendDispatchAlert } from "@/lib/dispatch/telegram";
import { GmailOutboundClient, GmailOutboundError } from "@/lib/gmail/outbound-client";
import { createGoogleKmsEnvelopeClient } from "@/lib/gmail/oauth-server";
import { getRuntimeConfig } from "@/lib/runtime/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const privateHeaders = { "Cache-Control": "private, no-store" } as const;

export async function GET(request: Request): Promise<NextResponse> {
  const config = getRuntimeConfig();
  const auth = authorizeCronRequest(request, config);
  if (auth.status === "HOLD") return NextResponse.json({ state: "HOLD", reason: auth.reason }, { status: 200, headers: privateHeaders });
  if (auth.status === "UNAUTHORIZED") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: privateHeaders });

  // Los triggers de salud exigen watchdog y reconciler frescos (<5 min): el
  // heartbeat corre SIEMPRE, incluso cuando no se envía nada.
  let health: Record<string, unknown>;
  try {
    health = await runDispatchHeartbeat(config);
  } catch {
    await sendDispatchAlert({ config, level: "CRITICAL", title: "heartbeat falló", lines: ["run_dispatch_heartbeat inaccesible"] });
    return NextResponse.json({ state: "ERROR", reason: "HEARTBEAT_FAILED" }, { status: 200, headers: privateHeaders });
  }

  const dryRun = config.dispatchMode !== "live";
  let claim;
  try {
    claim = await claimHybridDispatch(config, dryRun);
  } catch {
    await sendDispatchAlert({ config, level: "CRITICAL", title: "claim falló", lines: ["claim_hybrid_dispatch inaccesible"] });
    return NextResponse.json({ state: "ERROR", reason: "CLAIM_FAILED" }, { status: 200, headers: privateHeaders });
  }

  if (claim.status !== "CLAIMED") {
    return NextResponse.json({ state: claim.status, reason: claim.reason ?? null, health }, { status: 200, headers: privateHeaders });
  }
  if (dryRun) {
    return NextResponse.json({ state: "SHADOW_CLAIMED", message_id: claim.message_id, touch: claim.touch_number }, { status: 200, headers: privateHeaders });
  }

  const messageId = claim.message_id;
  const mailboxId = (claim as Record<string, unknown>).mailbox_id;
  if (!messageId || typeof mailboxId !== "string" || !config.googleKmsKeyName || !config.googleOauthClientId || !config.googleOauthClientSecret) {
    return NextResponse.json({ state: "ERROR", reason: "LIVE_DISPATCH_CONFIG_INCOMPLETE" }, { status: 200, headers: privateHeaders });
  }

  const settleFailed = async (errorCode: string) => {
    await settleHybridDispatch(config, { messageId, outcome: "FAILED", errorCode }).catch(() => undefined);
    await sendDispatchAlert({ config, level: "WARN", title: "envío fallido", lines: [`mensaje ${messageId}`, errorCode] });
    return NextResponse.json({ state: "FAILED", message_id: messageId, reason: errorCode }, { status: 200, headers: privateHeaders });
  };

  let accessToken: string;
  let credentialSha256 = "";
  let issueAccessToken: () => Promise<string>;
  try {
    const credential = await readHybridDispatchCredential(config, mailboxId);
    credentialSha256 = credential.credential_sha256;
    const kms = createGoogleKmsEnvelopeClient(config.googleKmsKeyName);
    const refreshToken = await kms.decryptText({ ciphertext: credential.ciphertext, keyName: credential.kms_key_name });
    issueAccessToken = () => getGmailAccessToken({
      refreshToken,
      credentialSha256,
      clientId: config.googleOauthClientId as string,
      clientSecret: config.googleOauthClientSecret as string,
    });
    accessToken = await issueAccessToken();
  } catch {
    return settleFailed("DISPATCH_CREDENTIAL_UNAVAILABLE");
  }

  const rawThread = (claim as { thread_info?: { provider_thread_id?: string; previous_provider_message_id?: string } | null }).thread_info;
  const thread = rawThread?.provider_thread_id && rawThread.previous_provider_message_id
    ? { provider_thread_id: rawThread.provider_thread_id, previous_provider_message_id: rawThread.previous_provider_message_id }
    : undefined;

  const sendOnce = async (token: string) => new GmailOutboundClient({ accessToken: token }).sendTouch({
    from_name: "Francisco Cuellar",
    from_email: "contacto@ennco.com.mx",
    to_email: claim.to_email ?? "",
    subject: claim.subject ?? "",
    body_text: claim.body_text ?? "",
    touch_number: (claim.touch_number ?? 1) as 1 | 2 | 3,
    thread,
    authorization: {
      external_send_allowed: true,
      global_kill_switch: false,
      evidence_class: "live",
      release_id: claim.release_id ?? "",
      message_id: messageId,
      manifest_sha256: claim.manifest_sha256 ?? "",
    },
  });

  try {
    let result;
    try {
      result = await sendOnce(accessToken);
    } catch (error) {
      if (error instanceof GmailOutboundError && error.code === "GMAIL_API_UNAUTHORIZED") {
        invalidateGmailAccessToken(credentialSha256);
        result = await sendOnce(await issueAccessToken());
      } else {
        throw error;
      }
    }
    await settleHybridDispatch(config, {
      messageId,
      outcome: "SENT",
      providerMessageId: result.provider_message_id,
      providerThreadId: result.provider_thread_id,
    });
    return NextResponse.json({ state: "SENT", message_id: messageId, touch: claim.touch_number }, { status: 200, headers: privateHeaders });
  } catch (error) {
    const code = error instanceof GmailOutboundError ? error.code : "GMAIL_SEND_UNKNOWN_ERROR";
    return settleFailed(code);
  }
}
