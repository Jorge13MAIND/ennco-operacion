import { NextResponse } from "next/server";

import { readDispatchHealth } from "@/lib/dispatch/client";
import { authorizeCronRequest } from "@/lib/dispatch/cron-auth";
import { sendDispatchAlert } from "@/lib/dispatch/telegram";
import { evaluateDispatchWatchdog } from "@/lib/dispatch/watchdog";
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
  try {
    const health = await readDispatchHealth(config);
    const findings = evaluateDispatchWatchdog({ health, now: new Date(), dispatchMode: config.dispatchMode });
    for (const finding of findings) {
      await sendDispatchAlert({ config, level: finding.level, title: finding.title, lines: [finding.detail] });
    }
    return NextResponse.json({ state: "OK", findings: findings.length }, { status: 200, headers: privateHeaders });
  } catch {
    await sendDispatchAlert({ config, level: "CRITICAL", title: "watchdog sin health", lines: ["read_dispatch_health inaccesible"] });
    return NextResponse.json({ state: "ERROR", reason: "HEALTH_UNAVAILABLE" }, { status: 200, headers: privateHeaders });
  }
}
