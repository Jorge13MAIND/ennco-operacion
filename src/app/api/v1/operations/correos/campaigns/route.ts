import { NextResponse } from "next/server";
import { z } from "zod";

import { correosMutation, correosRejected, privateHeaders, rpcErrorCode } from "@/lib/correos/http";
import { directLaneSequencePayload, directLaneSequenceSchema, validateDirectLaneSequence } from "@/lib/correos/sequence";
// Copia empaquetada del copy congelado (ver scripts/build-direct-lane-sequence.mts):
// importarla garantiza que viaja al servidor. Leerla del disco fallaba en Vercel
// con DIRECT_LANE_SEQUENCE_FILE_INVALID porque data/ no viajaba al paquete.
import sequenceJson from "@/generated/direct-lane-sequence-v1.json";

const bodySchema = z.object({
  name: z.string().trim().min(3).max(120),
  cc_on_reply_email: z.email().nullable().default("francisco.cuellar@ennco.com.mx"),
}).strict();

/**
 * Crea la campaña del carril directo a partir del copy congelado en
 * data/campaigns/direct-lane-sequence-v1.json (32 correos, hash por variante).
 * El servidor lee el archivo; el cliente sólo manda nombre y copia.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const mutation = await correosMutation(request, bodySchema);
  if (!mutation.ok) return mutation.response;
  // El copy congelado vive en data/, que viaja al paquete serverless por
  // outputFileTracingIncludes (next.config.ts): la ruta se construye en
  // tiempo de ejecucion y el trazado de Next no puede deducirla sola. Sin esa
  // configuracion, crear campana fallaba siempre con ENOENT convertido en
  // DIRECT_LANE_SEQUENCE_FILE_INVALID.
  const parsedSequence = directLaneSequenceSchema.safeParse(sequenceJson);
  if (!parsedSequence.success) return correosRejected("DIRECT_LANE_SEQUENCE_FILE_INVALID", 500);
  const sequence = parsedSequence.data;
  const problems = validateDirectLaneSequence(sequence);
  if (problems.length > 0) return correosRejected("DIRECT_LANE_SEQUENCE_RULES_VIOLATED", 500);
  const { data, error } = await mutation.client.rpc("create_direct_lane_campaign", {
    target_organization_id: mutation.organizationId,
    target_name: mutation.body.name,
    target_cc_on_reply_email: mutation.body.cc_on_reply_email,
    target_sequence: directLaneSequencePayload(sequence),
    target_idempotency_key: mutation.idempotencyKey,
  });
  if (error) return correosRejected(rpcErrorCode(error, "DIRECT_LANE_CAMPAIGN_REJECTED"));
  return NextResponse.json(data, { status: 200, headers: privateHeaders });
}
