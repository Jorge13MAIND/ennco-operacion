import { NextResponse } from "next/server";

import { runDirectLaneTick } from "@/lib/correos/dispatch";
import { authorizeCronRequest } from "@/lib/dispatch/cron-auth";
import { sendDispatchAlert } from "@/lib/dispatch/telegram";
import { getRuntimeConfig } from "@/lib/runtime/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const privateHeaders = { "Cache-Control": "private, no-store" } as const;

/**
 * Cron del carril directo (M041): un correo por buzón conectado por tick.
 * Comparte CRON_SECRET y ENNCO_DISPATCH_RELEASED con el motor híbrido, y
 * además exige ENNCO_DIRECT_LANE_RELEASED. En modo sombra reclama sin enviar.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const config = getRuntimeConfig();
  const auth = authorizeCronRequest(request, config);
  if (auth.status === "HOLD") return NextResponse.json({ state: "HOLD", reason: auth.reason }, { status: 200, headers: privateHeaders });
  if (auth.status === "UNAUTHORIZED") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: privateHeaders });
  if (!config.directLaneReleased) return NextResponse.json({ state: "HOLD", reason: "DIRECT_LANE_NOT_RELEASED" }, { status: 200, headers: privateHeaders });
  try {
    const result = await runDirectLaneTick(config);
    return NextResponse.json({ state: "OK", ...result }, { status: 200, headers: privateHeaders });
  } catch (error) {
    await sendDispatchAlert({ config, level: "CRITICAL", title: "carril directo: tick falló", lines: [error instanceof Error ? error.message.slice(0, 160) : "error desconocido"] });
    return NextResponse.json({ state: "ERROR", reason: "DIRECT_LANE_TICK_FAILED" }, { status: 200, headers: privateHeaders });
  }
}
