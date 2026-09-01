import { NextResponse } from "next/server";

import { authorizeCronRequest } from "@/lib/dispatch/cron-auth";
import { runGmailSync } from "@/lib/dispatch/sync";
import { sendDispatchAlert } from "@/lib/dispatch/telegram";
import { getRuntimeConfig } from "@/lib/runtime/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const privateHeaders = { "Cache-Control": "private, no-store" } as const;

export async function GET(request: Request): Promise<NextResponse> {
  const config = getRuntimeConfig();
  const auth = authorizeCronRequest(request, config);
  if (auth.status === "HOLD") return NextResponse.json({ state: "HOLD", reason: auth.reason }, { status: 200, headers: privateHeaders });
  if (auth.status === "UNAUTHORIZED") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: privateHeaders });
  if (config.dispatchMode !== "live") {
    return NextResponse.json({ state: "HOLD", reason: "SYNC_REQUIRES_LIVE_MODE" }, { status: 200, headers: privateHeaders });
  }
  try {
    const summary = await runGmailSync(config);
    if (summary.fullResyncRequested) {
      await sendDispatchAlert({ config, level: "WARN", title: "Gmail pide resync completo", lines: ["history 404: revisar cursor y watch"] });
    }
    if (summary.appliedReplyEvents > 0) {
      await sendDispatchAlert({
        config,
        level: "WARN",
        title: `${summary.appliedReplyEvents} respuesta(s) de prospecto sin clasificar`,
        lines: [
          "SLA: clasificar hoy; si es positiva, responder antes de las 18:00 CDMX",
          "Control Room: ennco-operacion.vercel.app/operacion",
        ],
      });
    }
    return NextResponse.json({ state: "OK", ...summary }, { status: 200, headers: privateHeaders });
  } catch {
    await sendDispatchAlert({ config, level: "CRITICAL", title: "gmail-sync falló", lines: ["runGmailSync lanzó error"] });
    return NextResponse.json({ state: "ERROR", reason: "SYNC_FAILED" }, { status: 200, headers: privateHeaders });
  }
}
