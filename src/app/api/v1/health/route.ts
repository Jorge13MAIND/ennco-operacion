import { NextResponse } from "next/server";

import { getRuntimeConfig } from "@/lib/runtime/config";

export function GET(): NextResponse {
  const config = getRuntimeConfig();
  return NextResponse.json(
    {
      status: "ok",
      environment: config.appEnv,
      evidence_class: config.demoMode ? "synthetic_demo" : "live",
      external_send_allowed: config.externalSendAllowed,
      global_kill_switch: config.globalKillSwitch,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
