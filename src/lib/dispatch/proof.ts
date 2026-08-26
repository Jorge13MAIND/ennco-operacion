import { createHash, createHmac, randomUUID } from "node:crypto";

export type DispatchProof = {
  proof_command_id: string;
  proof_nonce: string;
  proof_expires_at: string;
  proof_signature: string;
};

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function formatExpiry(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/u, "Z");
}

/**
 * Prueba HMAC del motor de despacho (M032). Espejo exacto de
 * app.verify_dispatch_proof: signed_value = concat_ws('\n', organization_id,
 * command_id, nonce, expires_at UTC YYYY-MM-DDTHH:MM:SSZ, payload_sha256),
 * HMAC-SHA256 hex contra app.private_runtime_config.dispatch_secret. El
 * payload_sha256 lo recalcula el servidor de los argumentos canónicos: los
 * builders de abajo deben producir byte a byte lo que cada RPC reconstruye.
 */
export function createDispatchProof(input: {
  organizationId: string;
  commandName: string;
  payloadParts: readonly string[];
  secret: string;
  ttlSeconds?: number;
}): DispatchProof {
  if (input.secret.length < 32) throw new Error("DISPATCH_SECRET_INVALID");
  const nonce = randomUUID();
  const expiresAt = formatExpiry(new Date(Date.now() + (input.ttlSeconds ?? 300) * 1000));
  // El command_id identifica LA INVOCACIÓN (el ledger de ticks lo usa como
  // llave de idempotencia para que un reintento caiga en la misma fila). Un
  // valor constante colapsaría todos los ticks de un tipo en una sola fila.
  // El payload firmado usa el nombre canónico del comando, que el servidor
  // recalcula por su cuenta.
  const commandId = `${input.commandName}:${nonce}`;
  const payloadSha256 = sha256Hex([input.commandName, ...input.payloadParts].join("\n"));
  const signature = createHmac("sha256", input.secret).update([
    input.organizationId,
    commandId,
    nonce,
    expiresAt,
    payloadSha256,
  ].join("\n"), "utf8").digest("hex");
  return {
    proof_command_id: commandId,
    proof_nonce: nonce,
    proof_expires_at: expiresAt,
    proof_signature: signature,
  };
}

export const dispatchPayloads = {
  runDispatchHeartbeat: (organizationId: string) => [organizationId],
  claimHybridDispatch: (organizationId: string, dryRun: boolean) => [organizationId, dryRun ? "true" : "false"],
  settleHybridDispatch: (
    organizationId: string,
    messageId: string,
    outcome: string,
    providerMessageId: string | null,
    providerThreadId: string | null,
    errorCode: string | null,
  ) => [organizationId, messageId, outcome, providerMessageId ?? "", providerThreadId ?? "", errorCode ?? ""],
  readHybridDispatchCredential: (organizationId: string, mailboxId: string) => [organizationId, mailboxId],
  claimDispatchOutbox: (organizationId: string, batchSize: number) => [organizationId, String(batchSize)],
  completeDispatchOutboxEvent: (organizationId: string, eventId: string) => [organizationId, eventId],
  failDispatchOutboxEvent: (organizationId: string, eventId: string, error: string | null) => [organizationId, eventId, error ?? ""],
  applyDispatchProviderEvent: (input: {
    organizationId: string;
    mailboxId: string;
    externalEventId: string | null;
    providerMessageId: string | null;
    relatedOutboundMessageId: string | null;
    eventKind: string | null;
    normalizedFrom: string | null;
    subject: string | null;
    bodyText: string | null;
    observedAtEpoch: number | null;
  }) => [
    input.organizationId,
    input.mailboxId,
    input.externalEventId ?? "",
    input.providerMessageId ?? "",
    input.relatedOutboundMessageId ?? "",
    input.eventKind ?? "",
    input.normalizedFrom ?? "",
    sha256Hex(input.subject ?? ""),
    sha256Hex(input.bodyText ?? ""),
    input.observedAtEpoch === null ? "" : String(input.observedAtEpoch),
  ],
  updateDispatchSyncCursor: (
    organizationId: string,
    mailboxId: string,
    historyId: string | null,
    watchExpiresAtEpoch: number | null,
  ) => [organizationId, mailboxId, historyId ?? "", watchExpiresAtEpoch === null ? "" : String(watchExpiresAtEpoch)],
  readDispatchHealth: (organizationId: string) => [organizationId],
} as const;
