import { NextResponse } from "next/server";

import { persistGmailPush } from "@/lib/gmail/persistence";
import { parseGmailPushEnvelope, verifyPubSubAuthorization } from "@/lib/gmail/webhook";
import { getRuntimeConfig } from "@/lib/runtime/config";

function unavailable(code: string): NextResponse {
  return NextResponse.json(
    { error: code, correlation_id: crypto.randomUUID() },
    { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "60" } },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  let config;
  try {
    config = getRuntimeConfig();
  } catch {
    return unavailable("GMAIL_WEBHOOK_RUNTIME_NOT_READY");
  }
  if (
    !config.gmailWebhookReleased
    || !config.gmailPubSubAudience
    || !config.gmailPubSubServiceAccount
    || !config.gmailPubSubSubscription
  ) {
    return unavailable("GMAIL_WEBHOOK_NOT_RELEASED");
  }

  try {
    await verifyPubSubAuthorization({
      authorization: request.headers.get("authorization"),
      audience: config.gmailPubSubAudience,
      serviceAccount: config.gmailPubSubServiceAccount,
    });
  } catch {
    return NextResponse.json(
      { error: "GMAIL_WEBHOOK_AUTHENTICATION_FAILED" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const rawBody: unknown = await request.json().catch(() => null);
  let payload;
  try {
    payload = parseGmailPushEnvelope(rawBody, config.gmailPubSubSubscription);
  } catch {
    return NextResponse.json(
      { error: "GMAIL_WEBHOOK_PAYLOAD_INVALID" },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  try {
    await persistGmailPush({ config, payload });
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return unavailable("GMAIL_WEBHOOK_PERSISTENCE_UNAVAILABLE");
  }
}
