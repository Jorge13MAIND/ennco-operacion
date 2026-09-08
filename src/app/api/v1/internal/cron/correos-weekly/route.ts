import { NextResponse } from "next/server";

import { runDirectLaneWeeklyReport } from "@/lib/correos/weekly";
import { authorizeCronRequest } from "@/lib/dispatch/cron-auth";
import { sendDispatchAlert } from "@/lib/dispatch/telegram";
import { getRuntimeConfig } from "@/lib/runtime/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const privateHeaders = { "Cache-Control": "private, no-store" } as const;

/**
 * Ciclo de mejora de los viernes (DEC-112): tasa de respuesta y de apertura
 * por variante, buzón y estado, comparadas con la semana anterior; guarda el
 * reporte, lo muestra el panel y lo manda por Telegram. Propone, no aplica.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const config = getRuntimeConfig();
  const auth = authorizeCronRequest(request, config);
  if (auth.status === "HOLD") return NextResponse.json({ state: "HOLD", reason: auth.reason }, { status: 200, headers: privateHeaders });
  if (auth.status === "UNAUTHORIZED") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: privateHeaders });
  if (!config.directLaneReleased) return NextResponse.json({ state: "HOLD", reason: "DIRECT_LANE_NOT_RELEASED" }, { status: 200, headers: privateHeaders });
  try {
    const result = await runDirectLaneWeeklyReport(config);
    return NextResponse.json({ state: "OK", week_start: result.week_start, stored: result.stored, recommendations: result.recommendations }, { status: 200, headers: privateHeaders });
  } catch (error) {
    await sendDispatchAlert({ config, level: "WARN", title: "ciclo semanal falló", lines: [error instanceof Error ? error.message.slice(0, 160) : "error desconocido"] });
    return NextResponse.json({ state: "ERROR", reason: "DIRECT_LANE_WEEKLY_FAILED" }, { status: 200, headers: privateHeaders });
  }
}
