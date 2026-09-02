import { NextResponse } from "next/server";
import { z } from "zod";

import { correosMutation, correosRejected, privateHeaders, rpcErrorCode } from "@/lib/correos/http";
import { uuidSchema } from "@/lib/operations/mutations";

/**
 * Encola la respuesta escrita por el operador a una respuesta de prospecto.
 * Sale por el cron en el hilo original y, si la campaña lo indica, con copia
 * a Paco: es el "segundo correo" de la junta del 1-sep, no el primero.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const providerEventId = uuidSchema.safeParse(id);
  if (!providerEventId.success) return correosRejected("CORREOS_REPLY_ID_INVALID", 400);
  const mutation = await correosMutation(request, z.object({ body_text: z.string().trim().min(10).max(6_000) }).strict());
  if (!mutation.ok) return mutation.response;
  const { data, error } = await mutation.client.rpc("enqueue_direct_lane_reply", {
    target_organization_id: mutation.organizationId,
    target_provider_event_id: providerEventId.data,
    target_body_text: mutation.body.body_text,
    target_idempotency_key: mutation.idempotencyKey,
  });
  if (error) return correosRejected(rpcErrorCode(error, "DIRECT_LANE_REPLY_REJECTED"));
  return NextResponse.json(data, { status: 200, headers: privateHeaders });
}
