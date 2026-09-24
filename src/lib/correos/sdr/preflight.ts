import { sdrCommand, sdrWorkItemSchema } from "@/lib/correos/sdr/client";
import { evaluateConversation } from "@/lib/correos/sdr/policy";
import { readSdrThread } from "@/lib/correos/sdr/runner";
import type { DirectLaneClaim } from "@/lib/correos/client";
import type { RuntimeConfig } from "@/lib/runtime/config";
/** Runs inside the existing sender immediately before its one Gmail POST. */
export async function preflightSdrSend(config: RuntimeConfig, caseId: string, messageId: string, token: string, claim: DirectLaneClaim) {
  const current = await sdrCommand(config, { op: "SEND_CONTEXT", case_id: caseId, message_id: messageId });
  if (current.status !== "SEND_CONTEXT") throw new Error("SDR_SEND_HELD");
  const item = sdrWorkItemSchema.parse(current);
  if (claim.from_email?.toLowerCase() !== item.mailbox_email.toLowerCase() || claim.to_email?.toLowerCase() !== item.contact_email.toLowerCase()
    || claim.kind !== "REPLY" || claim.thread?.provider_thread_id !== item.provider_thread_id || !claim.thread?.in_reply_to) throw new Error("SDR_ENVELOPE_MISMATCH");
  if (!item.provider_thread_id || !item.provider_message_id) throw new Error("SDR_SEND_THREAD_MISSING");
  const thread = await readSdrThread(token, item.provider_thread_id);
  const checkedAt = Date.now();
  const checked = evaluateConversation({ body: item.body, providerMessageId: item.provider_message_id, providerThreadId: item.provider_thread_id,
    mailboxEmail: item.mailbox_email, contactEmail: item.contact_email, ownerId: item.owner_id, suppressed: item.suppressed,
    thread, ownSdrMessageIds: item.own_sdr_message_ids, now: checkedAt, capturedAt: checkedAt });
  if (checked.gates.length) throw new Error("SDR_SEND_CONVERSATION_CHANGED");
  // Recheck suppression and runtime after the provider read, not only at enqueue.
  const final = await sdrCommand(config, { op: "SEND_CONTEXT", case_id: caseId, message_id: messageId });
  if (final.status !== "SEND_CONTEXT") throw new Error("SDR_SEND_HELD");
}
