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
// Firma, avisos legales y citas no son la respuesta: el aviso de Natural de Alimentos ("En cumplimiento
// de la Ley...", "responda con el asunto Quitarme") se leía como compromiso técnico. Siempre es un
// prefijo del cuerpo, así la evidencia sigue siendo una cita literal.
const closingLine = /^\s*(saludos|un saludo|saludo cordial|atentamente|cordialmente|(kind |best )?regards|--|__|enviado desde|sent from|aviso de (privacidad|confidencialidad)|confidentiality notice|\[cid:|el (lun|mar|mie|jue|vie|sab|dom)[a-z]*[.,]? \d|on (mon|tue|wed|thu|fri|sat|sun)[a-z]*,? |de: |from: )/;
export function commercialText(body: string): string {
  for (const line of body.matchAll(/^.*$/gm)) {
    if (line.index > 0 && body.slice(0, line.index).trim() && closingLine.test(normalized(line[0]))) return body.slice(0, line.index).trim();
  }
  return body.trim();
}
export type PositiveSubtype = "POSITIVE_VISIT" | "POSITIVE_ACCEPT";
// 6-oct (Grant): "prefiero falsos positivos". Toda respuesta humana es positiva salvo que sea
// claramente negativa (baja, rechazo, "ahora no", persona equivocada o que ya no está, queja,
// fuera de oficina). Preguntas de precio, alta de proveedor, referidos y respuestas con más gente en
// copia también reciben el correo simple con copia a Paco: el texto solo agradece y lo presenta.
const NEGATIVE = {
  WRONG_PERSON: /\b(no (me encuentro|estoy|vivo|radico) en|vivo en|radico en|persona (equivocada|incorrecta)|ya no (trabajo|laboro|colaboro|pertenezco|estoy|formo parte)|ya no (trabaja|labora|colabora)|deje de (laborar|trabajar)|no longer (with|work|working|employed)|left the company|wrong person|cuenta (deshabilitada|inhabilitada|desactivada)|account (has been )?(disabled|deactivated))\b/,
  NO_SOY: /\bno soy (la persona|el (encargado|responsable|indicado)|la (encargada|responsable|indicada)|quien ve)\b/,
  REFERRAL_HINT: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\b(contacta a|contactar a|escribe(le)? a|escribele|comunicate con|habla con|te copio|te canalizo|mi colega|mi companero|el encargado es|la encargada es|en copia)\b/,
  NOT_NOW: /\b(ahorita no|ahora no|por (el )?momento no|por ahora no|de momento no|en este momento no|mas adelante|el proximo ano|el siguiente ano|el ano que entra|en otro momento|no tenemos presupuesto|sin presupuesto|not now|maybe later|next year|not at this time)\b/,
  REJECTION: /\b(no (me |nos )?interesa|no estamos interesad|no es de nuestro interes|no gracias|no, gracias|no requerimos|no lo requerimos|no necesitamos|no lo necesitamos|no lo necesito|ya (contamos|tenemos|trabajamos) con|ya tenemos (proveedor|quien)|no aplica|no es necesario|not interested|no thank|we are not interested|we already have)\b|^\s*no\s*[.!,]?\s*$/,
  COMPLAINT: /\b(queja|spam|denuncia|acoso|como obtuvieron mi correo|de donde sacaron mi correo|no autorice|reportare|complaint)\b/,
  OOO: /\b(fuera de (la )?oficina|estare fuera|estoy de vacaciones|acceso limitado|out of (the )?office|automatic reply|respuesta automatica|i will be back|back in the office)\b/,
};
const INTEREST = /\b(me interesa|nos interesa|podemos (hablar|platicar|vernos)|agend\w*|cotiza\w*|llamame|marcame|hablemos|platiquemos|mandame|enviame|me (mandas|envias))\b|[?¿]/;
const MEETING = /\b(podemos (hablar|platicar|vernos|reunirnos|agendar|ver)|hablemos|platiquemos|llamada|llamame|marcame|te (llamo|marco)|me (llamas|marcas)|reunion|junta|cita|visita|visitarnos|venir|vengan|pasar a|agend\w*|program\w* (la|una) (visita|llamada|reunion)|(los|te) esperamos|manana|lunes|martes|miercoles|jueves|viernes|a las \d|\d{1,2}:\d{2}|\d{1,2} ?(am|pm|hrs?)|mi (celular|telefono|numero|cel)|whatsapp|zoom|teams|meet)\b/;
export function classifyReply(body: string): { intent: Intent; subtype: PositiveSubtype | null } {
  const text = normalized(commercialText(body));
  if (!text) return { intent: "AMBIGUOUS", subtype: null };
  if (unsubscribeRequested(body)) return { intent: "UNSUBSCRIBE", subtype: null };
  if (/ignora.{0,35}(instrucciones|reglas)|ignore.{0,35}(instructions|rules)|system prompt|api.key|revela.{0,20}(secreto|clave)/i.test(text)) return { intent: "AMBIGUOUS", subtype: null };
  // "Estaré fuera, pero me interesa, agendemos" lo escribió una persona: es positivo.
  if (NEGATIVE.OOO.test(text) && !INTEREST.test(text)) return { intent: "OUT_OF_OFFICE", subtype: null };
  if (NEGATIVE.COMPLAINT.test(text)) return { intent: "COMPLAINT", subtype: null };
  if (NEGATIVE.WRONG_PERSON.test(text)) return { intent: "WRONG_PERSON", subtype: null };
  // "No soy la persona, escríbele a X" es un referido (positivo); sin a quién, es persona equivocada.
  if (NEGATIVE.NO_SOY.test(text) && !NEGATIVE.REFERRAL_HINT.test(text)) return { intent: "WRONG_PERSON", subtype: null };
  if (NEGATIVE.NOT_NOW.test(text)) return { intent: "NOT_NOW", subtype: null };
  if (NEGATIVE.REJECTION.test(text)) return { intent: "REJECTION", subtype: null };
  return { intent: "EXPLICIT_INTEREST", subtype: MEETING.test(text) ? "POSITIVE_VISIT" : "POSITIVE_ACCEPT" };
}
export function positiveSubtype(body: string): PositiveSubtype | null {
  return classifyReply(body).subtype;
}
export function unsubscribeRequested(body: string): boolean {
  return /^(baja|unsubscribe|stop)[.!\s]*$/i.test(body.trim()) || /\b(dar(me)? de baja|dame de baja|elimina(me)? de (tu |su |la )?lista|no (me |nos )?(escribas|escriban|contactes|contacten|mandes|manden)|no (quiero|deseo|queremos) recibir|deja(n)? de (escribir|enviar)|remove me|stop (emailing|contacting)|unsubscribe me)\b/i.test(normalized(body));
}
export function deterministicProposal(body: string): Proposal {
  const reply = commercialText(body);
  const { intent, subtype } = classifyReply(body);
  const clearPositive = intent === "EXPLICIT_INTEREST" && subtype !== null;
  return { intent, confidence: clearPositive ? 0.95 : intent === "AMBIGUOUS" ? 0 : 0.9, evidence: [reply.slice(0, 500) || "BODY_MISSING"], fact_ids: [], draft: templates[intent] ?? "", escalation_reason: clearPositive ? "" : "Revisión humana pendiente" };
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
