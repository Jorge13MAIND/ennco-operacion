import { NextResponse } from "next/server";

import { runDirectLaneSync } from "@/lib/correos/sync";
import { authorizeCronRequest } from "@/lib/dispatch/cron-auth";
import { sendDispatchAlert } from "@/lib/dispatch/telegram";
import { getRuntimeConfig } from "@/lib/runtime/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const privateHeaders = { "Cache-Control": "private, no-store" } as const;

/**
 * Sondeo de respuestas del carril directo. Corre en sombra y en live: las
 * respuestas a correos reales se leen aunque el envío esté en pausa, y avisar
 * por Telegram es lo que sostiene el SLA de las 18:00.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const config = getRuntimeConfig();
  const auth = authorizeCronRequest(request, config);
  if (auth.status === "HOLD") return NextResponse.json({ state: "HOLD", reason: auth.reason }, { status: 200, headers: privateHeaders });
  if (auth.status === "UNAUTHORIZED") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: privateHeaders });
  if (!config.directLaneReleased) return NextResponse.json({ state: "HOLD", reason: "DIRECT_LANE_NOT_RELEASED" }, { status: 200, headers: privateHeaders });
  if (!config.directLaneVaultKey || !config.googleOauthClientId || !config.googleOauthClientSecret) {
    return NextResponse.json({ state: "HOLD", reason: "DIRECT_LANE_CREDENTIALS_NOT_CONFIGURED" }, { status: 200, headers: privateHeaders });
  }
  try {
    const summary = await runDirectLaneSync(config);
    if (summary.appliedReplyEvents > 0) {
      await sendDispatchAlert({
        config,
        level: "WARN",
        title: `${summary.appliedReplyEvents} respuesta(s) de prospecto en el carril directo`,
        lines: [
          "SLA: clasificar hoy; si es positiva, responder antes de las 18:00 CDMX",
          "Control Room: ennco-operacion.vercel.app/operacion/correos",
        ],
      });
    }
    const failed = summary.mailboxes.filter((mailbox) => mailbox.result === "SYNC_FAILED");
    if (failed.length > 0) {
      await sendDispatchAlert({ config, level: "WARN", title: "carril directo: sync con fallas", lines: failed.map((mailbox) => `${mailbox.email}: ${mailbox.detail ?? "?"}`) });
    }
    return NextResponse.json({ state: "OK", ...summary }, { status: 200, headers: privateHeaders });
  } catch (error) {
    await sendDispatchAlert({ config, level: "CRITICAL", title: "carril directo: sync falló", lines: [error instanceof Error ? error.message.slice(0, 160) : "error desconocido"] });
    return NextResponse.json({ state: "ERROR", reason: "DIRECT_LANE_SYNC_FAILED" }, { status: 200, headers: privateHeaders });
  }
}
