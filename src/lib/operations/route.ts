import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getMutationContext(): Promise<
  | { ok: true; organizationId: string; client: Awaited<ReturnType<typeof createSupabaseServerClient>> }
  | { ok: false; response: NextResponse }
> {
  try {
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
