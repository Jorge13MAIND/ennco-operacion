import { z } from "zod";

/**
 * CRM de respuestas (13-oct-2026, Grant). Etapas del proceso de Paco (informe del 12-oct) más
 * "Descartado" para los negativos. La base (migración 109) es la que manda: aquí solo se espejean las
 * reglas para guiar a quien mueve una tarjeta antes de que la base la rechace.
 */
export const CRM_STAGES = ["RESPONDIO", "CALIFICADO", "LLAMADA_VISITA", "LEVANTAMIENTO", "PROPUESTA", "NEGOCIACION", "GANADO", "PERDIDO", "DESCARTADO"] as const;
export type CrmStage = typeof CRM_STAGES[number];

/** Columnas del tablero: todo menos Descartado, que vive en su propia vista. */
export const BOARD_STAGES: readonly CrmStage[] = CRM_STAGES.filter((s) => s !== "DESCARTADO");
export const OPEN_STAGES: readonly CrmStage[] = ["RESPONDIO", "CALIFICADO", "LLAMADA_VISITA", "LEVANTAMIENTO", "PROPUESTA", "NEGOCIACION"];
export const QUALIFIED_STAGES: readonly CrmStage[] = ["CALIFICADO", "LLAMADA_VISITA", "LEVANTAMIENTO", "PROPUESTA", "NEGOCIACION", "GANADO"];

export const STAGE_LABELS: Record<CrmStage, string> = {
  RESPONDIO: "Respondió",
  CALIFICADO: "Calificado",
  LLAMADA_VISITA: "Llamada o visita",
  LEVANTAMIENTO: "Levantamiento",
  PROPUESTA: "Propuesta",
  NEGOCIACION: "Negociación",
  GANADO: "Ganado",
  PERDIDO: "Perdido",
  DESCARTADO: "Descartado",
};

export const STAGE_HINTS: Record<CrmStage, string> = {
  RESPONDIO: "Llegó la respuesta; falta validarla",
  CALIFICADO: "Cumple las condiciones de Paco",
  LLAMADA_VISITA: "Llamada o visita agendada",
  LEVANTAMIENTO: "Visita técnica o vuelo con dron",
  PROPUESTA: "Cotización enviada",
  NEGOCIACION: "Decisión pendiente",
  GANADO: "Venta cerrada",
  PERDIDO: "Se perdió, con motivo",
  DESCARTADO: "No era oportunidad",
};

export type StageTone = "neutral" | "info" | "warn" | "good" | "bad";
export const STAGE_TONES: Record<CrmStage, StageTone> = {
  RESPONDIO: "neutral", CALIFICADO: "info", LLAMADA_VISITA: "info", LEVANTAMIENTO: "info",
  PROPUESTA: "warn", NEGOCIACION: "warn", GANADO: "good", PERDIDO: "bad", DESCARTADO: "bad",
};

export const SERVICES = ["TERMOGRAFIA_DRON", "MANTENIMIENTO", "SUBESTACION", "PANELES_SOLARES", "NOM_029", "CALIDAD_ENERGIA", "OTRO"] as const;
export type CrmService = typeof SERVICES[number];
export const SERVICE_LABELS: Record<CrmService, string> = {
  TERMOGRAFIA_DRON: "Termografía con dron",
  MANTENIMIENTO: "Mantenimiento eléctrico",
  SUBESTACION: "Subestación y transformadores",
  PANELES_SOLARES: "Paneles solares",
  NOM_029: "NOM-029 (documentación)",
  CALIDAD_ENERGIA: "Factor de potencia y calidad de energía",
  OTRO: "Otro",
};

/** Las 4 condiciones de Paco que se marcan a mano; la quinta (siguiente acción) sale de los campos. */
export const QUALIFICATION_KEYS = ["mercado", "contacto", "necesidad", "avance"] as const;
export type QualificationKey = typeof QUALIFICATION_KEYS[number];
export const QUALIFICATION_LABELS: Record<QualificationKey, string> = {
  mercado: "La empresa es del mercado objetivo de ENNCO",
  contacto: "Nombre, cargo, empresa y correo verificados",
  necesidad: "Hay una necesidad o servicio identificable",
  avance: "Acepta llamada, visita, reunión o información técnica",
};

export const NOTE_KINDS = ["NOTA", "LLAMADA", "WHATSAPP", "REUNION"] as const;
export type NoteKind = typeof NOTE_KINDS[number];
export const ACTIVITY_LABELS: Record<string, string> = {
  NOTA: "Nota", LLAMADA: "Llamada", WHATSAPP: "WhatsApp", REUNION: "Reunión", CAMBIO_ETAPA: "Cambio de etapa",
  EDICION: "Edición", TAREA: "Tarea", SISTEMA: "Sistema",
};

export const INTENT_LABELS: Record<string, string> = {
  POSITIVE_VISIT: "Quiere hablar o reunirse",
  POSITIVE_ACCEPT: "Interés, pregunta o referido",
  NOT_NOW: "Ahora no",
  REJECTION: "Rechazo",
  WRONG_PERSON: "Persona equivocada",
  COMPLAINT: "Queja",
  UNSUBSCRIBE: "Pidió baja",
  OUT_OF_OFFICE: "Fuera de la oficina",
  AMBIGUOUS: "Sin clasificar",
};

const nullableText = z.string().nullable().optional().transform((v) => v ?? null);
const nullableNumber = z.union([z.number(), z.string()]).nullable().optional().transform((v) => (v === null || v === undefined || v === "" ? null : Number(v)));

export const crmRecordSchema = z.object({
  id: z.uuid(),
  contact_id: z.uuid().nullable().optional().transform((v) => v ?? null),
  account_id: z.uuid().nullable().optional().transform((v) => v ?? null),
  source: z.enum(["CORREO", "MANUAL", "REFERIDO"]),
  full_name: z.string(),
  email: nullableText, phone: nullableText, role_title: nullableText, company_name: nullableText,
  city: nullableText, state: nullableText,
  stage: z.enum(CRM_STAGES),
  owner_user_id: z.uuid().nullable().optional().transform((v) => v ?? null),
  owner_email: nullableText,
  service_interest: z.enum(SERVICES).nullable().optional().transform((v) => v ?? null),
  value_mxn: nullableNumber,
  next_action: nullableText, next_action_at: nullableText, close_reason: nullableText,
  qualification: z.record(z.string(), z.unknown()).catch({}),
  reply_intent: nullableText,
  first_reply_at: nullableText, last_reply_at: nullableText, last_touch_at: nullableText,
  last_reply_body: nullableText, mailbox_email: nullableText,
  open_tasks: z.number().int().catch(0), next_task_at: nullableText,
  revision: z.number().int(),
  created_at: z.string(), updated_at: z.string(),
}).passthrough();
export type CrmRecord = z.infer<typeof crmRecordSchema>;

export const crmUserSchema = z.object({ id: z.uuid(), email: z.string(), role: z.string() });
export type CrmUser = z.infer<typeof crmUserSchema>;

export const crmBoardSchema = z.object({
  records: z.array(crmRecordSchema),
  users: z.array(crmUserSchema),
  default_owner_user_id: z.uuid().nullable().optional().transform((v) => v ?? null),
  generated_at: z.string(),
});
export type CrmBoardData = z.infer<typeof crmBoardSchema>;

export const crmActivitySchema = z.object({
  id: z.uuid(), kind: z.string(), body: nullableText, data: z.record(z.string(), z.unknown()).catch({}),
  actor_email: nullableText, created_at: z.string(),
});
export const crmTaskSchema = z.object({
  id: z.uuid(), title: z.string(), due_at: nullableText, status: z.enum(["PENDIENTE", "HECHA", "CANCELADA"]),
  owner_user_id: z.uuid().nullable().optional().transform((v) => v ?? null), owner_email: nullableText,
  completed_at: nullableText, created_at: z.string(),
});
export const crmEmailSchema = z.object({
  id: z.uuid(), direction: z.enum(["INBOUND", "OUTBOUND"]), subject: nullableText, body: nullableText, at: z.string(),
  status: z.string(), touch_number: z.number().int().nullable().optional().transform((v) => v ?? null),
  mailbox_email: nullableText, cc_emails: z.array(z.string()).nullable().optional().transform((v) => v ?? []),
});
export const crmDetailSchema = z.object({
  record: crmRecordSchema,
  activities: z.array(crmActivitySchema),
  tasks: z.array(crmTaskSchema),
  emails: z.array(crmEmailSchema),
});
export type CrmDetail = z.infer<typeof crmDetailSchema>;
export type CrmTask = z.infer<typeof crmTaskSchema>;
export type CrmActivity = z.infer<typeof crmActivitySchema>;
export type CrmEmail = z.infer<typeof crmEmailSchema>;

/** Comandos que acepta /api/v1/operations/crm (la base vuelve a validar todo). */
const isoDate = z.string().max(40).refine((v) => v === "" || !Number.isNaN(Date.parse(v)), "FECHA_INVALIDA");
const optionalText = (max: number) => z.string().max(max).optional();
export const crmFields = z.object({
  full_name: optionalText(200), email: z.union([z.email(), z.literal("")]).optional(), phone: optionalText(40),
  role_title: optionalText(200), company_name: optionalText(200), city: optionalText(120), state: optionalText(120),
  service_interest: z.union([z.enum(SERVICES), z.literal("")]).optional(),
  value_mxn: z.union([z.number().nonnegative().max(1e12), z.literal("")]).optional(),
  owner_user_id: z.union([z.uuid(), z.literal("")]).optional(),
  next_action: optionalText(500), next_action_at: isoDate.optional(), close_reason: optionalText(500),
  qualification: z.object(Object.fromEntries(QUALIFICATION_KEYS.map((k) => [k, z.boolean().optional()]))).strict().optional(),
}).strict();
export const crmCommandSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("CREAR"), payload: crmFields.extend({ full_name: z.string().trim().min(1).max(200),
    source: z.enum(["MANUAL", "REFERIDO"]).optional(), note: optionalText(5000), referred_from_record_id: z.uuid().optional() }).strict() }).strict(),
  z.object({ op: z.literal("ACTUALIZAR"), payload: crmFields.extend({ record_id: z.uuid(), expected_revision: z.number().int().optional() }).strict() }).strict(),
  z.object({ op: z.literal("MOVER"), payload: crmFields.extend({ record_id: z.uuid(), stage: z.enum(CRM_STAGES),
    note: optionalText(2000), expected_revision: z.number().int().optional() }).strict() }).strict(),
  z.object({ op: z.literal("CALIFICAR"), payload: z.object({ record_id: z.uuid(),
    qualification: z.object(Object.fromEntries(QUALIFICATION_KEYS.map((k) => [k, z.boolean()]))).strict() }).strict() }).strict(),
  z.object({ op: z.literal("NOTA"), payload: z.object({ record_id: z.uuid(), kind: z.enum(NOTE_KINDS), body: z.string().trim().min(1).max(5000) }).strict() }).strict(),
  z.object({ op: z.literal("TAREA_CREAR"), payload: z.object({ record_id: z.uuid(), title: z.string().trim().min(2).max(300),
    due_at: isoDate.optional(), owner_user_id: z.union([z.uuid(), z.literal("")]).optional() }).strict() }).strict(),
  z.object({ op: z.literal("TAREA_ESTADO"), payload: z.object({ task_id: z.uuid(), status: z.enum(["PENDIENTE", "HECHA", "CANCELADA"]) }).strict() }).strict(),
]);
export type CrmCommand = z.infer<typeof crmCommandSchema>;
export const crmCommandResultSchema = z.object({
  ok: z.literal(true), record_id: z.uuid().optional(), task_id: z.uuid().optional(), revision: z.number().int().optional(),
  stage: z.string().optional(), message: z.string(), replayed: z.boolean().optional(),
}).passthrough();

/** Mensajes para los códigos que levanta la base. */
export const CRM_ERROR_MESSAGES: Record<string, string> = {
  CRM_CALIFICACION_INCOMPLETA: "Para pasar a esa etapa marca las 4 condiciones de calificación.",
  CRM_SIGUIENTE_ACCION_REQUERIDA: "Falta la siguiente acción con fecha y responsable.",
  CRM_VALOR_REQUERIDO: "Para marcarlo como ganado captura el valor en MXN.",
  CRM_MOTIVO_REQUERIDO: "Escribe el motivo para cerrarlo.",
  CRM_REGISTRO_DESACTUALIZADO: "Alguien más cambió este contacto. Recarga y vuelve a intentar.",
  CRM_RESPONSABLE_INVALIDO: "Ese responsable no tiene acceso al hub.",
  CRM_NOMBRE_REQUERIDO: "El nombre es obligatorio.",
  CRM_NOTA_VACIA: "La nota está vacía.",
  CRM_TAREA_VACIA: "La tarea necesita un título.",
  OPERATIONS_OPERATOR_ROLE_REQUIRED: "Tu usuario no puede editar el CRM.",
  SYNTHETIC_MUTATION_DISABLED: "Es una vista de ejemplo: no se guardan cambios.",
};
export function crmErrorMessage(code: string | undefined): string {
  return (code && CRM_ERROR_MESSAGES[code]) ?? "No se pudo guardar. Intenta de nuevo.";
}

export function isQualified(record: Pick<CrmRecord, "qualification">): boolean {
  return QUALIFICATION_KEYS.every((k) => record.qualification[k] === true);
}

/** Qué le falta a un registro para entrar a una etapa (espejo de app.crm_command). */
export function stageRequirements(record: CrmRecord, stage: CrmStage): Array<"calificacion" | "siguiente" | "valor" | "motivo"> {
  const missing: Array<"calificacion" | "siguiente" | "valor" | "motivo"> = [];
  if (QUALIFIED_STAGES.includes(stage) && !isQualified(record)) missing.push("calificacion");
  if (QUALIFIED_STAGES.includes(stage) && stage !== "GANADO"
    && (!record.next_action?.trim() || !record.next_action_at || !record.owner_user_id)) missing.push("siguiente");
  if (stage === "GANADO" && !(record.value_mxn && record.value_mxn > 0)) missing.push("valor");
  if ((stage === "PERDIDO" || stage === "DESCARTADO") && !record.close_reason?.trim()) missing.push("motivo");
  return missing;
}

const KNOWN_PEOPLE: Record<string, string> = {
  "oscar.ojeda@ennco.com.mx": "Oscar Ojeda",
  "francisco.cuellar@ennco.com.mx": "Paco Cuéllar",
  "tere.coronado@ennco.com.mx": "Tere Coronado",
  "contacto@ennco.com.mx": "Contacto ENNCO",
  "george@teckel-ai.com": "Jorge (Teckel)",
  "grantkeegan@teckel-ai.com": "Grant (Teckel)",
};
export function personName(email: string | null | undefined): string {
  if (!email) return "Sin responsable";
  return KNOWN_PEOPLE[email.toLowerCase()] ?? email.split("@")[0]!;
}
export function initials(name: string): string {
  const parts = name.replace(/\(.*\)/, "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function formatMxn(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Sin valor";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(value);
}

const DAY = 86_400_000;
/** "hoy", "ayer", "hace 3 días", "en 2 días"; en hora de la Ciudad de México. */
export function relativeDay(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = (d: Date) => Math.floor((d.getTime() - 6 * 3_600_000) / DAY);
  const diff = day(date) - day(now);
  if (diff === 0) return "hoy";
  if (diff === -1) return "ayer";
  if (diff === 1) return "mañana";
  return diff < 0 ? `hace ${-diff} días` : `en ${diff} días`;
}
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}
export function isOverdue(iso: string | null | undefined, now: Date = new Date()): boolean {
  return Boolean(iso) && new Date(iso!).getTime() < now.getTime();
}
/** Días sin que una persona lo toque (nota, cambio, tarea); si nunca, desde que respondió. */
export function daysUntouched(record: CrmRecord, now: Date = new Date()): number {
  const ref = record.last_touch_at ?? record.last_reply_at ?? record.created_at;
  return Math.max(0, Math.floor((now.getTime() - new Date(ref).getTime()) / DAY));
}

export type CrmView = "abiertos" | "por_calificar" | "mis" | "vencidos" | "ganados" | "cerrados" | "descartados" | "todos";
export const VIEW_LABELS: Record<CrmView, string> = {
  abiertos: "Abiertos", por_calificar: "Por calificar", mis: "Míos", vencidos: "Vencidos",
  ganados: "Ganados", cerrados: "Perdidos", descartados: "Descartados", todos: "Todos",
};
export function inView(record: CrmRecord, view: CrmView, me: string | null, now: Date = new Date()): boolean {
  switch (view) {
    case "abiertos": return OPEN_STAGES.includes(record.stage);
    case "por_calificar": return record.stage === "RESPONDIO";
    case "mis": return record.owner_user_id === me && record.stage !== "DESCARTADO";
    case "vencidos": return OPEN_STAGES.includes(record.stage) && (isOverdue(record.next_action_at, now) || isOverdue(record.next_task_at, now));
    case "ganados": return record.stage === "GANADO";
    case "cerrados": return record.stage === "PERDIDO";
    case "descartados": return record.stage === "DESCARTADO";
    case "todos": return true;
  }
}
export function matchesSearch(record: CrmRecord, query: string): boolean {
  const q = query.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (!q) return true;
  return [record.full_name, record.email, record.phone, record.company_name, record.role_title, record.city, record.state, record.next_action]
    .some((v) => v?.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").includes(q));
}

/** Orden por urgencia: vencidos primero, luego la siguiente acción más próxima, luego lo más reciente. */
export function byUrgency(now: Date = new Date()) {
  return (a: CrmRecord, b: CrmRecord): number => {
    const due = (r: CrmRecord) => [r.next_action_at, r.next_task_at].filter(Boolean).map((d) => new Date(d!).getTime()).sort((x, y) => x - y)[0] ?? Infinity;
    const da = due(a); const db = due(b);
    const oa = da < now.getTime() ? 0 : 1; const ob = db < now.getTime() ? 0 : 1;
    if (oa !== ob) return oa - ob;
    if (da !== db) return da - db;
    return new Date(b.last_reply_at ?? b.created_at).getTime() - new Date(a.last_reply_at ?? a.created_at).getTime();
  };
}

/** WhatsApp con lada de México si el número viene a 10 dígitos. */
export function whatsappLink(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  return `https://wa.me/${digits.length === 10 ? `52${digits}` : digits}`;
}
