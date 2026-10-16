import { NextResponse } from "next/server";

import { readDirectorySheet } from "@/lib/crm/import";
import { crmImportPreviewSchema } from "@/lib/crm/model";
import { requireWritableOperationsRequest } from "@/lib/operations/route";
import { readXlsx } from "@/lib/precios/xlsx";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" } as const;
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_ROWS = 1000;

/**
 * Vista previa de un directorio en Excel: lee la primera hoja, reconoce las columnas y le pregunta a
 * la base qué empresas son nuevas, cuáles ya están en el CRM y cuáles están en la campaña de correo.
 * No escribe nada; la carga se confirma después con la op IMPORTAR de /api/v1/operations/crm.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const gate = await requireWritableOperationsRequest(request);
  if (!gate.ok) return gate.response;
  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    file = value instanceof File ? value : null;
  } catch {
    return NextResponse.json({ error: "CRM_IMPORT_FILE_INVALID" }, { status: 400, headers });
  }
  if (!file || file.size === 0 || file.size > MAX_BYTES || !/\.xlsx$/i.test(file.name)) {
    return NextResponse.json({ error: "CRM_IMPORT_FILE_INVALID" }, { status: 400, headers });
  }
  let sheet;
  try {
    sheet = readXlsx(Buffer.from(await file.arrayBuffer()))[0];
  } catch {
    return NextResponse.json({ error: "CRM_IMPORT_FILE_UNREADABLE" }, { status: 400, headers });
  }
  if (!sheet) return NextResponse.json({ error: "CRM_IMPORT_FILE_UNREADABLE" }, { status: 400, headers });
  const directory = readDirectorySheet(sheet);
  if (!directory.headerRow) return NextResponse.json({ error: "CRM_IMPORT_NO_COMPANY_COLUMN" }, { status: 400, headers });
  if (directory.rows.length > MAX_ROWS) return NextResponse.json({ error: "CRM_IMPORT_TOO_MANY_ROWS" }, { status: 400, headers });
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("crm_import_preview", { target_organization_id: gate.access.organizationId, target_rows: directory.rows });
  if (error) return NextResponse.json({ error: "CRM_IMPORT_PREVIEW_FAILED" }, { status: 409, headers });
  const preview = crmImportPreviewSchema.safeParse(data);
  if (!preview.success) return NextResponse.json({ error: "CRM_IMPORT_PREVIEW_FAILED" }, { status: 502, headers });
  return NextResponse.json({ file_name: file.name.replace(/\.xlsx$/i, "").slice(0, 200), columns: directory.columns, rows: directory.rows, preview: preview.data }, { status: 200, headers });
}
