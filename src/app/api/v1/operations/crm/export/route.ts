import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/authorization";
import { crmWorkbookRows } from "@/lib/crm/export";
import { loadCrm } from "@/lib/crm/load";
import { writeXlsx } from "@/lib/precios/xlsx";

export const dynamic = "force-dynamic";

/** Descarga el CRM completo como Excel (una hoja, una fila por contacto). */
export async function GET(): Promise<NextResponse> {
  try {
    const access = await requireOperationsAccess();
    const screen = await loadCrm(access);
    const file = writeXlsx([{ name: "CRM", rows: crmWorkbookRows(screen.records), widths: [28, 28, 26, 30, 16, 18, 16, 22, 26, 14, 34, 18, 22, 18, 40] }]);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
    return new NextResponse(new Uint8Array(file), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="ENNCO-CRM-${date}.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "CRM_EXPORT_UNAVAILABLE" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  }
}
