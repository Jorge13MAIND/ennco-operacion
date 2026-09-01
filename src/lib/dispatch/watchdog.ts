import { z } from "zod";

export type WatchdogFinding = { level: "WARN" | "CRITICAL"; title: string; detail: string };

const healthSchema = z.object({
  last_tick: z.object({ created_at: z.iso.datetime({ offset: true }).or(z.string()) }).nullable().optional(),
  messages_today: z.record(z.string(), z.number()).optional(),
  active_release: z.object({
    daily_cap: z.number(),
    sent_today: z.number(),
    budget_remaining: z.number(),
    expires_at: z.string().optional(),
  }).nullable().optional(),
  latest_live_observation: z.object({ age_seconds: z.number() }).nullable().optional(),
  operations_health: z.object({ last_watchdog_status: z.string().nullable() }).partial().optional(),
  cadence_health: z.unknown().optional(),
  outbox: z.object({ pending: z.number(), due: z.number(), processing: z.number() }).partial().optional(),
  business_calendar: z.object({ future_business_days: z.number() }).partial().nullable().optional(),
  reply_operations: z.object({
    unreviewed_replies: z.number(),
    oldest_unreviewed_minutes: z.number().nullable(),
    open_reply_cases: z.number(),
    assignment_active: z.boolean(),
  }).partial().nullable().optional(),
}).passthrough();

export type DispatchHealthSnapshot = z.infer<typeof healthSchema>;

function minutesSince(iso: string | undefined, now: Date): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  return (now.getTime() - then) / 60_000;
}

function cdmxParts(now: Date): { weekday: number; minuteOfDay: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = new Map(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.get("weekday") ?? "");
  const hour = Number(parts.get("hour") ?? "0") % 24;
  return { weekday: weekdayIndex, minuteOfDay: hour * 60 + Number(parts.get("minute") ?? "0") };
}

export function isInsideSendWindow(now: Date): boolean {
  const { weekday, minuteOfDay } = cdmxParts(now);
  if (weekday < 1 || weekday > 5) return false;
  return minuteOfDay >= 9 * 60 + 30 && minuteOfDay < 13 * 60 + 30;
}

/**
 * SLOs del doctrine /operador-outbound sobre el read model del motor:
 * cron corrió, 0 enviados con budget libre, observación por caducar,
 * outbox atascado y salud de los gates. Función pura para poder testearla.
 */
export function evaluateDispatchWatchdog(input: {
  health: unknown;
  now: Date;
  dispatchMode: "shadow" | "live";
}): WatchdogFinding[] {
  const parsed = healthSchema.safeParse(input.health);
  if (!parsed.success) {
    return [{ level: "CRITICAL", title: "health ilegible", detail: "read_dispatch_health devolvió una forma inesperada" }];
  }
  const health = parsed.data;
  const findings: WatchdogFinding[] = [];
  const insideWindow = isInsideSendWindow(input.now);

  const tickAgeMinutes = minutesSince(health.last_tick?.created_at as string | undefined, input.now);
  if (insideWindow && (tickAgeMinutes === null || tickAgeMinutes > 15)) {
    findings.push({
      level: "CRITICAL",
      title: "el cron no está corriendo",
      detail: tickAgeMinutes === null ? "sin ticks registrados" : `último tick hace ${Math.round(tickAgeMinutes)} min en ventana de envío`,
    });
  }

  const release = health.active_release;
  if (input.dispatchMode === "live" && insideWindow && release) {
    const { minuteOfDay } = cdmxParts(input.now);
    const windowElapsed = (minuteOfDay - (9 * 60 + 30)) / 240;
    if (windowElapsed > 0.5 && release.sent_today === 0 && release.budget_remaining > 0) {
      findings.push({
        level: "CRITICAL",
        title: "0 enviados con budget libre",
        detail: `ventana ${Math.round(windowElapsed * 100)}% transcurrida, budget ${release.budget_remaining}`,
      });
    }
  }

  const observationAge = health.latest_live_observation?.age_seconds;
  if (input.dispatchMode === "live" && typeof observationAge === "number" && observationAge > 20 * 3600) {
    findings.push({
      level: "WARN",
      title: "observación live por caducar",
      detail: `edad ${(observationAge / 3600).toFixed(1)} h; a las 24 h el carril se bloquea solo`,
    });
  }

  const outbox = health.outbox;
  if (outbox && (outbox.due ?? 0) > 0 && !insideWindow) {
    findings.push({ level: "WARN", title: "outbox con eventos vencidos", detail: `${outbox.due} eventos due sin drenar` });
  }

  const operationsStatus = health.operations_health?.last_watchdog_status;
  if (insideWindow && operationsStatus && operationsStatus !== "HEALTHY") {
    findings.push({ level: "CRITICAL", title: "salud de operaciones caída", detail: `watchdog ${operationsStatus}` });
  }

  // El calendario hábil es un dato de producción que se agota con el tiempo, y
  // cuando se agota NO falla de forma visible: revientan la solicitud de
  // aprobación y el ruteo de las respuestas positivas. El 27-ago-2026 se
  // encontró vacío. Un gate local nunca puede ver esto; el vigilante sí.
  const futureBusinessDays = health.business_calendar?.future_business_days;
  if (typeof futureBusinessDays === "number") {
    if (futureBusinessDays < 20) {
      findings.push({
        level: "CRITICAL",
        title: "calendario hábil agotado",
        detail: `solo ${futureBusinessDays} días hábiles por delante; sin calendario no se pueden pedir aprobaciones ni rutear respuestas positivas`,
      });
    } else if (futureBusinessDays < 90) {
      findings.push({
        level: "WARN",
        title: "calendario hábil por agotarse",
        detail: `${futureBusinessDays} días hábiles por delante; sembrar el siguiente horizonte`,
      });
    }
  }

  // SLA de respuesta (docs/external/sla-de-respuesta.md). Dos modos de falla
  // que un gate local no puede ver: (1) en live, sin operational_assignment
  // ACTIVE cada positiva abre un caso P1 SIN dueño que nadie puede cerrar
  // (TASK_OWNER_REQUIRED) y el vencimiento congela el outbound; (2) una
  // respuesta sin clasificar no dispara nada por sí misma y el plazo de las
  // 18:00 corre aunque nadie la haya visto.
  const replyOps = health.reply_operations;
  if (replyOps) {
    if (input.dispatchMode === "live" && replyOps.assignment_active === false) {
      findings.push({
        level: "CRITICAL",
        title: "sin responsable de respuestas",
        detail: "no hay operational_assignment ACTIVE; una respuesta positiva abriría un caso P1 sin dueño. Sembrar con configure_single_teckel_operator",
      });
    }
    const unreviewed = replyOps.unreviewed_replies ?? 0;
    const oldestMinutes = replyOps.oldest_unreviewed_minutes ?? 0;
    if (unreviewed > 0 && oldestMinutes > 120) {
      findings.push({
        level: "CRITICAL",
        title: "respuestas sin clasificar",
        detail: `${unreviewed} respuesta(s) esperando, la más vieja hace ${(oldestMinutes / 60).toFixed(1)} h; el plazo de las 18:00 corre aunque nadie las abra`,
      });
    }
  }

  return findings;
}

export function formatDailySnapshot(input: {
  health: unknown;
  dispatchMode: "shadow" | "live";
  moment: "PREFLIGHT" | "CLOSE";
}): string[] {
  const parsed = healthSchema.safeParse(input.health);
  if (!parsed.success) return ["health ilegible: revisar read_dispatch_health"];
  const health = parsed.data;
  const release = health.active_release;
  const lines = [
    `modo: ${input.dispatchMode}${input.moment === "PREFLIGHT" ? " · pre-vuelo 09:45" : " · cierre 18:30"}`,
    release
      ? `release activo: ${release.sent_today}/${release.daily_cap} enviados · budget ${release.budget_remaining}`
      : "sin release activo para hoy",
  ];
  const observationAge = health.latest_live_observation?.age_seconds;
  if (typeof observationAge === "number") lines.push(`observación live: hace ${(observationAge / 3600).toFixed(1)} h`);
  const outbox = health.outbox;
  if (outbox) lines.push(`outbox: ${outbox.pending ?? 0} pendientes · ${outbox.due ?? 0} due`);
  return lines;
}
