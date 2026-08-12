import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { createUnsubscribeIngestProof } from "@/lib/unsubscribe/ingest-proof";
import { hasDedicatedSupabase, type RuntimeConfig } from "@/lib/runtime/config";

const unsubscribeResultSchema = z.object({
  status: z.enum(["CREATED", "DUPLICATE"]),
  request_id: z.uuid(),
  correlation_id: z.uuid(),
});

export async function persistOneClickUnsubscribe(input: {
  config: RuntimeConfig;
  enrollmentId: string;
  tokenNonce: string;
  idempotencyKey: string;
}): Promise<z.infer<typeof unsubscribeResultSchema>> {
  if (!hasDedicatedSupabase(input.config) || !input.config.unsubscribeIngestSecret) {
    throw new Error("UNSUBSCRIBE_PERSISTENCE_UNAVAILABLE");
  }
  const proof = createUnsubscribeIngestProof({
    organizationId: input.config.organizationId,
    enrollmentId: input.enrollmentId,
    tokenNonce: input.tokenNonce,
    idempotencyKey: input.idempotencyKey,
    secret: input.config.unsubscribeIngestSecret,
  });
  const client = createClient(input.config.supabaseUrl, input.config.supabasePublishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const { data, error } = await client.rpc("apply_one_click_unsubscribe", {
    target_organization_id: input.config.organizationId,
    target_enrollment_id: input.enrollmentId,
    target_token_nonce: input.tokenNonce,
    target_idempotency_key: input.idempotencyKey,
    target_request_nonce: proof.requestNonce,
    target_request_expires_at_epoch: proof.requestExpiresAtEpoch,
    target_payload_sha256: proof.payloadSha256,
    target_request_signature: proof.requestSignature,
  });
  if (error) throw new Error("UNSUBSCRIBE_PERSISTENCE_UNAVAILABLE");
  return unsubscribeResultSchema.parse(data);
}
