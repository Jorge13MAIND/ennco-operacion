import { describe, expect, it } from "vitest";

import { readDirectorySheet } from "@/lib/crm/import";
import { crmCommandSchema, inView, matchesOrigin, stageRequirements, displayName, crmBoardSchema } from "@/lib/crm/model";
import type { Sheet } from "@/lib/precios/xlsx";

function sheet(rows: Array<Record<string, string>>): Sheet {
  return { name: "Hoja", maxRow: rows.length, rows: new Map(rows.map((r, i) => [i + 1, new Map(Object.entries(r))])) };
}

describe("directorio en Excel (16-oct)", () => {
  it("reconoce las columnas del directorio del corredor sin importar acentos ni orden", () => {
    const parsed = readDirectorySheet(sheet([
      { A: "No.", B: "Empresa", C: "Municipio / Ciudad", D: "Estado", E: "Parque / Zona industrial", F: "Dirección", G: "Sector / Nota", H: "Fuente" },
      { A: "1", B: "Hope Global", C: "León", D: "Guanajuato", E: "Valle del Campestre", F: "Blvd. Juan Alonso de Torres 2103A,\nC.P. 37150", G: "Automotriz", H: "https://www.allbiz.mx/hope-global_4J" },
      { A: "2", B: "", C: "Silao" },
    ]));
    expect(parsed.headerRow).toBe(1);
    expect(parsed.rows).toEqual([{ company_name: "Hope Global", city: "León", state: "Guanajuato", industrial_park: "Valle del Campestre",
      address: "Blvd. Juan Alonso de Torres 2103A, C.P. 37150", sector: "Automotriz", source_url: "https://www.allbiz.mx/hope-global_4J" }]);
    expect(parsed.columns.map((c) => c.field)).toContain("Parque o zona industrial");
  });
  it("encuentra el encabezado aunque haya un título arriba, y lee contacto si viene", () => {
    const parsed = readDirectorySheet(sheet([{ A: "Directorio 2026" }, { A: "Razón social", B: "Contacto", C: "Correo", D: "Teléfono" },
      { A: "Planta X", B: "Ana Ruiz", C: "ana@x.test", D: "442 000 0000" }]));
    expect(parsed.rows[0]).toEqual({ company_name: "Planta X", full_name: "Ana Ruiz", email: "ana@x.test", phone: "442 000 0000" });
  });
  it("sin columna de empresa no lee nada", () => {
    expect(readDirectorySheet(sheet([{ A: "Nombre", B: "Correo" }, { A: "x", B: "y" }])).headerRow).toBe(0);
  });
  it("un lead de directorio entra por contactar, se filtra por origen y se muestra por la empresa", () => {
    const record = crmBoardSchema.parse({ records: [{ id: "51000000-0000-4000-8000-000000000009", source: "DIRECTORIO", full_name: null,
      company_name: "Hope Global", stage: "POR_CONTACTAR", qualification: {}, revision: 1, created_at: "2026-10-16T15:00:00Z",
      updated_at: "2026-10-16T15:00:00Z", in_email_campaign: true }], users: [], generated_at: "2026-10-16T15:00:00Z" }).records[0]!;
    expect(displayName(record)).toBe("Hope Global");
    expect(stageRequirements(record, "RESPONDIO")).toEqual([]);
    expect(inView(record, "por_contactar", null)).toBe(true);
    expect(inView(record, "por_calificar", null)).toBe(false);
    expect(matchesOrigin(record, "DIRECTORIO")).toBe(true);
    expect(matchesOrigin(record, "CORREO")).toBe(false);
    expect(crmCommandSchema.safeParse({ op: "IMPORTAR", payload: { file_name: "Directorio", rows: [{ company_name: "Hope Global", city: "León" }] } }).success).toBe(true);
  });
});
