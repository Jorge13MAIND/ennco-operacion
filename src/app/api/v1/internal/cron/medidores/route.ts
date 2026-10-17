import { NextResponse } from "next/server";

import { authorizeCronRequest } from "@/lib/dispatch/cron-auth";
import { runEnergyCron } from "@/lib/medidores/cron";
import { getRuntimeConfig } from "@/lib/runtime/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

/** Cada 15 min: Growatt, alertas de medidores con datos nuevos, "sin datos" y Telegram (si está encendido). */
export async function GET(request: Request) {
  const config = getRuntimeConfig();
  const headers = { "Cache-Control": "private, no-store" };
  if (authorizeCronRequest(request, config).status !== "AUTHORIZED") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers });
  try {
    return NextResponse.json(await runEnergyCron(config), { status: 200, headers });
  } catch {
    return NextResponse.json({ state: "ERROR", reason: "ENERGY_CRON_FAILED" }, { status: 503, headers });
  }
}
