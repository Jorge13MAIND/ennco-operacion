import { NextResponse } from "next/server";

import { readDispatchHealth } from "@/lib/dispatch/client";
import { authorizeCronRequest } from "@/lib/dispatch/cron-auth";
import { sendDispatchAlert } from "@/lib/dispatch/telegram";
import { formatDailySnapshot } from "@/lib/dispatch/watchdog";
import { getRuntimeConfig } from "@/lib/runtime/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const privateHeaders = { "Cache-Control": "private, no-store" } as const;

function cdmxHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Mexico_City", hour: "numeric", hour12: false }).format(now)) % 24;
}

export async function GET(request: Request): Promise<NextResponse> {
  const config = getRuntimeConfig();
  const auth = authorizeCronRequest(request, config);
  if (auth.status === "HOLD") return NextResponse.json({ state: "HOLD", reason: auth.reason }, { status: 200, headers: privateHeaders });
  if (auth.status === "UNAUTHORIZED") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: privateHeaders });
  try {
    const health = await readDispatchHealth(config);
    const moment = cdmxHour(new Date()) < 12 ? "PREFLIGHT" : "CLOSE";
    const lines = formatDailySnapshot({ health, dispatchMode: config.dispatchMode, moment });
    const delivered = await sendDispatchAlert({
      config,
      level: "INFO",
      title: moment === "PREFLIGHT" ? "snapshot pre-vuelo" : "snapshot de cierre",
      lines,
    });
    return NextResponse.json({ state: "OK", delivered, moment }, { status: 200, headers: privateHeaders });
  } catch {
    return NextResponse.json({ state: "ERROR", reason: "HEALTH_UNAVAILABLE" }, { status: 200, headers: privateHeaders });
  }
}
