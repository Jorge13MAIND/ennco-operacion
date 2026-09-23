import { NextResponse } from "next/server";
import { runEmailSdr } from "@/lib/correos/sdr/runner";
import { authorizeCronRequest } from "@/lib/dispatch/cron-auth";
import { getRuntimeConfig } from "@/lib/runtime/config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;
export async function GET(request: Request) {
  const config = getRuntimeConfig();
  const headers = { "Cache-Control": "private, no-store" };
  if (authorizeCronRequest(request, config).status !== "AUTHORIZED") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers });
  try { return NextResponse.json(await runEmailSdr(config), { headers }); }
  catch { return NextResponse.json({ state: "ERROR", reason: "SDR_WORKER_FAILED" }, { status: 503, headers }); }
}
