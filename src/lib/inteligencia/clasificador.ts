/**
 * Clasificación asistida de respuestas (patrón del agente 03 de Atlas).
 *
 * Diferencia deliberada con Atlas: aquí la máquina NUNCA clasifica, sólo
 * propone. El handover del 1-sep dice que clasificar es manual y siempre lo
 * será por diseño, y hay una razón dura detrás: marcar POSITIVE crea un lead,
 * asigna una tarea y abre un caso SLA P1 con vencimiento a las 18:00; si ese
 * caso vence, congela todo el outbound. Una decisión irreversible con ese
 * radio de daño no se automatiza.
 *
 * Lo que sí resuelve esta capa es el defecto de interfaz documentado como
 * hueco: el select de clasificar viene con "Positiva" preseleccionada, así que
 * un clic distraído marca POSITIVE. Con una sugerencia visible y su evidencia
 * al lado, el operador llega a la decisión leyendo, no adivinando.
 *
 * Determinista a propósito: sin proveedor LLM no hay costo por respuesta, no
 * hay latencia en la bandeja, y la misma respuesta produce siempre la misma
 * sugerencia, que es lo que permite probarla.
 */

export const CLASSIFIER_VERSION = "clasificador-v1-2026-09-02";

/** Los nueve intents del response playbook v1. */
export type ReplyIntent =
  | "POSITIVE"
  | "REFERRAL"
  | "NOT_NOW"
  | "WHAT_IS_THIS"
  | "PRICE_OBJECTION"
  | "CHEAPER_VENDOR"
  | "INTERNAL_ALIGNMENT"
  | "COMMERCIAL_COMMITMENT"
  | "UNSUBSCRIBE";

/** Las tres opciones que el operador puede elegir en el Control Room. */
export type SuggestedClassification = "POSITIVE" | "NEUTRAL" | "NEGATIVE";

export interface ReplySuggestion {
  readonly intent: ReplyIntent;
  readonly classification: SuggestedClassification;
  /** 0 a 1. Bajo 0.5 la interfaz debe pedir lectura completa antes de decidir. */
  readonly confidence: number;
  /** Frases exactas que dispararon la propuesta. Es la evidencia del operador. */
  readonly signals: readonly string[];
  readonly classifier_version: string;
  /** Verdadero si el texto sugiere trato humano inmediato aunque no sea POSITIVE. */
  readonly needs_human_now: boolean;
}

interface Rule {
  readonly intent: ReplyIntent;
  readonly classification: SuggestedClassification;
  readonly patterns: readonly RegExp[];
  readonly weight: number;
  readonly needs_human_now?: boolean;
}

/**
 * Orden de precedencia, de arriba hacia abajo. UNSUBSCRIBE va primero porque
 * es obligación legal (LFPDPPP) y no admite competencia con otro intent: si
 * alguien pide la baja, eso es lo que pasó, aunque en el mismo correo diga
 * algo que suene positivo.
 */
const RULES: readonly Rule[] = [
  {
    intent: "UNSUBSCRIBE",
    classification: "NEGATIVE",
    weight: 1,
    needs_human_now: true,
    patterns: [
      /\bbaj(a|arme|enme)\b/i,
      /\bdar de baja\b/i,
      /\bno (me )?(vuelvas?|vuelvan|volver) a (escribir|contactar|enviar)\b/i,
      /\bdeja(r|me|n)? de (enviar|mandar|escribir)\b/i,
      /\bquit(ar|arme|enme)\s+(de\s+)?(la\s+)?lista\b/i,
      /\bno deseo recibir\b/i,
      /\bunsubscribe\b/i,
      /\bopt[- ]?out\b/i,
      /\bderechos? arco\b/i,
      /\bcancel(ar|en) (la )?suscrip/i,
    ],
  },
  {
    intent: "REFERRAL",
    classification: "POSITIVE",
    weight: 0.9,
    needs_human_now: true,
    patterns: [
      /\b(te|lo|los) (paso|canalizo|conecto|derivo)\b/i,
      /\bcomunicate con\b/i,
      /\bcontacta(r)? (a|con)\b/i,
      /\b(habla|hable|hablar) (con|directamente con)\b/i,
      /\b(quien|el|la) (ve|lleva|maneja|atiende) (eso|esto|mantenimiento|compras)\b/i,
      /\bte (copio|pongo en copia)\b/i,
      /\ben copia a\b/i,
      /\bmi? (colega|companer[oa]|jefe|director|gerente)\b/i,
      /\bes responsabilidad de\b/i,
      /\bcorrespond(e|eria) a\b/i,
    ],
  },
  {
    intent: "COMMERCIAL_COMMITMENT",
    classification: "POSITIVE",
    weight: 0.95,
    needs_human_now: true,
    patterns: [
      /\b(agenda|agendemos|agendar|calendar(iz|ic)emos)\b/i,
      /\b(reunion|junta|llamada|videollamada|meet|cita)\b.*\b(cuando|disponib|proponme|podemos|agenda)/i,
      /\b(cuando|que dia|que hora).*\b(puedes|podrian|nos vemos|te queda)\b/i,
      /\bvisita (tecnica|a planta|de levantamiento)\b/i,
      /\bhagamos el levantamiento\b/i,
      /\bpasa(r)? (a|por) (la )?planta\b/i,
    ],
  },
  {
    intent: "POSITIVE",
    classification: "POSITIVE",
    weight: 0.85,
    needs_human_now: true,
    patterns: [
      /\bs[ií],? me interesa\b/i,
      /\bme interesa\b/i,
      /\bnos interesa\b/i,
      /\b(mandame|envia(me|nos)?|comparte(me|nos)?|puedes? enviar)\b.*\b(informacion|formato|reporte|propuesta|cotizacion|alcance|detalle)/i,
      /\b(quisiera|queremos|quiero) (saber|conocer|ver|recibir)\b/i,
      /\bcuentame mas\b/i,
      /\bmas informacion\b/i,
      /\bde que se trata.*\b(me interesa|suena bien)/i,
      /\bsuena (bien|interesante)\b/i,
    ],
  },
  {
    intent: "PRICE_OBJECTION",
    classification: "NEUTRAL",
    weight: 0.75,
    patterns: [
      /\b(cuanto|que) (cuesta|vale|precio)\b/i,
      /\bcosto(s)? (aproximado|estimado|del servicio)\b/i,
      /\bpresupuesto\b.*\b(limitado|ajustado|no hay|sin)/i,
      /\bfuera de (nuestro )?presupuesto\b/i,
      /\bmuy (caro|elevado|alto)\b/i,
      /\bno tenemos presupuesto\b/i,
    ],
  },
  {
    intent: "CHEAPER_VENDOR",
    classification: "NEUTRAL",
    weight: 0.75,
    patterns: [
      /\bya (tenemos|contamos con|trabajamos con)\b.*\b(proveedor|empresa|contratista)/i,
      /\botro proveedor\b/i,
      /\bnos (dan|ofrecen|cotizaron) (mas )?barato\b/i,
      /\bmas economico\b/i,
      /\btenemos contrato con\b/i,
      /\bya nos (dan|hacen) (el )?(servicio|mantenimiento)\b/i,
    ],
  },
  {
    intent: "INTERNAL_ALIGNMENT",
    classification: "NEUTRAL",
    weight: 0.7,
    patterns: [
      /\blo (veo|vemos|reviso|revisamos) (internamente|con el equipo|en comite)\b/i,
      /\btengo que consultar(lo)?\b/i,
      /\bdepende de (corporativo|matriz|direccion)\b/i,
      /\blo comento con\b/i,
      /\bpasarlo por (comite|compras|corporativo)\b/i,
      /\bnecesito autorizacion\b/i,
    ],
  },
  {
    intent: "NOT_NOW",
    classification: "NEUTRAL",
    weight: 0.7,
    patterns: [
      /\b(mas|hasta el proximo|el proximo|el siguiente) (adelante|ano|trimestre|semestre|mes)\b/i,
      /\bahorita no\b/i,
      /\bpor el momento no\b/i,
      /\bno es (el momento|prioridad)\b/i,
      /\bvuelve(me)? a (contactar|escribir|buscar) en\b/i,
      /\bretoma(r|mos) (esto )?en\b/i,
      /\bestamos ocupados\b/i,
    ],
  },
  {
    intent: "WHAT_IS_THIS",
    classification: "NEUTRAL",
    weight: 0.6,
    patterns: [
      /\bquien(es)? (son|eres)\b/i,
      /\bde que (empresa|compania)\b/i,
      /\bde donde (sacaron|obtuvieron) mi\b/i,
      /\bno (entiendo|comprendo)\b/i,
      /\bde que se trata\b/i,
      /\ba que se dedican\b/i,
    ],
  },
];

/** Frases que indican rechazo directo sin pedir baja. */
const HARD_NO: readonly RegExp[] = [
  /\bno (nos |me )?interesa\b/i,
  /\bno,? gracias\b/i,
  /\bno requerimos\b/i,
  /\bno necesitamos\b/i,
  /\bno aplica\b/i,
];

/** Respuestas automáticas: no son humanas y no deben disparar SLA. */
const AUTO_REPLY: readonly RegExp[] = [
  /\bfuera de (la )?oficina\b/i,
  /\bout of office\b/i,
  /\bauto(matic|-)?reply\b/i,
  /\brespuesta automatica\b/i,
  /\bvacacion(es)?\b/i,
  /\bincapacidad medica\b/i,
  /\bya no (labora|trabaja) (aqui|en la empresa)\b/i,
];

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Devuelve la sugerencia para una respuesta entrante.
 *
 * Nunca escribe nada ni decide: el resultado se guarda como propuesta y el
 * operador la confirma o la ignora en el Control Room.
 */
export function classifyReply(input: { subject: string | null; body: string | null }): ReplySuggestion {
  const raw = `${input.subject ?? ""}\n${input.body ?? ""}`;
  const text = normalize(raw);

  if (text.length === 0) {
    return {
      intent: "WHAT_IS_THIS",
      classification: "NEUTRAL",
      confidence: 0,
      signals: ["respuesta sin texto legible"],
      classifier_version: CLASSIFIER_VERSION,
      needs_human_now: false,
    };
  }

  const autoSignals = AUTO_REPLY.filter((pattern) => pattern.test(text)).map((p) => describe(text, p));
  if (autoSignals.length > 0) {
    return {
      intent: "WHAT_IS_THIS",
      classification: "NEUTRAL",
      confidence: 0.9,
      signals: ["parece respuesta automática", ...autoSignals],
      classifier_version: CLASSIFIER_VERSION,
      needs_human_now: false,
    };
  }

  for (const rule of RULES) {
    const hits = rule.patterns.filter((pattern) => pattern.test(text));
    if (hits.length === 0) continue;

    // Un rechazo explícito cancela una lectura positiva: "me mandas info pero
    // no nos interesa" no es un lead.
    const hardNo = HARD_NO.filter((pattern) => pattern.test(text));
    if (rule.classification === "POSITIVE" && hardNo.length > 0) {
      return {
        intent: "NOT_NOW",
        classification: "NEGATIVE",
        confidence: 0.7,
        signals: ["señal positiva contradicha por rechazo explícito", ...hardNo.map((p) => describe(text, p))],
        classifier_version: CLASSIFIER_VERSION,
        needs_human_now: false,
      };
    }

    // Más coincidencias suben la confianza, con techo por regla.
    const confidence = Math.min(rule.weight, rule.weight * (0.75 + 0.25 * Math.min(hits.length, 3)));
    return {
      intent: rule.intent,
      classification: rule.classification,
      confidence: Number(confidence.toFixed(2)),
      signals: hits.map((pattern) => describe(text, pattern)),
      classifier_version: CLASSIFIER_VERSION,
      needs_human_now: rule.needs_human_now === true,
    };
  }

  const hardNo = HARD_NO.filter((pattern) => pattern.test(text));
  if (hardNo.length > 0) {
    return {
      intent: "NOT_NOW",
      classification: "NEGATIVE",
      confidence: 0.8,
      signals: hardNo.map((pattern) => describe(text, pattern)),
      classifier_version: CLASSIFIER_VERSION,
      needs_human_now: false,
    };
  }

  return {
    intent: "WHAT_IS_THIS",
    classification: "NEUTRAL",
    confidence: 0.2,
    signals: ["ninguna señal conocida; requiere lectura completa"],
    classifier_version: CLASSIFIER_VERSION,
    needs_human_now: false,
  };
}

/** Recorta el fragmento que disparó la regla para mostrarlo como evidencia. */
function describe(text: string, pattern: RegExp): string {
  const match = pattern.exec(text);
  if (!match) return pattern.source;
  const start = Math.max(0, match.index - 20);
  const end = Math.min(text.length, match.index + match[0].length + 20);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

export const INTENT_LABELS: Record<ReplyIntent, string> = {
  POSITIVE: "Interés expreso",
  REFERRAL: "Referido a otra persona",
  NOT_NOW: "Ahora no",
  WHAT_IS_THIS: "Pide contexto",
  PRICE_OBJECTION: "Objeción de precio",
  CHEAPER_VENDOR: "Ya tiene proveedor",
  INTERNAL_ALIGNMENT: "Alineación interna",
  COMMERCIAL_COMMITMENT: "Compromiso comercial",
  UNSUBSCRIBE: "Solicitud de baja",
};

export const CLASSIFICATION_LABELS: Record<SuggestedClassification, string> = {
  POSITIVE: "Positiva",
  NEUTRAL: "Neutral",
  NEGATIVE: "Negativa",
};
