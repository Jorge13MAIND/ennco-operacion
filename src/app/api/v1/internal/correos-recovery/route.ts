import { NextResponse } from "next/server";
import { z } from "zod";
import { reconcileDirectMailbox } from "@/lib/correos/reconcile";
import { authorizeCronRequest } from "@/lib/dispatch/cron-auth";
import { getRuntimeConfig } from "@/lib/runtime/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: Request) {
  const config = getRuntimeConfig();
  if (authorizeCronRequest(request, config).status !== "AUTHORIZED") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers });
  if (!config.directLaneReleased) return NextResponse.json({ error: "DIRECT_LANE_NOT_RELEASED" }, { status: 409, headers });
  const parsed = z.object({ mailboxId: z.uuid(), since: z.iso.datetime({ offset: true }) }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INPUT_INVALID" }, { status: 400, headers });
  try {
    return NextResponse.json(await reconcileDirectMailbox(config, parsed.data.mailboxId, parsed.data.since), { headers });
  } catch (error) {
    // Only controlled codes, never provider bodies, credentials or contact data.
    const code = error instanceof Error && /^[A-Z0-9_]{1,100}$/.test(error.message) ? error.message : "RECOVERY_FAILED";
    return NextResponse.json({ state: "RECOVERY_REQUIRED", code }, { status: 503, headers });
  }
}
