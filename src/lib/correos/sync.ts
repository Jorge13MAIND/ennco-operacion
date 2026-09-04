import { z } from "zod";

import { annotateDirectLaneInbound, readDirectLaneCredential, readDirectLaneHealth, resolveDirectLaneOutbound, type DirectLaneMailboxHealth } from "@/lib/correos/client";
import { openDirectLaneSecret } from "@/lib/correos/vault";
import { applyDispatchProviderEvent, updateDispatchSyncCursor } from "@/lib/dispatch/client";
import { getGmailAccessToken } from "@/lib/dispatch/gmail-token";
import { classifyGmailMessage, collectGmailHistory, extractGmailEventContext, GmailHistoryResetRequiredError, type GmailHistoryTransport, type GmailMessageMetadata } from "@/lib/gmail/history";
import type { RuntimeConfig } from "@/lib/runtime/config";

/**
 * Sync de respuestas del carril directo por SONDEO, no por push. El carril
 * híbrido depende de Pub/Sub (GMAIL_PUBSUB_*), que nunca se configuró; aquí
 * cada tick lee el history de Gmail desde el cursor guardado en
 * mailbox_sync_cursors y aplica los eventos con la misma máquina canónica
 * (apply_dispatch_provider_event → REPLY / AUTO_REPLY / HARD_BOUNCE).
 *
 * Primer arranque: sin cursor se toma el historyId actual del perfil y se
 * guarda; lo anterior a ese momento no se procesa (no hay envíos anteriores).
 */

const profileSchema = z.object({ historyId: z.string().regex(/^[0-9]+$/u) }).passthrough();

export type DirectLaneSyncSummary = {
  mailboxes: Array<{ mailbox_id: string; email: string; result: string; replies: number; events: number; detail?: string }>;
  appliedReplyEvents: number;
};

type SyncTransport = GmailHistoryTransport & { getProfile(): Promise<{ status: number; body: unknown }> };

function gmailTransport(accessToken: string, fetchImpl: typeof fetch = fetch): SyncTransport {
  const call = async (url: string) => {
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    const body: unknown = await response.json().catch(() => null);
    return { status: response.status, body };
  };
  return {
    getProfile: () => call("https://gmail.googleapis.com/gmail/v1/users/me/profile"),
    listHistory: (startHistoryId, pageToken) => call(
      `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${encodeURIComponent(startHistoryId)}&historyTypes=messageAdded&labelId=INBOX${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
    ),
    getMessage: (messageId) => call(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=metadata`),
  };
}

function headerValue(message: GmailMessageMetadata, name: string): string | null {
  return message.payload.headers.find((header) => header.name.toLowerCase() === name)?.value ?? null;
}

export function mailboxesEligibleForSync(mailboxes: DirectLaneMailboxHealth[]): DirectLaneMailboxHealth[] {
  return mailboxes.filter((mailbox) => (mailbox.status === "CONNECTED" || mailbox.status === "PAUSED") && mailbox.credential_active);
}

type SyncDependencies = {
  readHealth?: typeof readDirectLaneHealth;
  readCredential?: typeof readDirectLaneCredential;
  accessToken?: typeof getGmailAccessToken;
  transport?: (accessToken: string) => SyncTransport;
  applyEvent?: typeof applyDispatchProviderEvent;
  updateCursor?: typeof updateDispatchSyncCursor;
  annotate?: typeof annotateDirectLaneInbound;
  resolveOutbound?: typeof resolveDirectLaneOutbound;
};

export async function runDirectLaneSync(config: RuntimeConfig, deps: SyncDependencies = {}): Promise<DirectLaneSyncSummary> {
  const readHealth = deps.readHealth ?? readDirectLaneHealth;
  const readCredential = deps.readCredential ?? readDirectLaneCredential;
  const issueToken = deps.accessToken ?? getGmailAccessToken;
  const transportFor = deps.transport ?? ((token: string) => gmailTransport(token));
  const applyEvent = deps.applyEvent ?? applyDispatchProviderEvent;
  const updateCursor = deps.updateCursor ?? updateDispatchSyncCursor;
  const annotate = deps.annotate ?? annotateDirectLaneInbound;
  const resolveOutbound = deps.resolveOutbound ?? resolveDirectLaneOutbound;
  const summary: DirectLaneSyncSummary = { mailboxes: [], appliedReplyEvents: 0 };
  if (!config.directLaneVaultKey || !config.googleOauthClientId || !config.googleOauthClientSecret) return summary;

  const health = await readHealth(config);
  for (const mailbox of mailboxesEligibleForSync(health.mailboxes)) {
    const entry: DirectLaneSyncSummary["mailboxes"][number] = { mailbox_id: mailbox.mailbox_id, email: mailbox.normalized_email, result: "OK", replies: 0, events: 0 };
    summary.mailboxes.push(entry);
    try {
      const credential = await readCredential(config, mailbox.mailbox_id);
      const refreshToken = openDirectLaneSecret({ ciphertext: credential.ciphertext, keyId: credential.key_id }, config.directLaneVaultKey);
      const accessToken = await issueToken({ refreshToken, credentialSha256: credential.credential_sha256, clientId: config.googleOauthClientId, clientSecret: config.googleOauthClientSecret });
      const transport = transportFor(accessToken);
      const cursor = mailbox.sync?.last_history_id ?? null;
      if (!cursor) {
        const profile = await transport.getProfile();
        if (profile.status !== 200) throw new Error("GMAIL_PROFILE_UNAVAILABLE");
        const { historyId } = profileSchema.parse(profile.body);
        await updateCursor(config, { mailboxId: mailbox.mailbox_id, historyId, watchExpiresAtEpoch: null });
        entry.result = "CURSOR_BOOTSTRAPPED";
        continue;
      }
      let collected;
      try {
        collected = await collectGmailHistory({ transport, startHistoryId: cursor });
      } catch (error) {
        if (error instanceof GmailHistoryResetRequiredError) {
          const profile = await transport.getProfile();
          if (profile.status !== 200) throw new Error("GMAIL_PROFILE_UNAVAILABLE");
          const { historyId } = profileSchema.parse(profile.body);
          await updateCursor(config, { mailboxId: mailbox.mailbox_id, historyId, watchExpiresAtEpoch: null });
          entry.result = "CURSOR_RESET";
          continue;
        }
        throw error;
      }
      for (const message of collected.messages) {
        const kind = classifyGmailMessage(message);
        if (kind === "UNKNOWN") continue;
        const context = extractGmailEventContext(message);
        // Gmail reescribe el Message-ID al enviar (emite <CA...@mail.gmail.com>
        // en lugar del <msg-uuid@dominio> nuestro), asi que el In-Reply-To de
        // una respuesta real NO trae el molde de la plataforma. Cuando el
        // encabezado no resuelve, el hilo del proveedor es el enlace estable:
        // se busca el ultimo OUTBOUND nuestro con el mismo threadId.
        let relatedOutbound = context.relatedOutboundMessageId;
        if (!relatedOutbound && message.threadId) {
          relatedOutbound = await resolveOutbound(config, { mailboxId: mailbox.mailbox_id, providerThreadId: message.threadId }).catch(() => null);
        }
        // Sin enlace por encabezado NI por hilo no es respuesta a algo nuestro.
        if (!relatedOutbound) continue;
        const applied = await applyEvent(config, {
          mailboxId: mailbox.mailbox_id,
          externalEventId: message.id,
          providerMessageId: message.id,
          relatedOutboundMessageId: relatedOutbound,
          eventKind: kind,
          normalizedFrom: kind === "HARD_BOUNCE" ? context.failedRecipient ?? context.normalizedFrom : context.normalizedFrom,
          subject: context.subject,
          bodyText: null,
          observedAtEpoch: context.internalDateEpoch,
        });
        entry.events += 1;
        if (kind === "REPLY") {
          entry.replies += 1;
          summary.appliedReplyEvents += 1;
          const providerEventId = z.object({ provider_event_id: z.uuid().optional() }).passthrough().safeParse(applied).data?.provider_event_id;
          if (providerEventId) {
            await annotate(config, { providerEventId, rfcMessageId: headerValue(message, "message-id"), providerThreadId: message.threadId }).catch(() => undefined);
          }
        }
      }
      await updateCursor(config, { mailboxId: mailbox.mailbox_id, historyId: collected.historyId, watchExpiresAtEpoch: null });
    } catch (error) {
      entry.result = "SYNC_FAILED";
      entry.detail = error instanceof Error ? error.message.slice(0, 120) : "unknown";
    }
  }
  return summary;
}
