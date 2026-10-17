import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { rpcErrorCode } from "@/lib/dispatch/rpc-error";
import { operationsRpcRejected, parseOperationsMutationInput } from "@/lib/operations/http";
import { uuidSchema } from "@/lib/operations/mutations";
import { getMutationContext } from "@/lib/operations/route";

/**
 * Llave nueva para que un medidor mande lecturas por API. La genera el servidor, la base guarda solo su
 * huella (sha256) y la llave se muestra una sola vez. Generar otra invalida la anterior.
 */
const envelopeSchema = z.object({ organizationId: z.uuid(), idempotencyKey: z.string() }).strict();
const headers = { "Cache-Control": "private, no-store" } as const;

export async function POST(request: Request, { params }: { params: Promise<{ meterId: string }> }): Promise<NextResponse> {
  const id = uuidSchema.safeParse((await params).meterId);
  if (!id.success) return operationsRpcRejected("ENERGY_METER_ID_INVALID", 400);
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const parsed = await parseOperationsMutationInput({ request, schema: envelopeSchema, trustedValues: { organizationId: context.organizationId } });
  if (!parsed.ok) return parsed.response;
  const key = `enm_${randomBytes(32).toString("base64url")}`;
  const sha = createHash("sha256").update(key, "utf8").digest("hex");
  const { data, error } = await context.client.rpc("energy_command", {
    target_organization_id: context.organizationId, target_op: "MEDIDOR_LLAVE",
    target_payload: { meter_id: id.data, key_sha256: sha, key_hint: `…${key.slice(-4)}` },
    target_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return operationsRpcRejected(rpcErrorCode(error));
  const body = z.object({ ok: z.boolean(), message: z.string(), replayed: z.boolean().optional() }).passthrough().safeParse(data);
  if (!body.success) return operationsRpcRejected("ENERGY_RESPONSE_INVALID", 502);
  // Si fue una repetición, la llave de esta respuesta no es la que quedó guardada: no se muestra.
  return NextResponse.json({ ...body.data, key: body.data.replayed ? null : key }, { status: 200, headers });
}
