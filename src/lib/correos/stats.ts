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
  const failRate = rate(f.failed + f.bounced_enrollments, f.sends);
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
  if (failRate !== null && failRate > 0.02) {
    out.push(`FRENO: fallos y rebotes al ${pct(failRate)} (umbral 2%). No subir el tope la próxima semana; revisar dominios y lista antes de continuar.`);
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
