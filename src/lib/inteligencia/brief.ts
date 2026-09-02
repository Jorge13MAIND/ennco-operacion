/**
 * Brief de operación (patrón de los agentes 11 y 12 de Atlas: morning brief y
 * EOD analysis, adaptados a una sola función con dos momentos).
 *
 * El programa depende de que alguien conteste a tiempo: una respuesta positiva
 * vencida abre un incidente P1, y un P1 abierto detiene todos los envíos. El
 * brief existe para que ese riesgo se vea antes de que ocurra, no después.
 *
 * Sin LLM: los datos ya viven en el informe de salud y en el resumen del
 * carril. Lo que faltaba era ordenarlos por consecuencia en vez de por tabla.
 */

export type BriefMoment = "PREFLIGHT" | "CLOSE";

export type BriefSeverity = "CRITICAL" | "WARNING" | "INFO";

export interface BriefItem {
  readonly severity: BriefSeverity;
  readonly title: string;
  readonly detail: string;
  /** Qué hacer, en imperativo. Vacío cuando no hay acción humana posible. */
  readonly action: string;
}

export interface BriefInput {
  readonly moment: BriefMoment;
  readonly generatedAt: string;
  /** Respuestas humanas que nadie ha clasificado todavía. */
  readonly unreviewedReplies: number;
  /** Antigüedad de la más vieja sin clasificar, en minutos. */
  readonly oldestUnreviewedMinutes: number | null;
  readonly openP0: number;
  readonly openP1: number;
  /** Casos SLA de respuesta positiva abiertos. */
  readonly openReplyCases: number;
  /** Falso cuando no hay responsable activo: el ruteo asigna dueño NULL. */
  readonly assignmentActive: boolean;
  readonly externalSendAllowed: boolean;
  /** Botón de apagado global encendido: ningún envío sale mientras lo esté. */
  readonly botonDeApagado: boolean;
  readonly mailboxes: readonly {
    readonly email: string;
    readonly status: string;
    readonly sentToday: number;
    readonly capToday: number;
  }[];
  /** Sugerencias del clasificador que piden trato humano inmediato. */
  readonly suggestionsNeedingHuman: number;
  /** Cuentas puntuadas en banda A que todavía no están inscritas. */
  readonly priorityAccountsReady: number;
}

export interface Brief {
  readonly moment: BriefMoment;
  readonly generatedAt: string;
  readonly headline: string;
  readonly items: readonly BriefItem[];
  readonly severity: BriefSeverity;
}

/** Umbral del watchdog: dos horas sin clasificar ya es riesgo de SLA. */
const UNREVIEWED_WARN_MINUTES = 120;

export function buildBrief(input: BriefInput): Brief {
  const items: BriefItem[] = [];

  // 1. Lo que puede congelar el canal va primero, siempre.
  if (input.openP0 > 0 || input.openP1 > 0) {
    items.push({
      severity: "CRITICAL",
      title: `${input.openP0} P0 y ${input.openP1} P1 abiertos`,
      detail: "Mientras haya un incidente P1 abierto el motor no libera ningún envío.",
      action: "Recorrer el ciclo del incidente en Alertas hasta RESOLVED.",
    });
  }

  if (!input.assignmentActive) {
    items.push({
      severity: "CRITICAL",
      title: "Sin responsable activo",
      detail: "Las respuestas que entren no tendrán a quién asignarse y abrirán incidentes que nadie puede cerrar.",
      action: "Activar la asignación operativa antes de que entre la siguiente respuesta.",
    });
  }

  // 2. Respuestas esperando: el fracaso más caro es una positiva que se enfría.
  if (input.unreviewedReplies > 0) {
    const minutes = input.oldestUnreviewedMinutes ?? 0;
    const late = minutes >= UNREVIEWED_WARN_MINUTES;
    items.push({
      severity: late ? "CRITICAL" : "WARNING",
      title: `${input.unreviewedReplies} respuesta${input.unreviewedReplies === 1 ? "" : "s"} sin clasificar`,
      detail: input.oldestUnreviewedMinutes === null
        ? "Sin marca de tiempo de la más antigua."
        : `La más antigua lleva ${formatMinutes(minutes)} esperando.`,
      action: late
        ? "Clasificarlas ahora: el plazo de las 18:00 corre aunque nadie las haya abierto."
        : "Clasificarlas hoy, meta menos de 2 horas.",
    });
  }

  if (input.suggestionsNeedingHuman > 0) {
    items.push({
      severity: "WARNING",
      title: `${input.suggestionsNeedingHuman} con señal de trato humano`,
      detail: "El clasificador propone interés, referido, compromiso o baja. La decisión sigue siendo del operador.",
      action: "Revisar la sugerencia y su evidencia antes de elegir en el select.",
    });
  }

  if (input.openReplyCases > 0) {
    items.push({
      severity: "WARNING",
      title: `${input.openReplyCases} caso${input.openReplyCases === 1 ? "" : "s"} SLA de respuesta positiva`,
      detail: "Vencen a las 18:00 CDMX del mismo día hábil.",
      action: "Responder y cerrar el caso con evidencia.",
    });
  }

  // 3. Estado del canal.
  if (input.botonDeApagado) {
    items.push({
      severity: "INFO",
      title: "Botón de apagado activo",
      detail: "Ningún envío sale mientras siga encendido. Es un control deliberado, no una falla.",
      action: "",
    });
  }

  const connected = input.mailboxes.filter((m) => m.status === "CONNECTED");
  const sentToday = input.mailboxes.reduce((total, m) => total + m.sentToday, 0);
  const capToday = input.mailboxes.reduce((total, m) => total + m.capToday, 0);

  if (connected.length === 0) {
    items.push({
      severity: input.moment === "PREFLIGHT" ? "WARNING" : "INFO",
      title: "Ningún buzón conectado",
      detail: `${input.mailboxes.length} buzón${input.mailboxes.length === 1 ? "" : "es"} registrado${input.mailboxes.length === 1 ? "" : "s"}, cero con credencial activa.`,
      action: "Conectar por invitación desde Correos.",
    });
  } else {
    items.push({
      severity: "INFO",
      title: `${sentToday} de ${capToday} envíos hoy`,
      detail: `${connected.length} buzón${connected.length === 1 ? "" : "es"} conectado${connected.length === 1 ? "" : "s"}. La rampa sube sola sólo con entregas limpias.`,
      action: "",
    });
  }

  if (input.priorityAccountsReady > 0) {
    items.push({
      severity: "INFO",
      title: `${input.priorityAccountsReady} cuentas de prioridad alta sin inscribir`,
      detail: "Banda A del ICP: cumplen estado contractual, tamaño, giro intensivo y certificado.",
      action: "Inscribirlas en la campaña cuando haya capacidad de rampa.",
    });
  }

  const severity: BriefSeverity = items.some((i) => i.severity === "CRITICAL")
    ? "CRITICAL"
    : items.some((i) => i.severity === "WARNING") ? "WARNING" : "INFO";

  return {
    moment: input.moment,
    generatedAt: input.generatedAt,
    headline: headline(input, severity),
    items,
    severity,
  };
}

function headline(input: BriefInput, severity: BriefSeverity): string {
  if (severity === "CRITICAL") return input.moment === "PREFLIGHT" ? "Hay algo que atender antes de operar" : "El día cierra con pendientes que bloquean";
  if (severity === "WARNING") return input.moment === "PREFLIGHT" ? "El canal opera, con pendientes" : "El día cierra con pendientes";
  if (!input.externalSendAllowed) return "Canal en espera, sin pendientes de operación";
  return input.moment === "PREFLIGHT" ? "Todo en orden para operar" : "El día cierra limpio";
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} minutos`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Renderiza el brief como líneas de texto para Telegram. */
export function formatBriefLines(brief: Brief): string[] {
  const icon: Record<BriefSeverity, string> = { CRITICAL: "🔴", WARNING: "🟡", INFO: "⚪" };
  const title = brief.moment === "PREFLIGHT" ? "Brief de apertura" : "Cierre del día";
  return [
    `${icon[brief.severity]} ${title}: ${brief.headline}`,
    ...brief.items.map((item) => `${icon[item.severity]} ${item.title}. ${item.detail}${item.action ? ` → ${item.action}` : ""}`),
  ];
}
