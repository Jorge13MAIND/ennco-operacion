import { NextResponse } from "next/server";
import { z } from "zod";

import { rpcErrorCode } from "@/lib/dispatch/rpc-error";
import { energyCommandResultSchema, energyCommandSchema } from "@/lib/medidores/model";
import { operationsRpcRejected, operationsRpcResponse, parseOperationsMutationInput } from "@/lib/operations/http";
import { getMutationContext } from "@/lib/operations/route";

/**
 * Escrituras de la pestaña Medidores: { op, payload } con Idempotency-Key. La base (app.energy_command)
 * valida de nuevo. La llave de API y la conexión con Growatt tienen rutas propias porque el servidor
 * genera la llave o cifra el token antes de guardar.
 */
const envelopeSchema = z.object({
  op: z.string(), payload: z.unknown(), organizationId: z.uuid(), idempotencyKey: z.string(),
}).strict();

export async function POST(request: Request): Promise<NextResponse> {
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const parsed = await parseOperationsMutationInput({ request, schema: envelopeSchema, trustedValues: { organizationId: context.organizationId } });
  if (!parsed.ok) return parsed.response;
  const command = energyCommandSchema.safeParse({ op: parsed.data.op, payload: parsed.data.payload });
  if (!command.success) return operationsRpcRejected("ENERGY_INPUT_INVALID", 400);
  const { data, error } = await context.client.rpc("energy_command", {
    target_organization_id: context.organizationId,
    target_op: command.data.op,
    target_payload: command.data.payload,
    target_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return operationsRpcRejected(rpcErrorCode(error));
  return operationsRpcResponse(energyCommandResultSchema, data);
}
