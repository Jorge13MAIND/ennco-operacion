import { NextResponse } from "next/server";
import { z } from "zod";

import { getMutationContext } from "@/lib/operations/route";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

type OperatorClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Plantilla de las mutaciones del carril directo: sesión viva + origen
 * verificado (getMutationContext), Idempotency-Key SHA256 obligatoria, cuerpo
 * validado con zod, y respuesta privada sin caché. El código de error que
 * regresa la base se conserva para que la pantalla pueda mostrarlo.
 */

const idempotencyKeySchema = /^[a-f0-9]{64}$/u;
export const privateHeaders = { "Cache-Control": "private, no-store" } as const;

export function correosRejected(code: string, status = 409): NextResponse {
  return NextResponse.json({ error: code, correlation_id: crypto.randomUUID() }, { status, headers: privateHeaders });
}

export async function correosMutation<T>(request: Request, schema: z.ZodType<T>): Promise<
  | { ok: true; organizationId: string; client: OperatorClient; idempotencyKey: string; body: T }
  | { ok: false; response: NextResponse }
> {
  const context = await getMutationContext(request);
  if (!context.ok) return { ok: false, response: context.response };
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim().toLowerCase() ?? "";
  if (!idempotencyKeySchema.test(idempotencyKey)) return { ok: false, response: correosRejected("CORREOS_IDEMPOTENCY_KEY_INVALID", 400) };
  const raw: unknown = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) return { ok: false, response: correosRejected("CORREOS_INPUT_INVALID", 400) };
  return { ok: true, organizationId: context.organizationId, client: context.client, idempotencyKey, body: parsed.data };
}

/** Postgres devuelve el código en `message` (raise exception 'CODE'); se conserva si tiene forma de código. */
export function rpcErrorCode(error: { message?: string } | null, fallback: string): string {
  const message = error?.message ?? "";
  const match = /^([A-Z0-9_]{6,80})(?::|$)/u.exec(message);
  return match?.[1] ?? fallback;
}
