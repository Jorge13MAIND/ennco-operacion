import { randomUUID } from "node:crypto";
import { z } from "zod";
import { readDirectLaneHealth } from "@/lib/correos/client";
import { directLaneSendIsAmbiguous } from "@/lib/correos/dispatch";
import { DirectLaneGmailSender } from "@/lib/correos/gmail-send";
import { sdrMailboxToken } from "@/lib/correos/sdr/runner";
import type { RuntimeConfig } from "@/lib/runtime/config";

export type AlertEmailItem = {
  case_id: string; stage: "PRIMARY" | "BACKUP" | "NO_BACKUP" | "OVERDUE";
  pending_minutes: number; owner_email: string | null; backup_email: string | null;
};
export type AlertEmailOutcome = "ACCEPTED" | "UNAVAILABLE" | "AMBIGUOUS";

export function alertRecipients(item: AlertEmailItem): { to: string; cc: string[] } | null {
  const owner = z.email().safeParse(item.owner_email);
  const backup = z.email().safeParse(item.backup_email);
  if (item.stage === "BACKUP") return backup.success ? { to: backup.data, cc: [] } : null;
  if (item.stage === "OVERDUE" && backup.success) return {
    to: backup.data, cc: owner.success && owner.data !== backup.data ? [owner.data] : [],
  };
  return owner.success ? { to: owner.data, cc: [] } : null;
}

/** Internal notification only. It never selects a prospect or alters a campaign. */
export async function sendSdrAlertEmail(config: RuntimeConfig, item: AlertEmailItem, deps: {
  health?: typeof readDirectLaneHealth;
  token?: typeof sdrMailboxToken;
  sender?: (accessToken: string) => Pick<DirectLaneGmailSender, "send">;
} = {}): Promise<AlertEmailOutcome> {
  const recipients = alertRecipients(item);
  if (!recipients) return "UNAVAILABLE";
  let token: string;
  let mailboxEmail: string;
  try {
    const health = await (deps.health ?? readDirectLaneHealth)(config);
    const mailbox = health.mailboxes.find(m => m.is_client_primary && m.status === "CONNECTED" && m.credential_active);
    if (!mailbox) return "UNAVAILABLE";
    mailboxEmail = mailbox.normalized_email;
    token = await (deps.token ?? sdrMailboxToken)(config, { mailbox_id: mailbox.mailbox_id, mailbox_email: mailboxEmail });
  } catch { return "UNAVAILABLE"; }
  const subject = `ENNCO: respuesta sin acuse ${item.case_id.slice(0, 8)} (${item.stage})`;
  const body = `Hay una respuesta comercial pendiente de acuse desde hace ${item.pending_minutes} minutos.\n\nCaso: ${item.case_id}\nAcción: entra al Control Room de ENNCO, abre Correos y confirma la recepción o registra el siguiente paso.\n\nEste aviso interno no clasifica un lead ni responde al prospecto.`;
  let sender: Pick<DirectLaneGmailSender, "send">;
  try { sender = deps.sender ? deps.sender(token) : new DirectLaneGmailSender({ accessToken: token }); }
  catch { return "UNAVAILABLE"; }
  try {
    await sender.send({ message_id: randomUUID(), from_name: "ENNCO Control Room", from_email: mailboxEmail,
      to_email: recipients.to, cc_emails: recipients.cc, subject, body_text: body,
      kind: "TOUCH", touch_number: 1, thread: null, list_unsubscribe_url: null, open_pixel_url: null });
    return "ACCEPTED";
  } catch (error) {
    return directLaneSendIsAmbiguous(error) ? "AMBIGUOUS" : "UNAVAILABLE";
  }
}
