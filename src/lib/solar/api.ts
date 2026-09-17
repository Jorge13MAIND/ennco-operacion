import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOperationsAccess, type OperationsAccessContext } from "@/lib/auth/authorization";
import { getRuntimeConfig } from "@/lib/runtime/config";
import { evaluateMutationRequest } from "@/lib/security/request";

/* Envoltura de las rutas /api/v1/solar y /api/v1/precios: acceso, cuerpo JSON y errores con codigo. */

export const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export class ProjectApiError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

export async function context(request?: Request): Promise<OperationsAccessContext> {
  if (request) {
    const decision = evaluateMutationRequest(request, getRuntimeConfig().appUrl);
    if (decision.decision !== "ALLOW") throw new ProjectApiError(decision.code, 403);
  }
  try { return await requireOperationsAccess(); } catch { throw new ProjectApiError("PROJECT_AUTHENTICATION_REQUIRED", 401); }
}

export async function body(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > 8_000_000) throw new ProjectApiError("PROJECT_REQUEST_TOO_LARGE", 413);
  const raw = await request.text();
  if (raw.length > 8_000_000) throw new ProjectApiError("PROJECT_REQUEST_TOO_LARGE", 413);
  try { return JSON.parse(raw); } catch { throw new ProjectApiError("PROJECT_JSON_INVALID", 400); }
}

export async function api<T>(run: () => Promise<T>) {
  try { return NextResponse.json(await run(), { headers }); } catch (e) { return apiError(e); }
}

export function apiError(e: unknown) {
  if (e instanceof z.ZodError) {
    return NextResponse.json({ error: "PROJECT_INPUT_INVALID", message: "Revisa los campos señalados.", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 422, headers });
  }
  const message = e instanceof Error ? e.message : "PROJECT_UNAVAILABLE";
  const code = /^[A-Z][A-Z0-9_]+$/.test(message) ? message : "PROJECT_OPERATION_REJECTED";
  const status = e instanceof ProjectApiError ? e.status : code.includes("NOT_FOUND") ? 404 : code.includes("FORBIDDEN") ? 403 : code.includes("REQUIRED") ? 401 : 409;
  return NextResponse.json({ error: code }, { status, headers });
}
