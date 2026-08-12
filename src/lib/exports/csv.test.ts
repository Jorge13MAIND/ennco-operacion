import { describe, expect, it } from "vitest";

import { createCsv, csvCell } from "@/lib/exports/csv";

describe("CSV exports", () => {
  it("quotes delimiters and neutralizes spreadsheet formulas", () => {
    expect(csvCell("Planta, Norte")).toBe('"Planta, Norte"');
    expect(csvCell('Texto "citado"')).toBe('"Texto ""citado"""');
    expect(csvCell("=HYPERLINK(\"https://invalid\")")).toBe('"\'=HYPERLINK(""https://invalid"")"');
    expect(csvCell("  +SUM(1,1)")).toBe('"\'  +SUM(1,1)"');
  });

  it("creates a BOM-prefixed deterministic table", () => {
    expect(createCsv(["account", "status"], [{ account: "Synthetic", status: "HOLD" }]))
      .toBe('\uFEFF"account","status"\r\n"Synthetic","HOLD"\r\n');
  });
});
