import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { createGmailIngestProof } from "@/lib/gmail/ingest-proof";
import type { GmailPushPayload } from "@/lib/gmail/webhook";
import { hasDedicatedSupabase, type RuntimeConfig } from "@/lib/runtime/config";

const resultSchema = z.object({
  status: z.enum(["ACCEPTED", "DUPLICATE"]),
  notification_id: z.uuid(),
  correlation_id: z.uuid(),
});

export type GmailPersistenceResult = z.infer<typeof resultSchema>;

export async function persistGmailPush(input: {
  config: RuntimeConfig;
  payload: GmailPushPayload;
}): Promise<GmailPersistenceResult> {
  if (!hasDedicatedSupabase(input.config) || !input.config.gmailIngestSecret) {
    throw new Error("GMAIL_PERSISTENCE_UNAVAILABLE");
  }
  const idempotencyKey = `gmail:${createHash("sha256").update(input.payload.messageId).digest("hex")}`;
  const proof = createGmailIngestProof({
    organizationId: input.config.organizationId,
    idempotencyKey,
    payload: input.payload,
    secret: input.config.gmailIngestSecret,
  });
  const client = createClient(input.config.supabaseUrl, input.config.supabasePublishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const { data, error } = await client.rpc("capture_gmail_push_notification", {
    target_organization_id: input.config.organizationId,
    target_idempotency_key: idempotencyKey,
    target_request_nonce: proof.requestNonce,
    target_request_expires_at_epoch: proof.requestExpiresAtEpoch,
    target_payload_sha256: proof.payloadSha256,
    target_request_signature: proof.requestSignature,
    target_payload_text: proof.payloadText,
  });
  if (error) throw new Error("GMAIL_PERSISTENCE_UNAVAILABLE");
  return resultSchema.parse(data);
}
