import { NextResponse } from "next/server";

import { calculatePrequote, prequoteInputSchema } from "@/lib/domain/prequote";
import { getRuntimeConfig } from "@/lib/runtime/config";

export async function POST(request: Request): Promise<NextResponse> {
  const config = getRuntimeConfig();
  const correlationId = crypto.randomUUID();
  const parsed = prequoteInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_PREQUOTE_INPUT", correlation_id: correlationId, details: parsed.error.flatten() },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!config.demoMode && !config.supabaseUrl) {
    return NextResponse.json(
      { error: "DEDICATED_DATABASE_REQUIRED", correlation_id: correlationId },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const recordId = crypto.randomUUID();
  const estimate = calculatePrequote(parsed.data);
  if (config.appEnv === "production" && estimate.modelStatus !== "APPROVED") {
    return NextResponse.json(
      { error: "PREQUOTE_MODEL_NOT_APPROVED", correlation_id: correlationId },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      record_id: recordId,
      correlation_id: correlationId,
      folio: `ENN-PRE-${recordId.slice(0, 8).toUpperCase()}`,
      estimate,
      evidence_class: config.demoMode ? "synthetic_demo" : "live",
    },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
