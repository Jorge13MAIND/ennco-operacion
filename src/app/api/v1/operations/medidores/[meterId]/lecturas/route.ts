import { NextResponse } from "next/server";

import { rpcErrorCode } from "@/lib/dispatch/rpc-error";
import { energyCommandResultSchema, energyCommandSchema } from "@/lib/medidores/model";
import { operationsRpcRejected, operationsRpcResponse } from "@/lib/operations/http";
import { uuidSchema } from "@/lib/operations/mutations";
import { getMutationContext } from "@/lib/operations/route";

export const dynamic = "force-dynamic";

/**
 * Carga de lecturas de un archivo del analizador, en tandas de hasta 2,000 (el navegador lee el Excel y
 * manda las lecturas ya separadas). Tiene ruta propia porque el límite general de 100 KB no alcanza para
 * una tanda; aquí el tope es de 3.5 MB, debajo de los 4.5 MB de Vercel.
 */
const MAX_BYTES = 3_500_000;

export async function POST(request: Request, { params }: { params: Promise<{ meterId: string }> }): Promise<NextResponse> {
  const id = uuidSchema.safeParse((await params).meterId);
  if (!id.success) return operationsRpcRejected("ENERGY_METER_ID_INVALID", 400);
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const idempotencyKey = request.headers.get("Idempotency-Key") ?? "";
  if (!/^[a-f0-9]{64}$/.test(idempotencyKey)) return operationsRpcRejected("OPERATIONS_IDEMPOTENCY_KEY_INVALID", 400);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared > MAX_BYTES) return operationsRpcRejected("ENERGY_BATCH_TOO_LARGE", 413);
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BYTES) return operationsRpcRejected("ENERGY_BATCH_TOO_LARGE", 413);
    body = JSON.parse(text);
  } catch {
    return operationsRpcRejected("OPERATIONS_BODY_INVALID", 400);
  }
  const command = energyCommandSchema.safeParse({ op: "LECTURAS_IMPORTAR", payload: { ...(body as object), meter_id: id.data } });
  if (!command.success || command.data.op !== "LECTURAS_IMPORTAR") return operationsRpcRejected("ENERGY_INPUT_INVALID", 400);
  const { data, error } = await context.client.rpc("energy_command", {
    target_organization_id: context.organizationId, target_op: "LECTURAS_IMPORTAR",
    target_payload: command.data.payload, target_idempotency_key: idempotencyKey,
  });
  if (error) return operationsRpcRejected(rpcErrorCode(error));
  return operationsRpcResponse(energyCommandResultSchema, data);
}
