import { z } from "zod";

/**
 * Estadísticas del carril directo: embudo y cortes por buzón, variante,
 * estado y semana. La forma la produce app.direct_lane_stats_json; aquí se
 * valida y se derivan tasas y recomendaciones (el ciclo de mejora de los
 * viernes). Las tasas se calculan sobre denominadores explícitos: respuesta
 * sobre contactos alcanzados (toque 1 entregado), apertura sobre correos que
 * salieron con pixel. La apertura es direccional (ver open-pixel.ts).
 */
const rowSchema = z.object({
  key: z.string(),
  sends: z.number().int(),
  reached: z.number().int(),
  failed: z.number().int(),
  tracked: z.number().int(),
  opened: z.number().int(),
  replied: z.number().int(),
});
export const directLaneStatsSchema = z.object({
  since: z.string(),
  until: z.string(),
  campaign_id: z.string().nullable().optional(),
  funnel: z.object({
    enrolled: z.number().int(), reached: z.number().int(), sends: z.number().int(), failed: z.number().int(),
    bounced_enrollments: z.number().int(), replied: z.number().int(), positive: z.number().int(),
    unsubscribed: z.number().int(), tracked: z.number().int(), opened: z.number().int(), leads: z.number().int(),
  }),
  by: z.object({
    mailbox: z.array(rowSchema).optional(),
    variant: z.array(rowSchema).optional(),
    state: z.array(rowSchema).optional(),
    week: z.array(rowSchema).optional(),
  }).partial(),
});
export type DirectLaneStats = z.infer<typeof directLaneStatsSchema>;
export type DirectLaneStatsRow = z.infer<typeof rowSchema>;

export function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}
export function pct(value: number | null): string {
  return value === null ? "s/d" : `${(value * 100).toFixed(1)}%`;
}

/**
 * Ciclo de mejora: compara la semana contra la anterior y propone. Propone,
 * no aplica: el ajuste lo decide un humano. Mínimos de muestra explícitos
 * para no declarar ganadores con dos respuestas contra una.
 */
export function buildWeeklyRecommendations(current: DirectLaneStats, previous: DirectLaneStats | null): string[] {
  const out: string[] = [];
  const f = current.funnel;
  const replyRate = rate(f.replied, f.reached);
  const openRate = rate(f.opened, f.tracked);
  const failRate = deliveryFailRate(f);
  out.push(`Semana: ${f.reached} contactos alcanzados, ${f.sends} correos, ${f.replied} respuestas (${pct(replyRate)}), ${f.positive} positivas, ${f.leads} leads.`);
  if (f.tracked > 0) out.push(`Apertura direccional: ${f.opened} de ${f.tracked} correos con pixel (${pct(openRate)}).`);
  else out.push("Apertura: sin correos con pixel esta semana (se activa desde el toque 2).");
  if (previous) {
    const pr = rate(previous.funnel.replied, previous.funnel.reached);
    if (pr !== null && replyRate !== null) {
      const delta = replyRate - pr;
      out.push(`Respuesta contra la semana anterior: ${pct(pr)} → ${pct(replyRate)} (${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)} puntos).`);
    }
  }
  if (deliveryBrakes(f)) {
    out.push(`FRENO: fallos y rebotes al ${pct(failRate)} (umbral 2%). No subir el tope la próxima semana; revisar dominios y lista antes de continuar.`);
  } else if (failRate !== null && failRate > FAIL_RATE_THRESHOLD) {
    out.push(`Vigilar la entrega: ${f.failed} fallo(s) en ${f.sends + f.failed} intentos (${pct(failRate)}). Todavía es un caso aislado; si se repite la próxima semana, frenar.`);
  } else if (f.sends >= 20) {
    out.push("Entrega dentro del umbral (fallos y rebotes bajo 2%): la rampa puede continuar según lo programado.");
  }
  const variants = (current.by.variant ?? []).filter((r) => r.reached >= 20);
  if (variants.length >= 2) {
    const ranked = [...variants].sort((a, b) => (rate(b.replied, b.reached) ?? 0) - (rate(a.replied, a.reached) ?? 0));
    const best = ranked[0]; const worst = ranked[ranked.length - 1];
    if (best && worst && best.key !== worst.key) {
      out.push(`Variante que mejor responde: ${best.key} (${pct(rate(best.replied, best.reached))}) frente a ${worst.key} (${pct(rate(worst.replied, worst.reached))}), con al menos 20 alcanzados cada una. Sugerencia: revisar el copy de ${worst.key} antes de la próxima ola.`);
    }
  } else {
    out.push("Variantes: todavía no hay 20 contactos alcanzados por variante; no se declara ganadora.");
  }
  const mailboxes = (current.by.mailbox ?? []).filter((r) => r.sends >= 10);
  for (const m of mailboxes) {
    const fr = rate(m.failed, m.sends);
    if (fr !== null && fr > 0.05) out.push(`Buzón ${m.key}: fallos al ${pct(fr)}. Sugerencia: pausar ese buzón y revisar autenticación y lista.`);
  }
  const states = (current.by.state ?? []).filter((r) => r.reached >= 20);
  if (states.length >= 2) {
    const ranked = [...states].sort((a, b) => (rate(b.replied, b.reached) ?? 0) - (rate(a.replied, a.reached) ?? 0));
    const top = ranked[0];
    if (top) out.push(`Estado con mejor respuesta: ${top.key} (${pct(rate(top.replied, top.reached))}). Sugerencia: priorizar su reserva en la inscripción.`);
  }
  return out;
}

export function weekStartCdmx(reference: Date): string {
  // Lunes 00:00 de Ciudad de México (UTC-6, sin horario de verano desde 2022).
  const local = new Date(reference.getTime() - 6 * 3600 * 1000);
  const day = (local.getUTCDay() + 6) % 7; // 0 = lunes
  const monday = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}
export function cdmxDateToUtcIso(dateYmd: string): string {
  return `${dateYmd}T06:00:00.000Z`;
}
export function addDays(dateYmd: string, days: number): string {
  const d = new Date(`${dateYmd}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}

/**
 * Fallos de entrega sobre intentos. `failed` ya incluye los rebotes (el mensaje
 * queda BOUNCED), asi que `bounced_enrollments` no se suma: es la misma persona
 * vista desde la inscripcion, y contarla dos veces duplicaba la tasa.
 */
export const FAIL_RATE_THRESHOLD = 0.02;
/** Un rebote aislado en una semana chica no frena la rampa: hacen falta 25 intentos y 2 fallos. */
export const FAIL_RATE_MIN_ATTEMPTS = 25;
export const FAIL_RATE_MIN_FAILURES = 2;
export function deliveryFailRate(f: DirectLaneStats["funnel"]): number | null {
  return rate(f.failed, f.sends + f.failed);
}
export function deliveryBrakes(f: DirectLaneStats["funnel"]): boolean {
  const failRate = deliveryFailRate(f);
  return failRate !== null && f.sends + f.failed >= FAIL_RATE_MIN_ATTEMPTS && f.failed >= FAIL_RATE_MIN_FAILURES && failRate > FAIL_RATE_THRESHOLD;
}

export type Verdict = { level: "good" | "warn" | "critical" | "neutral"; title: string; detail: string };

/**
 * Veredicto del ciclo de los viernes, en una frase. Es el mismo criterio que
 * buildWeeklyRecommendations, resumido para leerse de un vistazo: frenar si la
 * entrega falla por encima del umbral con muestra suficiente, continuar si hay
 * volumen y la entrega esta limpia, y "sin muestra" mientras no haya 20 envios.
 */
export function weeklyVerdict(stats: DirectLaneStats): Verdict {
  const f = stats.funnel;
  const attempts = f.sends + f.failed;
  const failRate = deliveryFailRate(f);
  if (attempts === 0) {
    return { level: "neutral", title: "Sin envíos en el periodo", detail: "El veredicto aparece cuando el carril haya enviado correos reales." };
  }
  if (deliveryBrakes(f)) {
    return {
      level: "critical",
      title: "Frenar la rampa",
      detail: `Fallos y rebotes al ${pct(failRate)} de ${attempts} intentos (umbral 2%). No subir el tope; revisar dominios y lista antes de continuar.`,
    };
  }
  if (failRate !== null && failRate > FAIL_RATE_THRESHOLD) {
    return {
      level: "warn",
      title: "Vigilar la entrega",
      detail: `${f.failed} fallo(s) en ${attempts} intentos (${pct(failRate)}). Un caso aislado no frena la rampa; si se repite la próxima semana, sí.`,
    };
  }
  if (f.sends < 20) {
    return {
      level: "warn",
      title: "Muestra insuficiente",
      detail: `${f.sends} correos enviados; el ciclo decide con 20 o más. Entrega limpia hasta ahora (${f.failed} fallos).`,
    };
  }
  return {
    level: "good",
    title: "Continuar la rampa",
    detail: `Entrega dentro del umbral (fallos y rebotes al ${pct(failRate)} de ${attempts} intentos). La rampa puede seguir según lo programado.`,
  };
}

export type FunnelStage = { key: string; label: string; value: number; ofPrevious: number | null };

/** Etapas del embudo en orden, con la conversion respecto a la etapa anterior. */
export function funnelStages(f: DirectLaneStats["funnel"]): FunnelStage[] {
  const raw: Array<[string, string, number]> = [
    ["enrolled", "Inscritos", f.enrolled],
    ["reached", "Alcanzados", f.reached],
    ["replied", "Respondieron", f.replied],
    ["positive", "Positivas", f.positive],
    ["leads", "Leads", f.leads],
  ];
  return raw.map(([key, label, value], index) => ({
    key, label, value,
    ofPrevious: index === 0 ? null : rate(value, raw[index - 1]![2]),
  }));
}

export type Delta = { diff: number; direction: "up" | "down" | "flat" };

/** Variacion absoluta contra el periodo anterior; null cuando no hay con que comparar. */
export function periodDelta(current: number, previous: number | null | undefined): Delta | null {
  if (previous === null || previous === undefined) return null;
  const diff = current - previous;
  return { diff, direction: diff > 0 ? "up" : diff < 0 ? "down" : "flat" };
}

const integerFormat = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
export function formatInteger(value: number): string {
  return integerFormat.format(value);
}
export function formatSignedInteger(value: number): string {
  return value > 0 ? `+${integerFormat.format(value)}` : integerFormat.format(value);
}
