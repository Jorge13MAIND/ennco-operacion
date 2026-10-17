import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { apiIngestSchema, READING_FIELDS, resolveThresholds, DEFAULT_THRESHOLDS } from "@/lib/medidores/model";

describe("modelo de medidores", () => {
  it("las columnas de una lectura son las mismas que crea la migración 113", () => {
    const gen = readFileSync("tools/medidores/gen-113.py", "utf8");
    const list = /READING_FIELDS = \[([\s\S]*?)\]/.exec(gen)![1]!.match(/"([a-z0-9_]+)"/g)!.map((s) => s.slice(1, -1));
    expect(list).toEqual([...READING_FIELDS]);
    const migration = readFileSync("supabase/migrations/202610160113_medidores.sql", "utf8");
    for (const field of READING_FIELDS) expect(migration).toContain(`${field} real`);
  });

  it("la API acepta una lectura o un lote, con hora con zona, y rechaza campos desconocidos", () => {
    expect(apiIngestSchema.safeParse({ ts: "2026-10-19T09:30:00-06:00", p_import_kw: 42.1 }).success).toBe(true);
    expect(apiIngestSchema.safeParse({ readings: [{ ts: "2026-10-19T15:30:00Z", v_l1: 127, harmonics: { v: { "5": [1, 2, 3] } } }] }).success).toBe(true);
    expect(apiIngestSchema.safeParse({ ts: "2026-10-19 09:30", p_import_kw: 1 }).success).toBe(false);
    expect(apiIngestSchema.safeParse({ ts: "2026-10-19T09:30:00Z", potencia: 1 }).success).toBe(false);
    expect(apiIngestSchema.safeParse({ readings: [] }).success).toBe(false);
  });

  it("los umbrales guardados se mezclan con los de fábrica y se ignoran los inválidos", () => {
    expect(resolveThresholds({ pf_atencion: 0.92 })).toEqual({ ...DEFAULT_THRESHOLDS, pf_atencion: 0.92 });
    expect(resolveThresholds({ pf_atencion: 7 })).toEqual(DEFAULT_THRESHOLDS);
  });
});
