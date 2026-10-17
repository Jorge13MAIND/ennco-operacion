import { NextResponse } from "next/server";
import { z } from "zod";

import { EnergyServiceError, evaluateMeter } from "@/lib/medidores/service";
import { uuidSchema } from "@/lib/operations/mutations";
import { requireWritableOperationsRequest } from "@/lib/operations/route";
import { getRuntimeConfig } from "@/lib/runtime/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const headers = { "Cache-Control": "private, no-store" } as const;
const bodySchema = z.object({ since: z.string().refine((v) => !Number.isNaN(Date.parse(v))), until: z.string().refine((v) => !Number.isNaN(Date.parse(v))) }).strict();

/**
 * Recalcula las alertas de un medidor en un periodo (después de cargar un archivo o de cambiar umbrales).
 * Máximo 400 días, en ventanas de 7.
 */
export async function POST(request: Request, { params }: { params: Promise<{ meterId: string }> }): Promise<NextResponse> {
  const id = uuidSchema.safeParse((await params).meterId);
  if (!id.success) return NextResponse.json({ error: "ENERGY_METER_ID_INVALID" }, { status: 400, headers });
  const gate = await requireWritableOperationsRequest(request);
  if (!gate.ok) return gate.response;
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "ENERGY_INPUT_INVALID" }, { status: 400, headers });
  const since = new Date(body.data.since).toISOString(), until = new Date(body.data.until).toISOString();
  if (Date.parse(until) <= Date.parse(since) || Date.parse(until) - Date.parse(since) > 400 * 86400000) {
    return NextResponse.json({ error: "ENERGY_RANGE_INVALID" }, { status: 400, headers });
  }
  // El medidor tiene que ser de la organización de quien lo pide (el servicio firma como la organización).
  const client = await createSupabaseServerClient();
  const { error: readError } = await client.rpc("read_energy_meter", { target_organization_id: gate.access.organizationId, target_meter_id: id.data, since_at: until, until_at: new Date(Date.parse(until) + 1000).toISOString() });
  if (readError) return NextResponse.json({ error: "ENERGY_METER_NOT_FOUND" }, { status: 404, headers });
  try {
    const result = await evaluateMeter(getRuntimeConfig(), id.data, { since, until });
    return NextResponse.json({ ok: true, ...result, message: `Alertas recalculadas: ${result.events} en ${result.windows} semana(s).` }, { status: 200, headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof EnergyServiceError ? error.code : "ENERGY_EVALUATION_FAILED" }, { status: 409, headers });
  }
}
