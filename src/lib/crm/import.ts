import type { CrmImportRow } from "@/lib/crm/model";
import type { Sheet } from "@/lib/precios/xlsx";

/**
 * Lectura de un directorio de empresas en Excel (16-oct, Grant). Se busca la fila de encabezados en
 * las primeras 10 filas y cada columna se reconoce por su nombre, sin importar el orden ni los
 * acentos: Empresa, Municipio o Ciudad, Estado, Parque o Zona, Dirección, Sector o Nota, Fuente, y
 * si vienen, Contacto, Puesto, Correo y Teléfono.
 */
const FIELDS: Array<{ key: keyof CrmImportRow; label: string; test: RegExp }> = [
  { key: "company_name", label: "Empresa", test: /^(empresa|compania|razon social|nombre de la empresa|company)/ },
  { key: "city", label: "Municipio o ciudad", test: /(municipio|ciudad|city)/ },
  { key: "state", label: "Estado", test: /^(estado|entidad|state)\b/ },
  { key: "industrial_park", label: "Parque o zona industrial", test: /(parque|zona|industrial park)/ },
  { key: "address", label: "Dirección", test: /(direccion|domicilio|address|calle)/ },
  { key: "sector", label: "Sector o nota", test: /(sector|giro|industria|nota|actividad)/ },
  { key: "source_url", label: "Fuente", test: /(fuente|url|sitio|web|link|source)/ },
  { key: "full_name", label: "Contacto", test: /^(contacto|nombre del contacto|persona|nombre)$/ },
  { key: "role_title", label: "Puesto", test: /(puesto|cargo|title)/ },
  { key: "email", label: "Correo", test: /(correo|e ?mail)/ },
  { key: "phone", label: "Teléfono", test: /(telefono|tel|celular|whatsapp|phone)/ },
];

const normalize = (value: unknown) => String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

export type DirectorySheet = { rows: CrmImportRow[]; columns: Array<{ field: string; header: string }>; headerRow: number };

export function readDirectorySheet(sheet: Sheet): DirectorySheet {
  let headerRow = 0;
  let mapping = new Map<string, keyof CrmImportRow>();
  const headers = new Map<keyof CrmImportRow, string>();
  for (let r = 1; r <= Math.min(10, sheet.maxRow); r += 1) {
    const row = sheet.rows.get(r);
    if (!row) continue;
    const candidate = new Map<string, keyof CrmImportRow>();
    const used = new Set<keyof CrmImportRow>();
    for (const [column, value] of row) {
      const text = normalize(value);
      const field = FIELDS.find((f) => !used.has(f.key) && f.test.test(text));
      if (field) { candidate.set(column, field.key); used.add(field.key); headers.set(field.key, clean(value)); }
    }
    if ([...candidate.values()].includes("company_name")) { headerRow = r; mapping = candidate; break; }
    headers.clear();
  }
  if (!headerRow) return { rows: [], columns: [], headerRow: 0 };
  const rows: CrmImportRow[] = [];
  for (let r = headerRow + 1; r <= sheet.maxRow; r += 1) {
    const row = sheet.rows.get(r);
    if (!row) continue;
    const item: Partial<Record<keyof CrmImportRow, string>> = {};
    for (const [column, field] of mapping) {
      const value = clean(row.get(column));
      if (value) item[field] = value.slice(0, field === "address" || field === "sector" || field === "source_url" ? 600 : 300);
    }
    if (item.company_name) rows.push({ company_name: item.company_name, ...item } as CrmImportRow);
  }
  return {
    rows,
    columns: FIELDS.filter((f) => headers.has(f.key)).map((f) => ({ field: f.label, header: headers.get(f.key)! })),
    headerRow,
  };
}
