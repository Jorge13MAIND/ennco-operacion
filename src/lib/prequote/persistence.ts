import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { createPrequoteIngestProof } from "@/lib/prequote/ingest-proof";
import type { RuntimeConfig } from "@/lib/runtime/config";
import { hasDedicatedSupabase } from "@/lib/runtime/config";

const persistenceResultSchema = z.object({
  status: z.enum(["CREATED", "DUPLICATE"]),
  record_id: z.uuid(),
  folio: z.string().regex(/^ENN-PRE-[A-F0-9]{8}$/),
  correlation_id: z.uuid(),
});

export type PrequotePersistenceResult = z.infer<typeof persistenceResultSchema>;

export class PrequotePersistenceError extends Error {
  constructor(public readonly code: "RATE_LIMIT" | "MODEL_NOT_APPROVED" | "UNAVAILABLE") {
    super(code);
    this.name = "PrequotePersistenceError";
  }
}

function mapPersistenceError(message: string): PrequotePersistenceError {
  if (message.includes("PUBLIC_PREQUOTE_RATE_LIMIT_EXCEEDED")) {
    return new PrequotePersistenceError("RATE_LIMIT");
  }
  if (message.includes("PUBLIC_PREQUOTE_MODEL_NOT_APPROVED")) {
    return new PrequotePersistenceError("MODEL_NOT_APPROVED");
  }
  return new PrequotePersistenceError("UNAVAILABLE");
}

export function getTrustedClientAddress(request: Request, appEnv: RuntimeConfig["appEnv"]): string {
  const trustedHeader = request.headers.get("x-vercel-forwarded-for");
  const localHeader = appEnv === "development" ? request.headers.get("x-forwarded-for") : null;
  const rawAddress = (trustedHeader ?? localHeader)?.split(",")[0]?.trim();
  if (!rawAddress || rawAddress.length > 64 || !/^[0-9a-f:.]+$/i.test(rawAddress)) {
    throw new PrequotePersistenceError("UNAVAILABLE");
  }
  return rawAddress;
}

export async function persistPrequote(input: {
  config: RuntimeConfig;
  idempotencyKey: string;
  clientAddress: string;
  payload: unknown;
}): Promise<PrequotePersistenceResult> {
  if (!hasDedicatedSupabase(input.config) || !input.config.prequoteIngestSecret) {
    throw new PrequotePersistenceError("UNAVAILABLE");
  }

  const proof = createPrequoteIngestProof({
    organizationId: input.config.organizationId,
    idempotencyKey: input.idempotencyKey,
    clientAddress: input.clientAddress,
    payload: input.payload,
    secret: input.config.prequoteIngestSecret,
  });
  const supabase = createClient(input.config.supabaseUrl, input.config.supabasePublishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const { data, error } = await supabase.rpc("create_public_prequote", {
    target_organization_id: input.config.organizationId,
    target_idempotency_key: input.idempotencyKey,
    target_request_nonce: proof.requestNonce,
    target_request_expires_at_epoch: proof.requestExpiresAtEpoch,
    target_payload_sha256: proof.payloadSha256,
    target_request_signature: proof.requestSignature,
    target_rate_limit_key_sha256: proof.rateLimitKeySha256,
    target_payload_text: proof.payloadText,
  });

  if (error) throw mapPersistenceError(error.message);
  const parsed = persistenceResultSchema.safeParse(data);
  if (!parsed.success) throw new PrequotePersistenceError("UNAVAILABLE");
  return parsed.data;
}
