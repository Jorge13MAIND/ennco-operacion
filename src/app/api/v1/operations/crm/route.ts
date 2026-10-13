import { NextResponse } from "next/server";
import { z } from "zod";

import { crmCommandResultSchema, crmCommandSchema } from "@/lib/crm/model";
import { rpcErrorCode } from "@/lib/dispatch/rpc-error";
import { operationsRpcRejected, operationsRpcResponse, parseOperationsMutationInput } from "@/lib/operations/http";
import { getMutationContext } from "@/lib/operations/route";

/**
 * Todas las escrituras del CRM: { op, payload } con Idempotency-Key. La base (app.crm_command) valida
 * permisos, etapas y campos de nuevo y devuelve un mensaje para mostrar. Un rechazo regresa el código
 * que levantó la base (CRM_CALIFICACION_INCOMPLETA, etc.) para que la pantalla diga qué falta.
 */
const envelopeSchema = z.object({
  op: z.string(), payload: z.unknown(), organizationId: z.uuid(), idempotencyKey: z.string(),
}).strict();

export async function POST(request: Request): Promise<NextResponse> {
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const parsed = await parseOperationsMutationInput({ request, schema: envelopeSchema, trustedValues: { organizationId: context.organizationId } });
  if (!parsed.ok) return parsed.response;
  const command = crmCommandSchema.safeParse({ op: parsed.data.op, payload: parsed.data.payload });
  if (!command.success) return operationsRpcRejected("CRM_INPUT_INVALID", 400);
  const { data, error } = await context.client.rpc("crm_command", {
    target_organization_id: context.organizationId,
    target_op: command.data.op,
    target_payload: command.data.payload,
    target_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return operationsRpcRejected(rpcErrorCode(error));
  return operationsRpcResponse(crmCommandResultSchema, data);
}
