import { readDirectLaneStatsSystem, storeDirectLaneWeeklyReport } from "@/lib/correos/client";
import { addDays, buildWeeklyRecommendations, cdmxDateToUtcIso, directLaneStatsSchema, weekStartCdmx, type DirectLaneStats } from "@/lib/correos/stats";
import { sendDispatchAlert } from "@/lib/dispatch/telegram";
import type { RuntimeConfig } from "@/lib/runtime/config";

/**
 * Ciclo de mejora de los viernes: lee la semana en curso (lunes 00:00 CDMX a
 * ahora) y la anterior, deriva recomendaciones, guarda el reporte y avisa por
 * Telegram. Corre en cron (viernes 14:00 CDMX) y también a mano.
 */
type WeeklyDeps = {
  readStats?: typeof readDirectLaneStatsSystem;
  store?: typeof storeDirectLaneWeeklyReport;
  alert?: typeof sendDispatchAlert;
  now?: () => Date;
};

export type WeeklyReportResult = { week_start: string; stored: boolean; recommendations: string[]; current: DirectLaneStats; previous: DirectLaneStats | null };

export async function runDirectLaneWeeklyReport(config: RuntimeConfig, deps: WeeklyDeps = {}): Promise<WeeklyReportResult> {
  const readStats = deps.readStats ?? readDirectLaneStatsSystem;
  const store = deps.store ?? storeDirectLaneWeeklyReport;
  const alert = deps.alert ?? sendDispatchAlert;
  const now = (deps.now ?? (() => new Date()))();
  const weekStart = weekStartCdmx(now);
  const prevStart = addDays(weekStart, -7);
  const current = directLaneStatsSchema.parse(await readStats(config, cdmxDateToUtcIso(weekStart), now.toISOString()));
  const previous = directLaneStatsSchema.parse(await readStats(config, cdmxDateToUtcIso(prevStart), cdmxDateToUtcIso(weekStart)));
  const recommendations = buildWeeklyRecommendations(current, previous.funnel.sends > 0 ? previous : null);
  const stored = await store(config, { weekStart, metrics: current, previous: previous.funnel.sends > 0 ? previous : null, recommendations });
  await alert({ config, level: "INFO", title: `ciclo semanal ${weekStart}`, lines: recommendations.slice(0, 6) }).catch(() => false);
  return { week_start: weekStart, stored: stored.status === "STORED", recommendations, current, previous: previous.funnel.sends > 0 ? previous : null };
}
