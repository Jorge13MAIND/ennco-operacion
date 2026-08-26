import { timingSafeEqual } from "node:crypto";

import type { RuntimeConfig } from "@/lib/runtime/config";

export type CronAuthResult =
  | { status: "AUTHORIZED" }
  | { status: "HOLD"; reason: string }
  | { status: "UNAUTHORIZED" };

function constantTimeMatches(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(received, "utf8");
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

/**
 * Autoriza una invocación de Vercel Cron. Fail closed: sin secreto configurado
 * o sin release del dispatcher la ruta responde HOLD sin tocar la base.
 * Vercel envía `Authorization: Bearer ${CRON_SECRET}` cuando la env var existe.
 */
export function authorizeCronRequest(request: Request, config: RuntimeConfig): CronAuthResult {
  if (!config.dispatchReleased) return { status: "HOLD", reason: "DISPATCH_NOT_RELEASED" };
  if (!config.cronSecret) return { status: "HOLD", reason: "CRON_SECRET_NOT_CONFIGURED" };
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return { status: "UNAUTHORIZED" };
  const received = header.slice("Bearer ".length).trim();
  if (!received || !constantTimeMatches(config.cronSecret, received)) {
    return { status: "UNAUTHORIZED" };
  }
  return { status: "AUTHORIZED" };
}
