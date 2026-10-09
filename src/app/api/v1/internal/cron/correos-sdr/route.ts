import { NextResponse } from "next/server";
import { runEmailSdr } from "@/lib/correos/sdr/runner";
import { runSdrAlerts } from "@/lib/correos/sdr/alerts";
import { runPositiveTelegram } from "@/lib/correos/sdr/telegram";
import { authorizeCronRequest } from "@/lib/dispatch/cron-auth";
import { getRuntimeConfig } from "@/lib/runtime/config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;
export async function GET(request: Request) {
  const config = getRuntimeConfig();
  const headers = { "Cache-Control": "private, no-store" };
  if (authorizeCronRequest(request, config).status !== "AUTHORIZED") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers });
  let work: unknown;
  let alerts: unknown;
  let telegram: unknown;
  try { work = await runEmailSdr(config); }
  catch { work = { state: "ERROR", reason: "SDR_WORKER_FAILED" }; }
  try { alerts = await runSdrAlerts(config); }
  catch { alerts = { state: "ERROR", reason: "SDR_ALERTS_FAILED" }; }
  // Telegram es un canal extra: si falla, no marca la vuelta del SDR como caída.
  try { telegram = await runPositiveTelegram(config); }
  catch { telegram = { state: "ERROR", reason: "SDR_TELEGRAM_FAILED" }; }
  const failed = (work as { state: string }).state === "ERROR" || ["ERROR", "DEGRADED"].includes((alerts as { state: string }).state);
  return NextResponse.json({ work, alerts, telegram }, { status: failed ? 503 : 200, headers });
}
