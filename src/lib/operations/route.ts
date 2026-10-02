import { NextResponse } from "next/server";

import { requireOperationsAccess, type OperationsAccessContext } from "@/lib/auth/authorization";
import { canMutateOperations } from "@/lib/auth/policy";
import { getRuntimeConfig } from "@/lib/runtime/config";
import { evaluateMutationRequest } from "@/lib/security/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getMutationContext(request: Request): Promise<
  | { ok: true; organizationId: string; client: Awaited<ReturnType<typeof createSupabaseServerClient>> }
  | { ok: false; response: NextResponse }
> {
  try {
    const config = getRuntimeConfig();
    const requestDecision = evaluateMutationRequest(request, config.appUrl);
    if (requestDecision.decision !== "ALLOW") {
      return {
        ok: false,
        response: NextResponse.json(
          { error: requestDecision.code },
          { status: 403, headers: { "Cache-Control": "private, no-store" } },
        ),
      };
    }
    const access = await requireOperationsAccess();
    if (access.evidenceClass !== "live" || !access.organizationId) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "SYNTHETIC_MUTATION_DISABLED" },
          { status: 409, headers: { "Cache-Control": "private, no-store" } },
        ),
      };
    }
    return { ok: true, organizationId: access.organizationId, client: await createSupabaseServerClient() };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "OPERATIONS_AUTHORIZATION_REQUIRED" },
        { status: 401, headers: { "Cache-Control": "private, no-store" } },
      ),
    };
  }
}

export function mutationResponse(data: unknown): NextResponse {
  return NextResponse.json(data, { status: 200, headers: { "Cache-Control": "private, no-store" } });
}

export function mutationUnavailable(code = "OPERATION_MUTATION_REJECTED"): NextResponse {
  return NextResponse.json(
    { error: code, correlation_id: crypto.randomUUID() },
    { status: 409, headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * Compuerta de las rutas POST que no usan getMutationContext: mismo origen, sesión con
 * pertenencia y un rol que pueda escribir (auditor_readonly no). 2-oct, auditoría de seguridad.
 */
export async function requireWritableOperationsRequest(request: Request): Promise<
  | { ok: true; access: OperationsAccessContext & { organizationId: string } }
  | { ok: false; response: NextResponse }
> {
  const headers = { "Cache-Control": "private, no-store" } as const;
  const requestDecision = evaluateMutationRequest(request, getRuntimeConfig().appUrl);
  if (requestDecision.decision !== "ALLOW") {
    return { ok: false, response: NextResponse.json({ error: requestDecision.code }, { status: 403, headers }) };
  }
  const access = await requireOperationsAccess();
  if (access.evidenceClass !== "live" || !access.organizationId) {
    return { ok: false, response: NextResponse.json({ error: "LIVE_ACCESS_REQUIRED" }, { status: 403, headers }) };
  }
  if (access.role !== "synthetic_admin" && !canMutateOperations(access.role)) {
    return { ok: false, response: NextResponse.json({ error: "ROLE_CANNOT_MUTATE" }, { status: 403, headers }) };
  }
  return { ok: true, access: { ...access, organizationId: access.organizationId } };
}
