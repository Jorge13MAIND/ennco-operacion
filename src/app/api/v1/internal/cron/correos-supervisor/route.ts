import { NextResponse } from "next/server";

import { superviseDirectLane } from "@/lib/correos/client";
import { supervisorLevel, supervisorLines, supervisorReportSchema } from "@/lib/correos/supervisor";
import { authorizeCronRequest } from "@/lib/dispatch/cron-auth";
import { sendDispatchAlert } from "@/lib/dispatch/telegram";
import { getRuntimeConfig } from "@/lib/runtime/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const privateHeaders = { "Cache-Control": "private, no-store" } as const;

/**
 * Supervisor diario del carril directo (13:45 CDMX, al cerrar la ventana de envío). Revisa cada
 * buzón, reporta rebotes por buzón; el freno a incorporaciones se aplica por cohorte al 2 %, y avisa por
 * Telegram de respuestas sin contestar, fallas, ritmo y reserva de contactos.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const config = getRuntimeConfig();
  const auth = authorizeCronRequest(request, config);
  if (auth.status === "HOLD") return NextResponse.json({ state: "HOLD", reason: auth.reason }, { status: 200, headers: privateHeaders });
  if (auth.status === "UNAUTHORIZED") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: privateHeaders });
  if (!config.directLaneReleased) return NextResponse.json({ state: "HOLD", reason: "DIRECT_LANE_NOT_RELEASED" }, { status: 200, headers: privateHeaders });
  try {
    const report = supervisorReportSchema.parse(await superviseDirectLane(config, false));
    const level = supervisorLevel(report);
    await sendDispatchAlert({ config, level, title: `supervisor del ${report.date}`, lines: supervisorLines(report) }).catch(() => false);
    return NextResponse.json({ state: "OK", level, report }, { status: 200, headers: privateHeaders });
  } catch (error) {
    await sendDispatchAlert({ config, level: "WARN", title: "supervisor falló", lines: [error instanceof Error ? error.message.slice(0, 160) : "error desconocido"] });
    return NextResponse.json({ state: "ERROR", reason: "DIRECT_LANE_SUPERVISOR_FAILED" }, { status: 200, headers: privateHeaders });
  }
}
