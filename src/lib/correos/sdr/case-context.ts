import { z } from "zod";
import { commercialText } from "@/lib/correos/sdr/policy";

/**
 * Contexto de un caso del SDR tal como lo entrega app.email_sdr_case_context (migración 105).
 * Jorge (9-oct): los avisos solo traían el número de caso. Con esto, quien lo lee sabe quién
 * respondió, de qué empresa, qué escribió y qué hizo el sistema, sin abrir el Control Room.
 */
export const caseContextSchema = z.object({
  contact_name: z.string().nullable().optional(), contact_role: z.string().nullable().optional(),
  contact_email: z.string().nullable().optional(), account_name: z.string().nullable().optional(),
  account_city: z.string().nullable().optional(), account_state: z.string().nullable().optional(),
  mailbox_email: z.string().nullable().optional(), received_at: z.string().nullable().optional(),
  subject: z.string().nullable().optional(), body: z.string().nullable().optional(),
  touch_number: z.number().int().nullable().optional(), event_kind: z.string().nullable().optional(),
  intent: z.string().nullable().optional(), subtype: z.string().nullable().optional(),
  state: z.string().nullable().optional(), next_action: z.string().nullable().optional(),
  send_after: z.string().nullable().optional(), reply_status: z.string().nullable().optional(),
  reply_sent_at: z.string().nullable().optional(), reply_cc: z.array(z.string()).nullable().optional(),
  reply_cc_planned: z.array(z.string()).nullable().optional(),
}).passthrough();
export type CaseContext = z.infer<typeof caseContextSchema>;

const INTENT_LABELS: Record<string, string> = {
  POSITIVE_VISIT: "Positiva · quiere hablar o reunirse",
  POSITIVE_ACCEPT: "Positiva · interés, pregunta o referido",
  NOT_NOW: "Ahora no",
  REJECTION: "Rechazo",
  WRONG_PERSON: "Persona equivocada o ya no está",
  COMPLAINT: "Queja",
  UNSUBSCRIBE: "Pidió baja",
  OUT_OF_OFFICE: "Fuera de la oficina",
  AMBIGUOUS: "Sin clasificar",
};

export function intentLabel(context: CaseContext): string {
  return INTENT_LABELS[context.subtype ?? ""] ?? INTENT_LABELS[context.intent ?? ""] ?? context.intent ?? "Sin clasificar";
}

export function isPositive(context: CaseContext): boolean {
  return context.subtype === "POSITIVE_VISIT" || context.subtype === "POSITIVE_ACCEPT";
}

/** "8-oct 12:58", hora de la Ciudad de México. */
export function cdmx(iso: string | null | undefined, withDay = true): string {
  if (!iso) return "sin fecha";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "sin fecha";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", day: "numeric",
    month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date).map(p => [p.type, p.value]));
  const time = `${parts.hour}:${parts.minute}`;
  return withDay ? `${parts.day}-${String(parts.month).replace(".", "")} ${time}` : time;
}

export function who(context: CaseContext): string {
  return context.contact_name?.trim() || context.contact_email || "Un contacto";
}

export function company(context: CaseContext): string {
  return context.account_name?.trim() || "su empresa";
}

export function place(context: CaseContext): string {
  return [context.account_city, context.account_state].filter(Boolean).join(", ");
}

/** Lo que escribió, sin firma, aviso legal ni texto citado. */
export function replyExcerpt(context: CaseContext, max: number): string {
  const text = commercialText(context.body ?? "").replace(/\[cid:[^\]]*\]/g, "").replace(/​/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return "(sin texto)";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Qué hizo el sistema con la respuesta. */
export function systemAction(context: CaseContext): string {
  const cc = (context.reply_cc?.length ? context.reply_cc : context.reply_cc_planned) ?? [];
  const withCc = cc.length ? `, con copia a ${cc.join(" y ")}` : "";
  if (context.reply_status === "SENT" || context.reply_status === "DELIVERED") {
    return `Se le respondió automáticamente el ${cdmx(context.reply_sent_at)} desde ${context.mailbox_email ?? "el mismo buzón"}${withCc}.`;
  }
  if (context.state === "QUEUED") return `Respuesta automática en cola de envío${withCc}.`;
  if (isPositive(context) && context.state === "READY" && context.send_after) {
    return `Respuesta automática programada para las ${cdmx(context.send_after, false)}${withCc}.`;
  }
  if (isPositive(context)) return `Es positiva, pero no se respondió sola: ${context.next_action ?? "revisar en el Control Room"}.`;
  if (context.state === "MANUAL_HANDLED") return "Alguien ya le contestó a mano desde Gmail.";
  return "No se le respondió nada automáticamente. Falta que alguien decida el siguiente paso.";
}

/** Bloque "quién respondió", común al correo y a Telegram. */
export function contactLines(context: CaseContext): string[] {
  return [
    `Nombre: ${who(context)}`,
    ...(context.contact_role ? [`Puesto: ${context.contact_role}`] : []),
    ...(context.contact_email ? [`Correo: ${context.contact_email}`] : []),
    `Empresa: ${company(context)}${place(context) ? ` · ${place(context)}` : ""}`,
    `Le escribimos desde: ${context.mailbox_email ?? "sin dato"}${context.touch_number ? ` (toque ${context.touch_number})` : ""}`,
    ...(context.subject ? [`Asunto: ${context.subject}`] : []),
    `Recibido: ${cdmx(context.received_at)}`,
  ];
}
