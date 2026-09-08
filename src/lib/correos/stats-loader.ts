import { z } from "zod";

import type { OperationsAccessContext } from "@/lib/auth/authorization";
import { addDays, cdmxDateToUtcIso, directLaneStatsSchema, weekStartCdmx, type DirectLaneStats } from "@/lib/correos/stats";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const weeklyReportSchema = z.object({
  week_start: z.string(),
  generated_at: z.string(),
  metrics: directLaneStatsSchema,
  previous: directLaneStatsSchema.nullable().optional(),
  recommendations: z.array(z.string()),
});
export type DirectLaneWeeklyReport = z.infer<typeof weeklyReportSchema>;

export type DirectLaneStatsScreen = {
  available: boolean;
  weekStart: string;
  thisWeek: DirectLaneStats | null;
  last30: DirectLaneStats | null;
  reports: DirectLaneWeeklyReport[];
};

/** Estadísticas para la pestaña Correos: semana en curso, últimos 30 días y los reportes de los viernes. */
export async function loadDirectLaneStats(access: OperationsAccessContext): Promise<DirectLaneStatsScreen> {
  const now = new Date();
  const weekStart = weekStartCdmx(now);
  if (access.evidenceClass !== "live" || !access.organizationId) {
    return { available: false, weekStart, thisWeek: null, last30: null, reports: [] };
  }
  const client = await createSupabaseServerClient();
  const org = access.organizationId;
  const [week, month, reports] = await Promise.all([
    client.rpc("read_direct_lane_stats", { target_organization_id: org, since_at: cdmxDateToUtcIso(weekStart), until_at: now.toISOString() }),
    client.rpc("read_direct_lane_stats", { target_organization_id: org, since_at: cdmxDateToUtcIso(addDays(weekStart, -28)), until_at: now.toISOString() }),
    client.rpc("read_direct_lane_weekly_reports", { target_organization_id: org }),
  ]);
  if (week.error || month.error || reports.error) return { available: false, weekStart, thisWeek: null, last30: null, reports: [] };
  return {
    available: true,
    weekStart,
    thisWeek: directLaneStatsSchema.parse(week.data),
    last30: directLaneStatsSchema.parse(month.data),
    reports: z.array(weeklyReportSchema).parse(reports.data ?? []),
  };
}
