import { randomUUID } from "node:crypto";
import { z } from "zod";
import { readDirectLaneHealth } from "@/lib/correos/client";
import { directLaneSendIsAmbiguous } from "@/lib/correos/dispatch";
import { DirectLaneGmailSender } from "@/lib/correos/gmail-send";
import { sdrMailboxToken } from "@/lib/correos/sdr/runner";
import { company, contactLines, intentLabel, replyExcerpt, systemAction, who, type CaseContext } from "@/lib/correos/sdr/case-context";
import type { RuntimeConfig } from "@/lib/runtime/config";

export type AlertEmailItem = {
  case_id: string; stage: "PRIMARY" | "BACKUP" | "NO_BACKUP" | "OVERDUE";
  pending_minutes: number; owner_email: string | null; backup_email: string | null;
  cc_emails?: string[]; context?: CaseContext | null;
};
export type AlertEmailOutcome = "ACCEPTED" | "UNAVAILABLE" | "AMBIGUOUS";

export function alertRecipients(item: AlertEmailItem): { to: string; cc: string[] } | null {
  const owner = z.email().safeParse(item.owner_email);
  const backup = z.email().safeParse(item.backup_email);
  // 9-oct (Grant): Oscar coordina los positivos y va en copia de todos los avisos.
  const withExtra = (to: string, cc: string[]) => ({ to, cc: [...new Set([...cc, ...(item.cc_emails ?? [])]
    .map(e => e.trim().toLowerCase()).filter(e => z.email().safeParse(e).success && e !== to))].slice(0, 5) });
  if (item.stage === "BACKUP") return backup.success ? withExtra(backup.data, []) : null;
  if (item.stage === "OVERDUE" && backup.success) return withExtra(backup.data, owner.success && owner.data !== backup.data ? [owner.data] : []);
  return owner.success ? withExtra(owner.data, []) : null;
}

const STAGE_TEXT: Record<AlertEmailItem["stage"], string> = {
  PRIMARY: "Este aviso: la respuesta lleva {m} minutos sin acuse en el Control Room.",
  BACKUP: "Este aviso: lleva {m} minutos sin acuse; te llega como respaldo.",
  NO_BACKUP: "Este aviso: lleva {m} minutos sin acuse y no hay respaldo configurado.",
  OVERDUE: "Este aviso: lleva {m} minutos sin acuse (más de 2 horas). Es el último escalamiento.",
};

/** Asunto y cuerpo del aviso, con el contexto del caso cuando la base lo entrega. */
export function alertMessage(item: AlertEmailItem, appUrl = "https://ennco-operacion.vercel.app"): { subject: string; body: string } {
  const stage = STAGE_TEXT[item.stage].replace("{m}", String(item.pending_minutes));
  const link = `${appUrl.replace(/\/$/, "")}/operacion/correos`;
  const footer = `Entra al Control Room (${link}), abre Correos y confirma la recepción o registra el siguiente paso.\n\nCaso: ${item.case_id}`;
  const context = item.context;
  if (!context) {
    return { subject: `ENNCO: respuesta sin acuse ${item.case_id.slice(0, 8)} (${item.stage})`,
      body: `Hay una respuesta comercial pendiente de acuse desde hace ${item.pending_minutes} minutos.\n\n${footer}` };
  }
  const label = intentLabel(context);
  const subject = `ENNCO · ${who(context)} (${company(context)}) respondió · ${label}`.replace(/[\r\n]+/g, " ").slice(0, 180);
  const body = [
    `${who(context)}, de ${company(context)}, respondió a la campaña de correos.`,
    "",
    `Clasificación: ${label}`,
    `Qué hizo el sistema: ${systemAction(context)}`,
    ...(context.next_action ? [`Siguiente paso: ${context.next_action}`] : []),
    "",
    "Lo que escribió:",
    `"${replyExcerpt(context, 1500)}"`,
    "",
    "Quién respondió:",
    ...contactLines(context).map(line => `· ${line}`),
    "",
    stage,
    footer,
  ].join("\n");
  return { subject, body };
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
  const { subject, body } = alertMessage(item, config.appUrl);
  let sender: Pick<DirectLaneGmailSender, "send">;
  try { sender = deps.sender ? deps.sender(token) : new DirectLaneGmailSender({ accessToken: token }); }
  catch { return "UNAVAILABLE"; }
  try {
    await sender.send({ message_id: randomUUID(), from_name: "ENNCO Control Room", from_email: mailboxEmail,
      to_email: recipients.to, cc_emails: recipients.cc, subject, body_text: body,
      kind: "INTERNAL", touch_number: null, thread: null, list_unsubscribe_url: null, open_pixel_url: null });
    return "ACCEPTED";
  } catch (error) {
    return directLaneSendIsAmbiguous(error) ? "AMBIGUOUS" : "UNAVAILABLE";
  }
}
