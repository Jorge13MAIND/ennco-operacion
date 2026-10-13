import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/authorization";
import { loadCrmRecord } from "@/lib/crm/load";
import { uuidSchema } from "@/lib/operations/mutations";

export const dynamic = "force-dynamic";

const privateHeaders = { "Cache-Control": "private, no-store" } as const;

/** Ficha de un contacto del CRM: datos, bitácora, tareas y correos del hilo. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const id = uuidSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "CRM_RECORD_ID_INVALID" }, { status: 400, headers: privateHeaders });
  try {
    const access = await requireOperationsAccess();
    return NextResponse.json(await loadCrmRecord(access, id.data), { status: 200, headers: privateHeaders });
  } catch {
    return NextResponse.json({ error: "CRM_RECORD_UNAVAILABLE", correlation_id: crypto.randomUUID() }, { status: 404, headers: privateHeaders });
  }
}
