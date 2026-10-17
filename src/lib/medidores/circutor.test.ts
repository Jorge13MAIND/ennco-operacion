import { describe, expect, it } from "vitest";

import { localTimestamp, readCircutorWorkbook, targetFor } from "@/lib/medidores/circutor";
import type { Cell, Sheet } from "@/lib/precios/xlsx-parse";

/** Hoja con la forma de la exportación del Circutor: grupo en la fila 1, columnas en la 2, datos abajo. */
function sheet(name: string, groups: Record<string, string>, headers: Record<string, string>, rows: Array<Record<string, Cell>>): Sheet {
  const map = new Map<number, Map<string, Cell>>();
  map.set(1, new Map<string, Cell>([["A", "Fecha/Hora"], ...Object.entries(groups)]));
  map.set(2, new Map<string, Cell>(Object.entries(headers)));
  rows.forEach((r, i) => map.set(i + 3, new Map(Object.entries(r))));
  map.set(rows.length + 3, new Map<string, Cell>([["A", "MÁX"], ["B", 999]]));
  return { name, rows: map, maxRow: rows.length + 3 };
}
const T0 = 46300.7222222222; // 5-oct-2026 17:20
const t = (k: number) => T0 + k * (10 / 1440);

describe("lectura del Excel del Circutor", () => {
  it("convierte el número de serie de Excel a hora local redondeada al minuto", () => {
    expect(localTimestamp(46300.722222222219)).toBe("2026-10-05T17:20");
    expect(localTimestamp("05/10/2026 17:20")).toBe("2026-10-05T17:20");
    expect(localTimestamp("MÁX")).toBeNull();
  });

  it("distingue THD de corriente y de tensión por el grupo, no por el texto de la columna", () => {
    expect(targetFor("distorcion de corriente", "thd l1 (%)", "distorsion de corriente (a)")).toEqual({ kind: "field", field: "thd_i_l1" });
    expect(targetFor("distorcion de tension", "thd l3 (%)", "distorsion de tension (v)")).toEqual({ kind: "field", field: "thd_v_l3" });
    expect(targetFor("distorcion de tension max", "thd max l3 (%)", "x")).toBeNull();
    expect(targetFor("potencia activa (kw) -", "p. activa iii (kw) -", "x")).toEqual({ kind: "field", field: "p_export_kw" });
    expect(targetFor("potencia activa max (kw)", "p. activa max iii (kw)", "x")).toEqual({ kind: "max", field: "p_import_max_kw" });
    expect(targetFor("armonico de tension 5 (%)", "l2", "x")).toEqual({ kind: "harmonic", family: "v", order: 5, phase: 1 });
  });

  it("junta hojas por hora, resume mínimos y máximos, pega los armónicos e ignora las filas MÁX/MÍN", () => {
    const tension = sheet("Tensión Fase - Neutro", { B: "Tensión Fase - Neutro", F: "Tensión mín", J: "Tensión máx" },
      { B: "Tensión III (V)", C: "Tensión L1 (V)", D: "Tensión L2 (V)", E: "Tensión L3 (V)", F: "Tensión mín L1 (V)", G: "Tensión mín L2 (V)", J: "Tensión máx L1 (V)" },
      [{ A: t(0), B: 126.3, C: 126.5, D: 126.6, E: 125.8, F: 125.9, G: 86.8, J: 126.7 }, { A: t(1), B: 126.6, C: 126.9, D: 126.9, E: 126.1, F: 126, G: 126.1, J: 127 }, { A: t(2), B: 126, C: 126, D: 126, E: 126, F: 125, G: 125, J: 127 }]);
    const potencia = sheet("Potencia Activa (kW) -", { B: "Potencia Activa (kW) -" }, { B: "P. Activa III (kW) -", C: "P. Activa L2 (kW) -" },
      [{ A: t(0), B: 0, C: 9 }, { A: t(1), B: 0, C: 8 }, { A: t(2), B: 1, C: 3 }]);
    const armonicos = sheet("Armónicos", { B: "Armónico de Tensión 5 (%)" }, { B: "L1", C: "L2", D: "L3" }, [{ A: t(1), B: 0.3, C: 0.5, D: "0.42" }]);
    const file = readCircutorWorkbook([tension, potencia, armonicos, { name: "Gráfica", rows: new Map(), maxRow: 0 }]);
    expect(file.rows).toHaveLength(3);
    expect(file.intervalMinutes).toBe(10);
    expect(file.rows[0]).toMatchObject({ ts: "2026-10-05T17:20", v_ln: 126.3, v_l2: 126.6, v_ln_min: 86.8, v_ln_max: 126.7, p_export_kw: 0, p_export_l2: 9 });
    expect(file.rows[1]!.harmonics).toEqual({ v: { "5": [0.3, 0.5, 0.42] } });
    expect(file.harmonicReadings).toBe(1);
    expect(file.warnings.join(" ")).toContain("Gráfica");
  });
});
