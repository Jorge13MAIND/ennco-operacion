import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { createDispatchProof } from "@/lib/dispatch/proof";
import { hasDedicatedSupabase, type RuntimeConfig } from "@/lib/runtime/config";

/**
 * Cliente de las RPC del carril directo que corren SIN sesión (cron, callback
 * de OAuth y página pública de invitación). Cada llamada lleva la misma prueba
 * HMAC que el motor híbrido (app.verify_dispatch_proof, M032): la llave
 * pública de Supabase no autoriza nada por sí sola.
 *
 * Los builders de payload deben producir byte a byte lo que cada RPC
 * reconstruye en SQL: mismo orden, mismos coalesce('').
 */

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const directLaneClaimSchema = z.object({
  status: z.enum(["CLAIMED", "SHADOW_CLAIMED", "NOOP"]),
  reason: z.string().optional(),
  kind: z.enum(["TOUCH", "REPLY"]).optional(),
  message_id: z.uuid().optional(),
  mailbox_id: z.uuid().optional(),
  from_email: z.string().optional(),
  from_name: z.string().optional(),
  to_email: z.string().optional(),
  cc_emails: z.array(z.string()).optional(),
  subject: z.string().optional(),
  body_text: z.string().optional(),
  touch_number: z.number().int().min(1).max(8).nullable().optional(),
  thread: z.object({
    provider_thread_id: z.string().min(1),
    in_reply_to: z.string().min(3),
    references: z.array(z.string()).default([]),
  }).nullable().optional(),
  enrollment_id: z.uuid().optional(),
  sent_today: z.number().optional(),
  daily_cap: z.number().optional(),
  detail: z.unknown().optional(),
}).passthrough();

export type DirectLaneClaim = z.infer<typeof directLaneClaimSchema>;

export const directLaneCredentialSchema = z.object({
  ciphertext: z.string().min(40),
  key_id: z.string().min(10),
  credential_sha256: sha256Schema,
  normalized_email: z.string(),
  granted_scopes: z.array(z.string()),
}).passthrough();

export const directLaneMailboxHealthSchema = z.object({
  mailbox_id: z.uuid(),
  normalized_email: z.string(),
  domain: z.string(),
  sender_name: z.string(),
  status: z.enum(["DISCONNECTED", "CONNECTED", "PAUSED", "KILLED"]),
  credential_active: z.boolean(),
  credential_connected_at: z.string().nullable().optional(),
  ramp_mode: z.enum(["AUTO", "FIXED"]),
  fixed_cap: z.number(),
  cap_max: z.number(),
  effective_cap: z.number(),
  sent_today: z.number(),
  queued: z.number(),
  sent_total: z.number(),
  first_send_at: z.string().nullable().optional(),
  is_client_primary: z.boolean(),
  sync: z.object({
    status: z.string().nullable().optional(),
    last_history_id: z.string().nullable().optional(),
    last_synced_at: z.string().nullable().optional(),
    last_error_code: z.string().nullable().optional(),
  }).nullable().optional(),
  pending_invitation: z.object({ expires_at: z.string(), status: z.string(), created_at: z.string() }).nullable().optional(),
  last_error: z.string().nullable().optional(),
}).passthrough();

export const directLaneHealthSchema = z.object({
  mailboxes: z.array(directLaneMailboxHealthSchema),
  totals: z.object({
    sent_today: z.number(),
    shadow_today: z.number(),
    queued: z.number(),
    failed_today: z.number(),
    sent_total: z.number(),
    replies_unreviewed: z.number(),
    due_now: z.number(),
  }).passthrough(),
  flags: z.object({
    global_kill_switch: z.boolean(),
    external_send_allowed: z.boolean(),
    annex_a_ready: z.boolean(),
    send_window_open: z.boolean(),
    running_campaigns: z.number(),
  }).passthrough(),
  last_tick: z.object({ tick_kind: z.string(), outcome: z.string(), created_at: z.string(), mailbox_id: z.uuid().nullable().optional() }).nullable().optional(),
}).passthrough();

export type DirectLaneHealth = z.infer<typeof directLaneHealthSchema>;
export type DirectLaneMailboxHealth = z.infer<typeof directLaneMailboxHealthSchema>;

export class DirectLaneClientError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "DirectLaneClientError";
  }
}

type DedicatedConfig = RuntimeConfig & { supabaseUrl: string; supabasePublishableKey: string; organizationId: string; dispatchSecret: string };

function requireConfig(config: RuntimeConfig): asserts config is DedicatedConfig {
  if (!hasDedicatedSupabase(config) || !config.dispatchSecret) throw new DirectLaneClientError("DIRECT_LANE_CLIENT_UNAVAILABLE");
}

async function callRpc(config: RuntimeConfig, rpcName: string, payloadParts: readonly string[], args: Record<string, unknown>): Promise<unknown> {
  requireConfig(config);
  const proof = createDispatchProof({ organizationId: config.organizationId, commandName: rpcName, payloadParts, secret: config.dispatchSecret });
  const client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const { data, error } = await client.rpc(rpcName, { target_organization_id: config.organizationId, ...args, ...proof });
  if (error) throw new DirectLaneClientError(`DIRECT_LANE_RPC_${rpcName.toUpperCase()}_FAILED`);
  return data;
}

export async function readDirectLaneHealth(config: RuntimeConfig): Promise<DirectLaneHealth> {
  requireConfig(config);
  return directLaneHealthSchema.parse(await callRpc(config, "read_direct_lane_health", [config.organizationId], {}));
}

export async function claimDirectLaneDispatch(config: RuntimeConfig, mailboxId: string, dryRun: boolean): Promise<DirectLaneClaim> {
  requireConfig(config);
  return directLaneClaimSchema.parse(await callRpc(config, "claim_direct_lane_dispatch",
    [config.organizationId, mailboxId, dryRun ? "true" : "false"],
    { target_mailbox_id: mailboxId, dry_run: dryRun }));
}

export async function settleDirectLaneDispatch(config: RuntimeConfig, input: {
  messageId: string;
  outcome: "SENT" | "FAILED";
  providerMessageId?: string | null;
  providerThreadId?: string | null;
  rfcMessageId?: string | null;
  errorCode?: string | null;
}): Promise<{ status: string; outcome?: string }> {
  requireConfig(config);
  const providerMessageId = input.providerMessageId ?? null;
  const providerThreadId = input.providerThreadId ?? null;
  const rfcMessageId = input.rfcMessageId ?? null;
  const errorCode = input.errorCode ?? null;
  const data = await callRpc(config, "settle_direct_lane_dispatch",
    [config.organizationId, input.messageId, input.outcome, providerMessageId ?? "", providerThreadId ?? "", rfcMessageId ?? "", errorCode ?? ""],
    {
      target_message_id: input.messageId,
      target_outcome: input.outcome,
      target_provider_message_id: providerMessageId,
      target_provider_thread_id: providerThreadId,
      target_rfc_message_id: rfcMessageId,
      target_error_code: errorCode,
    });
  return z.object({ status: z.string(), outcome: z.string().optional() }).passthrough().parse(data);
}

export async function readDirectLaneCredential(config: RuntimeConfig, mailboxId: string) {
  requireConfig(config);
  return directLaneCredentialSchema.parse(await callRpc(config, "read_direct_lane_credential",
    [config.organizationId, mailboxId], { target_mailbox_id: mailboxId }));
}

export async function readDirectLaneInvitation(config: RuntimeConfig, tokenSha256: string) {
  requireConfig(config);
  return z.object({
    status: z.enum(["VALID", "INVALID"]),
    invitation_id: z.uuid().optional(),
    mailbox_id: z.uuid().optional(),
    normalized_email: z.string().optional(),
    sender_name: z.string().optional(),
    expires_at: z.string().optional(),
    is_client_primary: z.boolean().optional(),
  }).passthrough().parse(await callRpc(config, "read_direct_lane_invitation",
    [config.organizationId, tokenSha256], { target_token_sha256: tokenSha256 }));
}

export async function armDirectLaneAuthorization(config: RuntimeConfig, tokenSha256: string, stateSha256: string) {
  requireConfig(config);
  return z.object({ status: z.literal("ARMED"), authorization_id: z.uuid(), mailbox_id: z.uuid(), normalized_email: z.string() })
    .passthrough().parse(await callRpc(config, "arm_direct_lane_authorization",
      [config.organizationId, tokenSha256, stateSha256], { target_token_sha256: tokenSha256, target_state_sha256: stateSha256 }));
}

export async function completeDirectLaneAuthorization(config: RuntimeConfig, input: {
  stateSha256: string;
  normalizedEmail: string;
  googleSubjectSha256: string;
  ciphertext: string;
  keyId: string;
  credentialSha256: string;
  scopes: string[];
  tokenIssuedAt: string;
}) {
  requireConfig(config);
  return z.object({ status: z.enum(["CONNECTED", "DUPLICATE"]), credential_id: z.uuid(), mailbox_id: z.uuid(), normalized_email: z.string().optional() })
    .passthrough().parse(await callRpc(config, "complete_direct_lane_authorization",
      [config.organizationId, input.stateSha256, input.normalizedEmail, input.googleSubjectSha256, input.credentialSha256, input.keyId],
      {
        target_state_sha256: input.stateSha256,
        target_normalized_email: input.normalizedEmail,
        target_google_subject_sha256: input.googleSubjectSha256,
        target_ciphertext: input.ciphertext,
        target_key_id: input.keyId,
        target_credential_sha256: input.credentialSha256,
        target_scopes: input.scopes,
        target_token_issued_at: input.tokenIssuedAt,
      }));
}

/**
 * Resuelve el OUTBOUND de un hilo de Gmail. Existe porque la API de Gmail
 * REESCRIBE el Message-ID al enviar (verificado 4-sep: emite <CA...@mail.gmail.com>
 * e ignora nuestro <msg-uuid@dominio>), asi que el In-Reply-To de una
 * respuesta real casi nunca trae el molde de la plataforma. El threadId del
 * proveedor si es estable en ambos lados.
 */
export async function resolveDirectLaneOutbound(config: RuntimeConfig, input: {
  mailboxId: string;
  providerThreadId: string;
}): Promise<string | null> {
  requireConfig(config);
  const parsed = z.object({ status: z.string(), message_id: z.uuid().nullable() }).passthrough().parse(await callRpc(config, "resolve_direct_lane_outbound",
    [config.organizationId, input.mailboxId, input.providerThreadId],
    { target_mailbox_id: input.mailboxId, target_provider_thread_id: input.providerThreadId }));
  return parsed.message_id;
}

export async function annotateDirectLaneInbound(config: RuntimeConfig, input: {
  providerEventId: string;
  rfcMessageId: string | null;
  providerThreadId: string | null;
}) {
  requireConfig(config);
  return z.object({ status: z.string() }).passthrough().parse(await callRpc(config, "annotate_direct_lane_inbound",
    [config.organizationId, input.providerEventId, input.rfcMessageId ?? "", input.providerThreadId ?? ""],
    { target_provider_event_id: input.providerEventId, target_rfc_message_id: input.rfcMessageId, target_provider_thread_id: input.providerThreadId }));
}
