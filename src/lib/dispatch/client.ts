import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { createDispatchProof, dispatchPayloads } from "@/lib/dispatch/proof";
import { hasDedicatedSupabase, type RuntimeConfig } from "@/lib/runtime/config";

const claimResultSchema = z.object({
  status: z.enum(["CLAIMED", "NOOP", "BLOCKED"]),
  reason: z.string().optional(),
  message_id: z.uuid().optional(),
  release_id: z.uuid().optional(),
  manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  touch_number: z.number().int().min(1).max(3).optional(),
  to_email: z.string().optional(),
  subject: z.string().optional(),
  body_text: z.string().optional(),
  attempt: z.number().int().min(1).optional(),
  thread: z.object({
    provider_thread_id: z.string().min(1),
    previous_provider_message_id: z.string().min(1),
  }).nullable().optional(),
}).passthrough();

const settleResultSchema = z.object({
  status: z.enum(["SETTLED", "DUPLICATE", "BLOCKED"]),
}).passthrough();

const credentialResultSchema = z.object({
  ciphertext: z.string().min(24),
  kms_key_name: z.string().min(10),
  kms_key_version: z.string().min(1),
  credential_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  normalized_email: z.string(),
  granted_scopes: z.array(z.string()),
}).passthrough();

export type DispatchClaim = z.infer<typeof claimResultSchema>;
export type DispatchSettle = z.infer<typeof settleResultSchema>;
export type DispatchCredential = z.infer<typeof credentialResultSchema>;

export class DispatchClientError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "DispatchClientError";
  }
}

type DedicatedConfig = RuntimeConfig & { supabaseUrl: string; supabasePublishableKey: string; organizationId: string };

function requireDispatchConfig(config: RuntimeConfig): asserts config is DedicatedConfig & { dispatchSecret: string } {
  if (!hasDedicatedSupabase(config) || !config.dispatchSecret) {
    throw new DispatchClientError("DISPATCH_CLIENT_UNAVAILABLE");
  }
}

function supabase(config: DedicatedConfig) {
  return createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

async function callRpc(config: RuntimeConfig, rpcName: string, payloadParts: readonly string[], args: Record<string, unknown>): Promise<unknown> {
  requireDispatchConfig(config);
  const proof = createDispatchProof({
    organizationId: config.organizationId,
    commandName: rpcName,
    payloadParts,
    secret: config.dispatchSecret,
  });
  const { data, error } = await supabase(config).rpc(rpcName, {
    target_organization_id: config.organizationId,
    ...args,
    ...proof,
  });
  if (error) throw new DispatchClientError(`DISPATCH_RPC_${rpcName.toUpperCase()}_FAILED`);
  return data;
}

export async function runDispatchHeartbeat(config: RuntimeConfig): Promise<Record<string, unknown>> {
  requireDispatchConfig(config);
  const data = await callRpc(config, "run_dispatch_heartbeat", dispatchPayloads.runDispatchHeartbeat(config.organizationId), {});
  return z.record(z.string(), z.unknown()).parse(data);
}

export async function claimHybridDispatch(config: RuntimeConfig, dryRun: boolean): Promise<DispatchClaim> {
  requireDispatchConfig(config);
  const data = await callRpc(config, "claim_hybrid_dispatch", dispatchPayloads.claimHybridDispatch(config.organizationId, dryRun), {
    dry_run: dryRun,
  });
  return claimResultSchema.parse(data);
}

export async function settleHybridDispatch(config: RuntimeConfig, input: {
  messageId: string;
  outcome: "SENT" | "FAILED";
  providerMessageId?: string | null;
  providerThreadId?: string | null;
  errorCode?: string | null;
}): Promise<DispatchSettle> {
  requireDispatchConfig(config);
  const providerMessageId = input.providerMessageId ?? null;
  const providerThreadId = input.providerThreadId ?? null;
  const errorCode = input.errorCode ?? null;
  const data = await callRpc(
    config,
    "settle_hybrid_dispatch",
    dispatchPayloads.settleHybridDispatch(config.organizationId, input.messageId, input.outcome, providerMessageId, providerThreadId, errorCode),
    {
      target_message_id: input.messageId,
      target_outcome: input.outcome,
      target_provider_message_id: providerMessageId,
      target_provider_thread_id: providerThreadId,
      target_error_code: errorCode,
    },
  );
  return settleResultSchema.parse(data);
}

export async function readHybridDispatchCredential(config: RuntimeConfig, mailboxId: string): Promise<DispatchCredential> {
  requireDispatchConfig(config);
  const data = await callRpc(
    config,
    "read_hybrid_dispatch_credential",
    dispatchPayloads.readHybridDispatchCredential(config.organizationId, mailboxId),
    { target_mailbox_id: mailboxId },
  );
  return credentialResultSchema.parse(data);
}

export async function readDispatchHealth(config: RuntimeConfig): Promise<Record<string, unknown>> {
  requireDispatchConfig(config);
  const data = await callRpc(config, "read_dispatch_health", dispatchPayloads.readDispatchHealth(config.organizationId), {});
  return z.record(z.string(), z.unknown()).parse(data);
}

export async function claimDispatchOutbox(config: RuntimeConfig, batchSize: number): Promise<Record<string, unknown>> {
  requireDispatchConfig(config);
  const data = await callRpc(config, "claim_dispatch_outbox", dispatchPayloads.claimDispatchOutbox(config.organizationId, batchSize), {
    target_batch_size: batchSize,
  });
  return z.record(z.string(), z.unknown()).parse(data);
}

export async function completeDispatchOutboxEvent(config: RuntimeConfig, eventId: string): Promise<void> {
  requireDispatchConfig(config);
  await callRpc(config, "complete_dispatch_outbox_event", dispatchPayloads.completeDispatchOutboxEvent(config.organizationId, eventId), {
    target_event_id: eventId,
  });
}

export async function failDispatchOutboxEvent(config: RuntimeConfig, eventId: string, errorText: string): Promise<void> {
  requireDispatchConfig(config);
  await callRpc(config, "fail_dispatch_outbox_event", dispatchPayloads.failDispatchOutboxEvent(config.organizationId, eventId, errorText), {
    target_event_id: eventId,
    target_error: errorText,
  });
}

export async function applyDispatchProviderEvent(config: RuntimeConfig, input: {
  mailboxId: string;
  externalEventId: string | null;
  providerMessageId: string | null;
  relatedOutboundMessageId: string | null;
  eventKind: string;
  normalizedFrom: string | null;
  subject: string | null;
  bodyText: string | null;
  observedAtEpoch: number;
}): Promise<Record<string, unknown>> {
  requireDispatchConfig(config);
  const data = await callRpc(
    config,
    "apply_dispatch_provider_event",
    dispatchPayloads.applyDispatchProviderEvent({
      organizationId: config.organizationId,
      mailboxId: input.mailboxId,
      externalEventId: input.externalEventId,
      providerMessageId: input.providerMessageId,
      relatedOutboundMessageId: input.relatedOutboundMessageId,
      eventKind: input.eventKind,
      normalizedFrom: input.normalizedFrom,
      subject: input.subject,
      bodyText: input.bodyText,
      observedAtEpoch: input.observedAtEpoch,
    }),
    {
      target_mailbox_id: input.mailboxId,
      target_external_event_id: input.externalEventId,
      target_provider_message_id: input.providerMessageId,
      target_related_outbound_message_id: input.relatedOutboundMessageId,
      target_event_kind: input.eventKind,
      target_normalized_from: input.normalizedFrom,
      target_subject: input.subject,
      target_body_text: input.bodyText,
      target_observed_at: new Date(input.observedAtEpoch * 1000).toISOString(),
    },
  );
  return z.record(z.string(), z.unknown()).parse(data);
}

export async function updateDispatchSyncCursor(config: RuntimeConfig, input: {
  mailboxId: string;
  historyId: string | null;
  watchExpiresAtEpoch: number | null;
}): Promise<void> {
  requireDispatchConfig(config);
  await callRpc(
    config,
    "update_dispatch_sync_cursor",
    dispatchPayloads.updateDispatchSyncCursor(config.organizationId, input.mailboxId, input.historyId, input.watchExpiresAtEpoch),
    {
      target_mailbox_id: input.mailboxId,
      target_history_id: input.historyId,
      target_watch_expires_at: input.watchExpiresAtEpoch === null ? null : new Date(input.watchExpiresAtEpoch * 1000).toISOString(),
    },
  );
}
