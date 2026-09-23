import { z } from "zod";
import { readDirectLaneHealth, readDirectLaneCredential, resolveDirectLaneOutbound, recordEmailRecovery } from "@/lib/correos/client";
import { collectGmailRecovery, gmailRecoveryTransport } from "@/lib/correos/gmail-recovery";
import { gmailTransport } from "@/lib/correos/sync";
import { openDirectLaneSecret } from "@/lib/correos/vault";
import { getGmailAccessToken } from "@/lib/dispatch/gmail-token";
import { applyDispatchProviderEvent, updateDispatchSyncCursor } from "@/lib/dispatch/client";
import { extractReplyText } from "@/lib/gmail/body";
import { collectGmailHistory, classifyGmailMessage, extractGmailEventContext, type GmailMessageMetadata } from "@/lib/gmail/history";
import type { RuntimeConfig } from "@/lib/runtime/config";

// One mailbox per bounded invocation. No cursor advances before both the full
// interval and history after the initial profile fence are applied successfully.
export async function reconcileDirectMailbox(config: RuntimeConfig, mailboxId: string, since: string) {
  if (!config.organizationId || !config.directLaneVaultKey || !config.googleOauthClientId || !config.googleOauthClientSecret) throw new Error("RECOVERY_CONFIG_MISSING");
  const health = await readDirectLaneHealth(config);
  const mailbox = health.mailboxes.find(m => m.mailbox_id === mailboxId && m.credential_active);
  if (!mailbox) throw new Error("RECOVERY_MAILBOX_UNAVAILABLE");
  const credential = await readDirectLaneCredential(config, mailboxId);
  if (credential.normalized_email !== mailbox.normalized_email) throw new Error("RECOVERY_IDENTITY_MISMATCH");
  const refreshToken = openDirectLaneSecret({ ciphertext: credential.ciphertext, keyId: credential.key_id }, config.directLaneVaultKey);
  const token = await getGmailAccessToken({ refreshToken, credentialSha256: credential.credential_sha256, clientId: config.googleOauthClientId, clientSecret: config.googleOauthClientSecret });
  const transport = gmailRecoveryTransport(token);
  const recovered = await collectGmailRecovery({ tenantId: config.organizationId, mailboxId, expectedEmail: mailbox.normalized_email, fromEpochMs: Date.parse(since), transport });
  const counts = { listed: recovered.listedCount, inbound: recovered.messages.length, linked: 0, replies: 0, newEvents: 0, duplicates: 0 };
  const seen = new Set<string>();
  async function apply(message: GmailMessageMetadata) {
    if (seen.has(message.id) || message.labelIds?.some(l => l === "SENT" || l === "DRAFT")) return;
    seen.add(message.id);
    const context = extractGmailEventContext(message);
    const outbound = await resolveDirectLaneOutbound(config, { mailboxId, providerThreadId: message.threadId });
    if (!outbound) return;
    const kind = classifyGmailMessage(message);
    if (kind === "UNKNOWN") return;
    const body = extractReplyText(message);
    if ((kind === "REPLY" || kind === "AUTO_REPLY") && !body) throw new Error("RECOVERY_BODY_MISSING");
    const event = await applyDispatchProviderEvent(config, { mailboxId, externalEventId: message.id, providerMessageId: message.id,
      relatedOutboundMessageId: outbound, eventKind: kind, normalizedFrom: kind === "HARD_BOUNCE" ? context.failedRecipient ?? context.normalizedFrom : context.normalizedFrom,
      subject: context.subject, bodyText: body, observedAtEpoch: context.internalDateEpoch });
    if (!["PROCESSED", "DUPLICATE"].includes(String(event.status))) throw new Error("RECOVERY_EVENT_NOT_APPLIED");
    counts.linked++;
    if (event.status === "DUPLICATE") counts.duplicates++; else counts.newEvents++;
    if (kind === "REPLY" || kind === "AUTO_REPLY") {
      const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/threads/" + encodeURIComponent(message.threadId) + "?format=full", {
        headers: { authorization: "Bearer " + token }, signal: AbortSignal.timeout(15000), cache: "no-store",
      });
      if (!response.ok) throw new Error("RECOVERY_THREAD_UNAVAILABLE");
      const thread: unknown = await response.json();
      const recorded = await recordEmailRecovery(config, mailboxId, { kind: "MESSAGE", event_id: z.uuid().parse(event.provider_event_id),
        provider_message_id: message.id, provider_thread_id: message.threadId, body_text: body,
        rfc_message_id: message.payload.headers.find(h => h.name.toLowerCase() === "message-id")?.value ?? null, thread });
      if (recorded.status !== "RECORDED") throw new Error("RECOVERY_RECORD_UNCONFIRMED");
      if (kind === "REPLY") counts.replies++;
    }
  }
  for (const message of recovered.messages) await apply(message as GmailMessageMetadata);
  const replay = await collectGmailHistory({ transport: gmailTransport(token), startHistoryId: recovered.historyFence });
  for (const message of replay.messages) {
    const full = await transport.getMessage(message.id);
    if (full.status !== 200) throw new Error("RECOVERY_REPLAY_READ_FAILED");
    await apply(full.body as GmailMessageMetadata);
  }
  const recorded = await recordEmailRecovery(config, mailboxId, { kind: "COMPLETE", from_at: since,
    until_at: new Date(recovered.untilEpochMs).toISOString(), history_fence: recovered.historyFence, replayed_history_id: replay.historyId, counts });
  if (recorded.status !== "RECONCILED") throw new Error("RECOVERY_COMPLETION_UNCONFIRMED");
  const cursor = await updateDispatchSyncCursor(config, { mailboxId, historyId: replay.historyId, watchExpiresAtEpoch: null });
  return { state: "RECONCILED", mailboxId, counts, cursor, until: new Date(recovered.untilEpochMs).toISOString() };
}
