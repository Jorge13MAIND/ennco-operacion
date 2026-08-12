import { NextResponse } from "next/server";
import { z } from "zod";

import {
  analyticsEventInputSchema,
  AnalyticsPersistenceError,
  persistAnalyticsEvent,
} from "@/lib/analytics/events";
import { getTrustedClientAddress } from "@/lib/prequote/persistence";
import { getRuntimeConfig } from "@/lib/runtime/config";

const idempotencyKeySchema = z.string().trim().min(16).max(128).regex(/^[A-Za-z0-9_.:-]+$/);

export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = crypto.randomUUID();
  let config;
  try {
    config = getRuntimeConfig();
  } catch {
    return NextResponse.json(
      { error: "ANALYTICS_RUNTIME_NOT_READY", correlation_id: correlationId },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const parsed = analyticsEventInputSchema.safeParse(await request.json().catch(() => null));
  const idempotencyKey = idempotencyKeySchema.safeParse(request.headers.get("Idempotency-Key") ?? "");
  if (!parsed.success || !idempotencyKey.success) {
    return NextResponse.json(
      { error: "INVALID_ANALYTICS_EVENT", correlation_id: correlationId },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  if (config.demoMode) {
    return NextResponse.json(
      { status: "ACCEPTED", persistence_status: "SYNTHETIC_NOT_PERSISTED", correlation_id: correlationId },
      { status: 202, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (!config.publicSurfaceReleased) {
    return NextResponse.json(
      { error: "PUBLIC_SURFACE_NOT_RELEASED", correlation_id: correlationId },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  try {
    const result = await persistAnalyticsEvent({
      config,
      idempotencyKey: idempotencyKey.data,
      clientAddress: getTrustedClientAddress(request, config.appEnv),
      event: parsed.data,
    });
    return NextResponse.json(
      { status: result.status, persistence_status: "PERSISTED", correlation_id: correlationId },
      { status: result.status === "CREATED" ? 201 : 200, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (caught) {
    const rateLimited = caught instanceof AnalyticsPersistenceError && caught.code === "RATE_LIMIT";
    return NextResponse.json(
      { error: rateLimited ? "ANALYTICS_RATE_LIMITED" : "ANALYTICS_PERSISTENCE_UNAVAILABLE", correlation_id: correlationId },
      {
        status: rateLimited ? 429 : 503,
        headers: {
          "Cache-Control": "private, no-store",
          ...(rateLimited ? { "Retry-After": "3600" } : {}),
        },
      },
    );
  }
}
