import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { createPrequoteIngestProof } from "@/lib/prequote/ingest-proof";
import type { RuntimeConfig } from "@/lib/runtime/config";
import { hasDedicatedSupabase } from "@/lib/runtime/config";

export const ANALYTICS_EVENT_NAMES = [
  "DIAGNOSTIC_VIEWED",
  "PREQUOTE_STARTED",
  "PREQUOTE_SUBMITTED",
  "PREQUOTE_SUCCEEDED",
  "PREQUOTE_FAILED",
  "PDF_DOWNLOADED",
] as const;

export const analyticsEventInputSchema = z.object({
  eventName: z.enum(ANALYTICS_EVENT_NAMES),
  sessionId: z.uuid(),
  correlationId: z.uuid().nullable().optional(),
  path: z.enum(["/diagnostico", "/privacidad"]),
  properties: z.object({
    estimate_kind: z.enum(["SOLAR_RANGE", "SERVICE_REVIEW"]).optional(),
    verdict: z.enum(["OUT_OF_SCOPE", "COMMERCIAL_REVIEW", "INDUSTRIAL_REVIEW", "TECHNICAL_REVIEW"]).optional(),
    error_code: z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/).optional(),
    model_version: z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/).optional(),
  }).strict().default({}),
  occurredAt: z.iso.datetime({ offset: true }),
}).strict();

export type AnalyticsEventInput = z.infer<typeof analyticsEventInputSchema>;

const persistenceResultSchema = z.object({
  status: z.enum(["CREATED", "DUPLICATE"]),
  event_id: z.uuid(),
});

export class AnalyticsPersistenceError extends Error {
  constructor(public readonly code: "RATE_LIMIT" | "UNAVAILABLE") {
    super(code);
    this.name = "AnalyticsPersistenceError";
  }
}

export async function persistAnalyticsEvent(input: {
  config: RuntimeConfig;
  idempotencyKey: string;
  clientAddress: string;
  event: AnalyticsEventInput;
}): Promise<z.infer<typeof persistenceResultSchema>> {
  if (!hasDedicatedSupabase(input.config) || !input.config.prequoteIngestSecret) {
    throw new AnalyticsPersistenceError("UNAVAILABLE");
  }

  const proof = createPrequoteIngestProof({
    organizationId: input.config.organizationId,
    idempotencyKey: input.idempotencyKey,
    clientAddress: input.clientAddress,
    payload: { ...input.event, evidenceClass: "live" },
    secret: input.config.prequoteIngestSecret,
  });
  const supabase = createClient(input.config.supabaseUrl, input.config.supabasePublishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const { data, error } = await supabase.rpc("capture_public_analytics_event", {
    target_organization_id: input.config.organizationId,
    target_idempotency_key: input.idempotencyKey,
    target_request_nonce: proof.requestNonce,
    target_request_expires_at_epoch: proof.requestExpiresAtEpoch,
    target_payload_sha256: proof.payloadSha256,
    target_request_signature: proof.requestSignature,
    target_rate_limit_key_sha256: proof.rateLimitKeySha256,
    target_payload_text: proof.payloadText,
  });
  if (error) {
    if (error.message.includes("ANALYTICS_RATE_LIMIT_EXCEEDED")) {
      throw new AnalyticsPersistenceError("RATE_LIMIT");
    }
    throw new AnalyticsPersistenceError("UNAVAILABLE");
  }
  const parsed = persistenceResultSchema.safeParse(data);
  if (!parsed.success) throw new AnalyticsPersistenceError("UNAVAILABLE");
  return parsed.data;
}
