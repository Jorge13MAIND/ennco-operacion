import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/authorization";
import { loadMeterView } from "@/lib/medidores/load";
import { uuidSchema } from "@/lib/operations/mutations";

export const dynamic = "force-dynamic";

const privateHeaders = { "Cache-Control": "private, no-store" } as const;

/** Tablero de un medidor en un periodo: ?desde=ISO&hasta=ISO (sin ellos, todo lo medido). */
export async function GET(request: Request, { params }: { params: Promise<{ meterId: string }> }): Promise<NextResponse> {
  const id = uuidSchema.safeParse((await params).meterId);
  if (!id.success) return NextResponse.json({ error: "ENERGY_METER_ID_INVALID" }, { status: 400, headers: privateHeaders });
  const url = new URL(request.url);
  const valid = (value: string | null) => (value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null);
  try {
    const access = await requireOperationsAccess();
    return NextResponse.json(await loadMeterView(access, id.data, valid(url.searchParams.get("desde")), valid(url.searchParams.get("hasta"))), { status: 200, headers: privateHeaders });
  } catch {
    return NextResponse.json({ error: "ENERGY_METER_UNAVAILABLE", correlation_id: crypto.randomUUID() }, { status: 404, headers: privateHeaders });
  }
}
