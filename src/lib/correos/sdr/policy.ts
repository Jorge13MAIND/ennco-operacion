import { createHash } from "node:crypto";
import { z } from "zod";
import { extractReplyText } from "@/lib/gmail/body";

export const POLICY_VERSION = "ennco-email-v1-2026-09-23";
export const intents = ["CONTEXT", "EXPLICIT_INTEREST", "PRICE", "UNSUBSCRIBE", "OUT_OF_OFFICE", "REFERRAL", "WRONG_PERSON", "NOT_NOW", "REJECTION", "COMPLAINT", "TECHNICAL_COMMITMENT", "AMBIGUOUS"] as const;
export type Intent = typeof intents[number];
export const proposalSchema = z.object({
  intent: z.enum(intents), confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().min(1).max(500)).min(1).max(5),
  fact_ids: z.array(z.string()).max(5), draft: z.string().max(2000), escalation_reason: z.string().max(300),
}).strict();
export type Proposal = z.infer<typeof proposalSchema>;
export const facts = [
  { id: "services-v1", text: "ENNCO realiza ingeniería eléctrica, instalaciones fotovoltaicas y mantenimiento eléctrico industrial.", source: "Campaña aprobada Bajío industrial, toque 1; ennco.com.mx" },
  { id: "report-v1", text: "ENNCO entrega un reporte de lo que encuentra y de lo que conviene atender primero.", source: "Campaña aprobada Bajío industrial, toque 1" },
] as const;
// Reviewed canaries release these fixed, auditable replies. Free model prose is
// shown to a human only. A model cannot smuggle new claims into an automatic send.
export const templates: Partial<Record<Intent, string>> = {
  CONTEXT: "Claro. En ENNCO hacemos instalaciones fotovoltaicas y mantenimiento eléctrico industrial: tableros, transformadores e instalaciones solares. Entregamos un reporte de lo que encontramos y de lo que conviene atender primero.\n\n¿Qué necesitas revisar hoy en tu planta?\n\nFrancisco",
  EXPLICIT_INTEREST: "Gracias por contármelo. Para entender la necesidad antes de proponerte un alcance, ¿qué equipo o instalación necesitas revisar?\n\nFrancisco",
};
export const followupTemplates = [
  "Retomo tu respuesta por aquí. ¿Sigue vigente la necesidad que comentaste?\n\nFrancisco",
  "Cierro el seguimiento por ahora para no insistir. Si retoman la revisión, puedes responder en este mismo correo.\n\nFrancisco",
] as const;
export const threadSchema = z.object({ id: z.string(), messages: z.array(z.object({
  id: z.string(), threadId: z.string(), internalDate: z.string().regex(/^\d+$/), labelIds: z.array(z.string()).optional(),
  payload: z.object({ headers: z.array(z.object({ name: z.string(), value: z.string() })) }).passthrough(),
}).passthrough()).min(1).max(100) }).passthrough();
export type ConversationContext = {
  body: string | null; providerMessageId: string; providerThreadId: string;
  mailboxEmail: string; contactEmail: string; ownerId: string | null; suppressed: boolean;
  thread: unknown; ownSdrMessageIds: string[]; now: number; capturedAt: number;
};
function normalized(text: string) { return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase(); }
export function unsubscribeRequested(body: string): boolean {
  return /^(baja|unsubscribe|stop)[.!\s]*$/i.test(body.trim()) || /\b(dar(me)? de baja|dame de baja|elimina(me)? de (tu |su |la )?lista|no (me |nos )?(escribas|escriban|contactes|contacten|mandes|manden)|no (quiero|deseo|queremos) recibir|deja(n)? de (escribir|enviar)|remove me|stop (emailing|contacting)|unsubscribe me)\b/i.test(normalized(body));
}
export function deterministicProposal(body: string): Proposal {
  const text = normalized(body);
  let intent: Intent = "AMBIGUOUS";
  if (unsubscribeRequested(body)) intent = "UNSUBSCRIBE";
  else if (/ignora.{0,35}(instrucciones|reglas)|ignore.{0,35}(instructions|rules)|system prompt|api.key|revela.{0,20}(secreto|clave)/i.test(text)) intent = "AMBIGUOUS";
  else if (/\b(precio|costo|descuento|cotiza|cotizacion|cuanto cuesta|presupuesto|price|pricing)\b/i.test(text)) intent = "PRICE";
  else if (/\b(queja|molestia|spam|denuncia|complaint)\b/i.test(text)) intent = "COMPLAINT";
  else if (/\b(garantia|garantiza|cumplimiento|deducible|ahorro|fecha de entrega|condiciones|nom[- ]?029)\b/i.test(text)) intent = "TECHNICAL_COMMITMENT";
  else if (/\b(fuera de (la )?oficina|vacaciones|out of office|automatic reply|respuesta automatica)\b/i.test(text)) intent = "OUT_OF_OFFICE";
  else if (/\b(contacta a|escribe a|comunicate con|te copio|te canalizo|mi colega|en copia a)\b/i.test(text)) intent = "REFERRAL";
  else if (/\b(no (me encuentro|estoy) en|vivo en|no soy (la persona|el encargado)|persona (equivocada|incorrecta)|wrong person)\b/i.test(text)) intent = "WRONG_PERSON";
  else if (/\b(ahorita no|ahora no|no.{0,20}(necesitamos|necesito)|mas adelante|not now)\b/i.test(text)) intent = "NOT_NOW";
  else if (/\b(no (me |nos )?interesa|no gracias|not interested)\b/i.test(text)) intent = "REJECTION";
  else if (/\b(me interesa|nos interesa|queremos revisar|necesitamos revisar|necesito revisar)\b/i.test(text)) intent = "EXPLICIT_INTEREST";
  else if (/\b(contexto|mas informacion|que hacen|que servicios|de que se trata|explica(me)?|informacion del servicio)\b/i.test(text)) intent = "CONTEXT";
  return { intent, confidence: intent === "AMBIGUOUS" ? 0 : 0.8, evidence: [body.trim().slice(0, 500) || "BODY_MISSING"], fact_ids: intent === "CONTEXT" ? ["services-v1", "report-v1"] : [], draft: templates[intent] ?? "", escalation_reason: "Revisión humana pendiente" };
}
function email(value: string) { return (/<([^>]+)>/.exec(value)?.[1] ?? value).trim().toLowerCase(); }
export function evaluateConversation(context: ConversationContext): { gates: string[]; threadHash: string; latestText: string | null; manualReply: boolean } {
  const gates: string[] = [];
  const parsed = threadSchema.safeParse(context.thread);
  if (!parsed.success) return { gates: ["THREAD_MISSING"], threadHash: "", latestText: null, manualReply: false };
  const thread = parsed.data;
  const inbound = thread.messages.find(m => m.id === context.providerMessageId);
  if (!inbound || thread.id !== context.providerThreadId || inbound.threadId !== thread.id) gates.push("THREAD_IDENTITY_MISMATCH");
  const from = inbound?.payload.headers.find(h => h.name.toLowerCase() === "from")?.value ?? "";
  if (email(from) !== context.contactEmail.toLowerCase()) gates.push("SENDER_IDENTITY_UNCERTAIN");
  const recipients = inbound?.payload.headers.filter(h => ["to", "cc", "delivered-to"].includes(h.name.toLowerCase())).map(h => h.value.toLowerCase()).join(" ") ?? "";
  const recipientAddresses: string[] = recipients.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+/g) ?? [];
  if (!recipientAddresses.includes(context.mailboxEmail.toLowerCase())) gates.push("MAILBOX_IDENTITY_UNCERTAIN");
  const latestText = inbound ? extractReplyText(inbound) : null;
  if (!latestText || !context.body) gates.push("BODY_MISSING");
  if (latestText !== context.body) gates.push("BODY_CHANGED");
  if (!context.ownerId) gates.push("OWNER_MISSING");
  if (context.suppressed) gates.push("SUPPRESSED");
  if (context.now < context.capturedAt || context.now - context.capturedAt > 60000) gates.push("THREAD_STALE");
  let manualReply = false;
  for (const m of thread.messages) {
    if (!inbound || Number(m.internalDate) <= Number(inbound.internalDate) || m.labelIds?.includes("DRAFT")) continue;
    const sender = email(m.payload.headers.find(h => h.name.toLowerCase() === "from")?.value ?? "");
    if (context.ownSdrMessageIds.includes(m.id)) continue;
    if (m.labelIds?.includes("SENT") || sender === context.mailboxEmail.toLowerCase() || sender.endsWith("@ennco.com.mx") || sender.endsWith("@enncoenergia.com") || sender.endsWith("@enncoindustrial.com")) {
      manualReply = true; gates.push("HUMAN_INTERVENED");
    } else gates.push("NEWER_REPLY");
  }
  return { gates: [...new Set(gates)], threadHash: createHash("sha256").update(JSON.stringify({ id: thread.id, messages: thread.messages.map(m => ({ id: m.id, date: m.internalDate, headers: m.payload.headers.filter(h => ["from", "to", "cc", "message-id"].includes(h.name.toLowerCase())), text: extractReplyText(m) })) })).digest("hex"), latestText, manualReply };
}
export function evaluateProposal(proposal: Proposal, body: string): { eligible: boolean; draft: string; gates: string[] } {
  const gates: string[] = [];
  const deterministic = deterministicProposal(body);
  if (deterministic.intent === "UNSUBSCRIBE") return { eligible: false, draft: "", gates: ["UNSUBSCRIBE"] };
  if (!["CONTEXT", "EXPLICIT_INTEREST"].includes(deterministic.intent)) gates.push("HUMAN_REVIEW_REQUIRED");
  if (proposal.intent !== deterministic.intent) gates.push("INTENT_DISAGREEMENT");
  if (proposal.confidence < 0.95) gates.push("CONFIDENCE_LOW");
  if (proposal.evidence.some(quote => !body.includes(quote))) gates.push("EVIDENCE_NOT_IN_REPLY");
  if (proposal.fact_ids.some(id => !facts.some(f => f.id === id))) gates.push("FACT_NOT_APPROVED");
  if (proposal.escalation_reason) gates.push("MODEL_ESCALATED");
  const draft = templates[proposal.intent] ?? "";
  if (!draft) gates.push("TEMPLATE_NOT_APPROVED");
  return { eligible: gates.length === 0, draft, gates };
}
