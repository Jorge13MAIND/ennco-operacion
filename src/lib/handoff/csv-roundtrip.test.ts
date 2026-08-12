import { describe, expect, it } from "vitest";

import { createCsv } from "@/lib/exports/csv";
import { parseCsv } from "@/lib/handoff/csv-roundtrip";

describe("CSV handoff roundtrip", () => {
  it("reimporta delimitadores, comillas y saltos de línea", () => {
    const csv = createCsv(["account", "note"], [
      { account: "Planta, Norte", note: 'Texto "citado"\nsegunda línea' },
    ]);
    expect(parseCsv(csv)).toEqual({
      columns: ["account", "note"],
      rows: [{ account: "Planta, Norte", note: 'Texto "citado"\nsegunda línea' }],
    });
  });

  it("conserva la neutralización de fórmulas", () => {
    const table = parseCsv(createCsv(["value"], [{ value: "=1+1" }]));
    expect(table.rows[0]?.value).toBe("'=1+1");
  });

  it("rechaza encabezados duplicados", () => {
    expect(() => parseCsv('"a","a"\r\n"1","2"\r\n')).toThrow("CSV_DUPLICATE_HEADER");
  });

  it("rechaza renglones truncados", () => {
    expect(() => parseCsv('"a","b"\r\n"1"\r\n')).toThrow("CSV_COLUMN_COUNT_MISMATCH");
  });
});
