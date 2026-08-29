import { z } from "zod";

import {
  applyDispatchProviderEvent,
  claimDispatchOutbox,
  completeDispatchOutboxEvent,
  failDispatchOutboxEvent,
  readHybridDispatchCredential,
  updateDispatchSyncCursor,
} from "@/lib/dispatch/client";
import { getGmailAccessToken } from "@/lib/dispatch/gmail-token";
import { classifyGmailMessage, collectGmailHistory, extractGmailEventContext, GmailHistoryResetRequiredError, type GmailHistoryTransport } from "@/lib/gmail/history";
import { createGoogleKmsEnvelopeClient } from "@/lib/gmail/oauth-server";
import type { RuntimeConfig } from "@/lib/runtime/config";

/**
 * Identidad mínima que TODO evento del outbox trae. Se valida aparte del
 * payload de Gmail a propósito: antes un solo esquema exigía las dos cosas, y
 * cualquier evento ajeno (incident.opened, control_cadence.*) fallaba el parseo
 * y se abandonaba con `continue` SIN marcarse. Quedaba PENDING para siempre, el
 * watchdog lo veía detenido y abría un incidente, que generaba otro evento: el
 * bucle exponencial de 2,522 incidentes del 26-27 de agosto (M036). Y como
 * isControlCadenceReleaseAllowed exige open_p1 = 0, ningún envío podía salir.
 *
 * INVARIANTE: todo evento reclamado sale del limbo, completado o fallado.
 */
const outboxEventSchema = z.object({
  id: z.uuid(),
  event_type: z.string(),
}).passthrough();

const gmailSyncPayloadSchema = z.object({
  mailbox_id: z.uuid(),
  history_id: z.string().regex(/^[0-9]+$/u),
}).passthrough();

const outboxClaimSchema = z.object({
  events: z.array(z.unknown()).default([]),
}).passthrough();

function gmailTransport(accessToken: string): GmailHistoryTransport {
  const call = async (url: string) => {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const body: unknown = await response.json().catch(() => null);
    return { status: response.status, body };
  };
  return {
    listHistory: (startHistoryId, pageToken) => call(
      `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${encodeURIComponent(startHistoryId)}&historyTypes=messageAdded${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
    ),
    getMessage: (messageId) => call(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=metadata`,
    ),
  };
}

export type GmailSyncSummary = {
  processedEvents: number;
  appliedProviderEvents: number;
  failedEvents: number;
  fullResyncRequested: boolean;
};

/**
 * Drena el outbox de gmail.history_sync_requested y aplica los eventos de
 * proveedor (REPLY / AUTO_REPLY / HARD_BOUNCE) contra la máquina canónica.
 * v1 usa el history_id del push como punto de partida; el sweep diario del
 * watchdog es la red para huecos. Un 404 de historia marca resync completo.
 */
export async function runGmailSync(config: RuntimeConfig, batchSize = 5): Promise<GmailSyncSummary> {
  const summary: GmailSyncSummary = { processedEvents: 0, appliedProviderEvents: 0, failedEvents: 0, fullResyncRequested: false };
  if (!config.googleKmsKeyName || !config.googleOauthClientId || !config.googleOauthClientSecret) return summary;

  const claim = outboxClaimSchema.parse(await claimDispatchOutbox(config, batchSize));
  const kms = createGoogleKmsEnvelopeClient(config.googleKmsKeyName);
  const tokenByMailbox = new Map<string, string>();

  for (const rawEvent of claim.events) {
    const parsedEvent = outboxEventSchema.safeParse(rawEvent);
    if (!parsedEvent.success) {
      // Sin id no hay forma de marcarlo; se cuenta para que el resumen lo delate.
      summary.failedEvents += 1;
      continue;
    }
    const event = parsedEvent.data;
    if (event.event_type !== "gmail.history_sync_requested") {
      await completeDispatchOutboxEvent(config, event.id).catch(() => undefined);
      continue;
    }
    const parsedPayload = gmailSyncPayloadSchema.safeParse(
      (rawEvent as { payload_json?: unknown }).payload_json,
    );
    if (!parsedPayload.success) {
      summary.failedEvents += 1;
      await failDispatchOutboxEvent(config, event.id, "GMAIL_SYNC_PAYLOAD_INVALID").catch(() => undefined);
      continue;
    }
    const mailboxId = parsedPayload.data.mailbox_id;
    try {
      let accessToken = tokenByMailbox.get(mailboxId);
      if (!accessToken) {
        const credential = await readHybridDispatchCredential(config, mailboxId);
        const refreshToken = await kms.decryptText({ ciphertext: credential.ciphertext, keyName: credential.kms_key_name });
        accessToken = await getGmailAccessToken({
          refreshToken,
          credentialSha256: credential.credential_sha256,
          clientId: config.googleOauthClientId,
          clientSecret: config.googleOauthClientSecret,
        });
        tokenByMailbox.set(mailboxId, accessToken);
      }
      const collected = await collectGmailHistory({
        transport: gmailTransport(accessToken),
        startHistoryId: parsedPayload.data.history_id,
      });
      for (const message of collected.messages) {
        const kind = classifyGmailMessage(message);
        if (kind === "UNKNOWN") continue;
        const context = extractGmailEventContext(message);
        await applyDispatchProviderEvent(config, {
          mailboxId,
          externalEventId: message.id,
          providerMessageId: message.id,
          relatedOutboundMessageId: context.relatedOutboundMessageId,
          eventKind: kind,
          normalizedFrom: kind === "HARD_BOUNCE" ? context.failedRecipient ?? context.normalizedFrom : context.normalizedFrom,
          subject: context.subject,
          bodyText: null,
          observedAtEpoch: context.internalDateEpoch,
        });
        summary.appliedProviderEvents += 1;
      }
      await updateDispatchSyncCursor(config, { mailboxId, historyId: collected.historyId, watchExpiresAtEpoch: null });
      await completeDispatchOutboxEvent(config, event.id);
      summary.processedEvents += 1;
    } catch (error) {
      summary.failedEvents += 1;
      if (error instanceof GmailHistoryResetRequiredError) summary.fullResyncRequested = true;
      const code = error instanceof Error ? error.message.slice(0, 180) : "GMAIL_SYNC_UNKNOWN_ERROR";
      await failDispatchOutboxEvent(config, event.id, code).catch(() => undefined);
    }
  }
  return summary;
}
