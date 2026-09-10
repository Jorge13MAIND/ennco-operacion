import { z } from "zod";

import type { OperationsAccessContext } from "@/lib/auth/authorization";
import { loadDirectLaneScreen } from "@/lib/correos/overview";
import { addDays, cdmxDateToUtcIso, directLaneStatsSchema, weekStartCdmx, type DirectLaneStats } from "@/lib/correos/stats";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Pantalla Estadísticas (/operacion/correos/estadisticas). Una campaña a la
 * vez: la prueba interna nunca se mezcla con la campaña real salvo que alguien
 * elija "Todas". Tres lecturas por carga: el periodo elegido, el periodo
 * anterior (para las variaciones) y la vida de la campaña (para la tendencia
 * semanal y el embudo acumulado), más los reportes de los viernes.
 */

const weeklyReportSchema = z.object({
  week_start: z.string(),
  generated_at: z.string(),
  metrics: directLaneStatsSchema,
  previous: directLaneStatsSchema.nullable().optional(),
  recommendations: z.array(z.string()),
});
export type DirectLaneWeeklyReport = z.infer<typeof weeklyReportSchema>;

export const STATS_RANGES = ["semana", "30", "campana"] as const;
export type StatsRange = (typeof STATS_RANGES)[number];
export const ALL_CAMPAIGNS = "todas";

export type CampaignOption = { id: string; name: string; state: "DRAFT" | "RUNNING" | "PAUSED" | "COMPLETED"; createdAt: string };

export type DirectLaneStatsPage = {
  evidenceClass: "live" | "synthetic_demo";
  weekStart: string;
  campaigns: CampaignOption[];
  /** null = todas las campañas del carril. */
  selected: CampaignOption | null;
  range: StatsRange;
  period: { since: string; until: string };
  current: DirectLaneStats;
  /** Periodo anterior de la misma duración; null en "campana" (no hay anterior). */
  previous: DirectLaneStats | null;
  /** Desde que existe la campaña: tendencia por semana y embudo acumulado. */
  lifetime: DirectLaneStats;
  reports: DirectLaneWeeklyReport[];
};

export function parseStatsRange(value: string | undefined): StatsRange {
  return (STATS_RANGES as readonly string[]).includes(value ?? "") ? (value as StatsRange) : "semana";
}

function pickDefaultCampaign(campaigns: CampaignOption[]): CampaignOption | null {
  return campaigns.find((c) => c.state === "RUNNING") ?? campaigns.find((c) => c.state !== "COMPLETED") ?? campaigns[0] ?? null;
}

function resolveSelected(campaigns: CampaignOption[], requested: string | undefined): CampaignOption | null {
  if (requested === ALL_CAMPAIGNS) return null;
  return campaigns.find((c) => c.id === requested) ?? pickDefaultCampaign(campaigns);
}

type Window = { since: string; until: string };

/** Ventanas del periodo elegido y del anterior, en UTC, con lunes CDMX como ancla semanal. */
export function statsWindows(range: StatsRange, now: Date, campaignCreatedAt: string | null): { current: Window; previous: Window | null; lifetime: Window } {
  const untilIso = now.toISOString();
  const weekStart = weekStartCdmx(now);
  const lifetimeSince = campaignCreatedAt ?? cdmxDateToUtcIso(addDays(weekStart, -26 * 7));
  const lifetime = { since: lifetimeSince, until: untilIso };
  if (range === "campana") return { current: lifetime, previous: null, lifetime };
  if (range === "30") {
    const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const previousSince = new Date(now.getTime() - 60 * 86_400_000).toISOString();
    return { current: { since, until: untilIso }, previous: { since: previousSince, until: since }, lifetime };
  }
  const since = cdmxDateToUtcIso(weekStart);
  return { current: { since, until: untilIso }, previous: { since: cdmxDateToUtcIso(addDays(weekStart, -7)), until: since }, lifetime };
}

function emptyStats(window: Window, campaignId: string | null): DirectLaneStats {
  return {
    since: window.since, until: window.until, campaign_id: campaignId,
    funnel: { enrolled: 0, reached: 0, sends: 0, failed: 0, bounced_enrollments: 0, replied: 0, positive: 0, unsubscribed: 0, tracked: 0, opened: 0, leads: 0 },
    by: {},
  };
}

/**
 * Ejemplo operativo para la app sin Supabase (CI, demo). Los números son
 * inventados y la pantalla lo dice; sirven para ver la forma, no el negocio.
 */
export function getSyntheticDirectLaneStatsPage(now = new Date(), requested?: { campana?: string; rango?: string }): DirectLaneStatsPage {
  const weekStart = weekStartCdmx(now);
  const campaigns: CampaignOption[] = [
    { id: "41000000-0000-4000-8000-000000000301", name: "SIMULACION · Bajío industrial", state: "RUNNING", createdAt: cdmxDateToUtcIso(addDays(weekStart, -35)) },
    { id: "41000000-0000-4000-8000-000000000302", name: "SIMULACION · prueba interna", state: "COMPLETED", createdAt: cdmxDateToUtcIso(addDays(weekStart, -42)) },
  ];
  const selected = resolveSelected(campaigns, requested?.campana);
  const range = parseStatsRange(requested?.rango);
  const windows = statsWindows(range, now, selected?.createdAt ?? null);
  const row = (key: string, reached: number, sends: number, failed: number, replied: number, tracked = 0, opened = 0) => ({ key, sends, reached, failed, tracked, opened, replied });
  const weeks = [-5, -4, -3, -2, -1, 0].map((offset, index) => {
    const reached = [25, 48, 71, 96, 120, 40][index]!;
    return row(addDays(weekStart, offset * 7), reached, Math.round(reached * 1.6), index === 2 ? 3 : 1, Math.round(reached * 0.06), Math.round(reached * 0.5), Math.round(reached * 0.2));
  });
  const lifetime: DirectLaneStats = {
    since: windows.lifetime.since, until: windows.lifetime.until, campaign_id: selected?.id ?? null,
    funnel: { enrolled: 420, reached: 400, sends: 640, failed: 8, bounced_enrollments: 6, replied: 24, positive: 9, unsubscribed: 2, tracked: 210, opened: 84, leads: 3 },
    by: {
      variant: [row("DIRECCION", 110, 176, 2, 9, 60, 26), row("MANTENIMIENTO", 150, 240, 3, 8, 80, 30), row("SEGURIDAD", 80, 128, 2, 4, 40, 15), row("COMPRAS", 60, 96, 1, 3, 30, 13)],
      mailbox: [row("contacto@ennco.com.mx", 160, 256, 2, 11, 90, 38), row("francisco@enncoenergia.com", 90, 144, 3, 6, 45, 17), row("francisco@enncoindustrial.com", 80, 128, 2, 4, 40, 16), row("fcuellar@enncoenergia.com", 40, 64, 1, 2, 20, 8), row("fcuellar@enncoindustrial.com", 30, 48, 0, 1, 15, 5)],
      state: [row("Querétaro", 180, 288, 3, 12, 95, 40), row("Guanajuato", 120, 192, 3, 7, 60, 24), row("Jalisco", 100, 160, 2, 5, 55, 20)],
      week: weeks,
    },
  };
  const current: DirectLaneStats = range === "campana" ? lifetime : {
    since: windows.current.since, until: windows.current.until, campaign_id: selected?.id ?? null,
    funnel: range === "30"
      ? { enrolled: 300, reached: 287, sends: 470, failed: 5, bounced_enrollments: 4, replied: 19, positive: 7, unsubscribed: 1, tracked: 180, opened: 71, leads: 2 }
      : { enrolled: 45, reached: 40, sends: 64, failed: 1, bounced_enrollments: 1, replied: 3, positive: 1, unsubscribed: 0, tracked: 24, opened: 9, leads: 0 },
    by: lifetime.by,
  };
  const previous: DirectLaneStats | null = windows.previous === null ? null : {
    since: windows.previous.since, until: windows.previous.until, campaign_id: selected?.id ?? null,
    funnel: range === "30"
      ? { enrolled: 120, reached: 113, sends: 170, failed: 3, bounced_enrollments: 2, replied: 5, positive: 2, unsubscribed: 1, tracked: 30, opened: 13, leads: 1 }
      : { enrolled: 120, reached: 120, sends: 190, failed: 2, bounced_enrollments: 2, replied: 8, positive: 3, unsubscribed: 1, tracked: 70, opened: 28, leads: 1 },
    by: {},
  };
  return {
    evidenceClass: "synthetic_demo", weekStart, campaigns, selected, range,
    period: windows.current, current, previous, lifetime,
    reports: [{
      week_start: addDays(weekStart, -7), generated_at: cdmxDateToUtcIso(addDays(weekStart, -3)).replace("T06:00", "T20:00"),
      metrics: previous ?? lifetime, previous: null,
      recommendations: [
        "Semana: 120 contactos alcanzados, 190 correos, 8 respuestas (6.7%), 3 positivas, 1 lead.",
        "Entrega dentro del umbral (fallos y rebotes bajo 2%): la rampa puede continuar según lo programado.",
        "Variantes: todavía no hay 20 contactos alcanzados por variante; no se declara ganadora.",
      ],
    }],
  };
}

export async function loadDirectLaneStatsPage(access: OperationsAccessContext, requested: { campana?: string; rango?: string }): Promise<DirectLaneStatsPage> {
  const now = new Date();
  if (access.evidenceClass !== "live" || !access.organizationId) return getSyntheticDirectLaneStatsPage(now, requested);
  const screen = await loadDirectLaneScreen(access);
  const campaigns: CampaignOption[] = screen.overview.campaigns
    .map((c) => ({ id: c.campaign_id, name: c.name, state: c.state, createdAt: c.created_at }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const selected = resolveSelected(campaigns, requested.campana);
  const range = parseStatsRange(requested.rango);
  const windows = statsWindows(range, now, selected?.createdAt ?? null);
  const client = await createSupabaseServerClient();
  const org = access.organizationId;
  const read = async (window: Window) => {
    const args: Record<string, string> = { target_organization_id: org, since_at: window.since, until_at: window.until };
    if (selected) args.target_campaign_id = selected.id;
    const { data, error } = await client.rpc("read_direct_lane_stats", args);
    if (error) throw new Error("DIRECT_LANE_STATS_UNAVAILABLE");
    return directLaneStatsSchema.parse(data);
  };
  const [current, previous, lifetime, reports] = await Promise.all([
    read(windows.current),
    windows.previous ? read(windows.previous) : Promise.resolve(null),
    range === "campana" ? Promise.resolve(null) : read(windows.lifetime),
    client.rpc("read_direct_lane_weekly_reports", { target_organization_id: org }),
  ]);
  return {
    evidenceClass: "live",
    weekStart: weekStartCdmx(now),
    campaigns, selected, range,
    period: windows.current,
    current,
    previous,
    lifetime: lifetime ?? current,
    reports: reports.error ? [] : z.array(weeklyReportSchema).parse(reports.data ?? []),
  };
}

export { emptyStats as emptyDirectLaneStats };
