import type { Cell, Sheet } from "@/lib/precios/xlsx-parse";
import type { Harmonics, ReadingField } from "@/lib/medidores/model";

/**
 * Exportación a Excel de un analizador de red Circutor (como "DATOS PADIHER.xlsx", 16-oct): una hoja por
 * magnitud, la columna A con la fecha y hora (número de serie de Excel, hora de la planta) y dos filas de
 * encabezado. La fila 1 trae el grupo ("Distorción de corriente", "Armónico de Tensión 5 (%)") y la 2 la
 * columna ("THD L1 (%)", "L1"). Las columnas se reconocen por su texto, no por su posición ni por el
 * nombre de la hoja. Las filas "MÁX" y "MÍN" del final se ignoran. Lo que no se reconoce no se carga y
 * se reporta.
 *
 * Cada lectura queda con hora local "YYYY-MM-DDTHH:mm"; la base la convierte con la zona de la planta.
 * Mínimos y máximos por fase se resumen: la tensión mínima es la más baja de las tres fases (el hueco
 * más profundo) y la máxima, la más alta. Los armónicos llegan cada 30 min y se pegan a la lectura de
 * esa misma hora.
 */
export type ImportRow = { ts: string; harmonics?: Harmonics } & Partial<Record<ReadingField, number>>;

export type CircutorFile = {
  rows: ImportRow[];
  first: string | null;
  last: string | null;
  intervalMinutes: number | null;
  fields: ReadingField[];
  harmonicReadings: number;
  sheets: Array<{ name: string; columns: number; recognized: boolean }>;
  warnings: string[];
};

type Target =
  | { kind: "field"; field: ReadingField }
  | { kind: "min" | "max"; field: ReadingField }
  | { kind: "harmonic"; family: "v" | "i"; order: number; phase: 0 | 1 | 2 };

export const normalizeHeader = (value: Cell | undefined): string =>
  String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

const phaseIndex = (text: string): 0 | 1 | 2 | null => {
  const m = /\bl([123])\b/.exec(text);
  return m ? (Number(m[1]) - 1) as 0 | 1 | 2 : null;
};
const isPhase = (text: string) => phaseIndex(text) !== null;
const PHASES = ["l1", "l2", "l3"] as const;

/** Qué columna de la lectura llena una columna del Excel. */
export function targetFor(group: string, header: string, sheet: string): Target | null {
  const h = header;
  const all = `${group} ${h} ${sheet}`;
  // Armónicos: el número viene en el grupo y la fase en la columna.
  const harmonic = /armonico de (tension|corriente) (\d{1,2})/.exec(group);
  if (harmonic) {
    const phase = phaseIndex(h);
    return phase === null ? null : { kind: "harmonic", family: harmonic[1] === "tension" ? "v" : "i", order: Number(harmonic[2]), phase };
  }
  const isMin = /\bmin\b/.test(h);
  const isMax = /\bmax\b/.test(h);
  const ph = phaseIndex(h);
  const pick = (base: string): Target | null => {
    // base: v_ln / i / p_import / p_export / s / pf / thd_v / thd_i
    if (isMin || isMax) {
      const summary: Record<string, [ReadingField, ReadingField] | undefined> = {
        v_ln: ["v_ln_min", "v_ln_max"], v_ll: ["v_ll_min", "v_ll_max"], i: [ "i_max", "i_max"],
        p_import: ["p_import_max_kw", "p_import_max_kw"], p_export: ["p_export_max_kw", "p_export_max_kw"], s: ["s_kva_max", "s_kva_max"],
        thd_v: ["thd_v_max", "thd_v_max"], thd_i: ["thd_i_max", "thd_i_max"], freq: ["freq_min", "freq_max"],
      };
      const pair = summary[base];
      if (!pair) return null;
      // Para potencia, aparente, corriente y THD solo interesa el máximo (del total "III" o de las fases).
      if (isMin) return base === "v_ln" || base === "v_ll" || base === "freq" ? { kind: "min", field: pair[0] } : null;
      if (base === "thd_v" || base === "thd_i") return null; // el pico instantáneo de THD es ruido; se usa el promedio
      if ((base === "p_import" || base === "p_export" || base === "s") && ph !== null) return null; // el máximo trifásico basta
      return { kind: "max", field: pair[1] };
    }
    if (base === "freq") return { kind: "field", field: "freq" };
    if (ph === null) {
      const total: Record<string, ReadingField> = { v_ln: "v_ln", v_ll: "v_ll", i: "i_avg", p_import: "p_import_kw", p_export: "p_export_kw", s: "s_kva", pf: "pf" };
      return total[base] ? { kind: "field", field: total[base]! } : null;
    }
    const perPhase: Record<string, ReadingField[]> = {
      v_ln: ["v_l1", "v_l2", "v_l3"], i: ["i_l1", "i_l2", "i_l3"], p_import: ["p_import_l1", "p_import_l2", "p_import_l3"],
      p_export: ["p_export_l1", "p_export_l2", "p_export_l3"], pf: ["pf_l1", "pf_l2", "pf_l3"],
      thd_v: ["thd_v_l1", "thd_v_l2", "thd_v_l3"], thd_i: ["thd_i_l1", "thd_i_l2", "thd_i_l3"],
    };
    const list = perPhase[base];
    return list ? { kind: "field", field: list[ph]! } : null;
  };

  if (/\bthd\b|distorsion|distorcion/.test(all)) {
    if (/corriente/.test(`${group} ${sheet}`)) return pick("thd_i");
    if (/tension/.test(`${group} ${sheet}`)) return pick("thd_v");
    return null;
  }
  if (/^frecuencia|\bfrecuencia\b/.test(h)) return pick("freq");
  if (/^tension/.test(h)) {
    // "Tensión L1 - L2 (V)" es entre fases; "Tensión L1 - L2 - L3 (V)" es el promedio entre fases.
    const between = /l[123] ?- ?l[123]/.test(h);
    if (between) {
      if (/l1 ?- ?l2 ?- ?l3/.test(h)) return isMin ? { kind: "min", field: "v_ll_min" } : isMax ? { kind: "max", field: "v_ll_max" } : { kind: "field", field: "v_ll" };
      return isMin ? { kind: "min", field: "v_ll_min" } : isMax ? { kind: "max", field: "v_ll_max" } : null;
    }
    if (/\biii\b/.test(h) || isPhase(h)) return pick("v_ln");
    return null;
  }
  if (/^corriente/.test(h)) return pick("i");
  if (/^p\.? ?activa|^potencia activa/.test(h)) return pick(/-\s*$/.test(h) ? "p_export" : "p_import");
  if (/^p\.? ?aparente|^potencia aparente/.test(h)) return pick("s");
  if (/^f\.? ?p\.?\b|^factor de potencia/.test(h)) return pick("pf");
  return null;
}

/** Número de serie de Excel o texto "dd/mm/aaaa hh:mm" a hora local "YYYY-MM-DDTHH:mm". */
export function localTimestamp(value: Cell | undefined): string | null {
  if (typeof value === "number" && value > 20000 && value < 80000) {
    const ms = Math.round((value - 25569) * 86400) * 1000; // días desde 1899-12-30, redondeado al segundo
    const date = new Date(Math.round(ms / 60000) * 60000);
    return date.toISOString().slice(0, 16);
  }
  if (typeof value === "string") {
    const text = value.trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/.exec(text);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}T${iso[4]!.padStart(2, "0")}:${iso[5]}`;
    const mx = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/.exec(text);
    if (mx) return `${mx[3]}-${mx[2]!.padStart(2, "0")}-${mx[1]!.padStart(2, "0")}T${mx[4]!.padStart(2, "0")}:${mx[5]}`;
  }
  return null;
}

const numeric = (value: Cell | undefined): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && /^-?\d+([.,]\d+)?(e-?\d+)?$/i.test(value.trim())) return Number(value.trim().replace(",", "."));
  return null;
};

const colOrder = (letters: string) => { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };

export function readCircutorWorkbook(sheets: Sheet[]): CircutorFile {
  const byTs = new Map<string, ImportRow & { _main?: boolean }>();
  const fields = new Set<ReadingField>();
  const report: CircutorFile["sheets"] = [];
  const warnings: string[] = [];
  let harmonicReadings = 0;

  for (const sheet of sheets) {
    const sheetName = normalizeHeader(sheet.name);
    // La fila de encabezados es la primera (de las 6 primeras) con al menos 2 columnas de texto y la A
    // vacía o "Fecha/Hora"; el grupo es la fila de arriba, si existe.
    let headerRow = 0;
    for (let r = 1; r <= Math.min(6, sheet.maxRow); r += 1) {
      const row = sheet.rows.get(r);
      if (!row) continue;
      const texts = [...row.entries()].filter(([col, v]) => col !== "A" && typeof v === "string").length;
      const next = sheet.rows.get(r + 1);
      if (texts >= 2 && localTimestamp(next?.get("A")) !== null) { headerRow = r; break; }
    }
    if (!headerRow) { report.push({ name: sheet.name, columns: 0, recognized: false }); continue; }
    const header = sheet.rows.get(headerRow)!;
    const groupRow = headerRow > 1 ? sheet.rows.get(headerRow - 1) : undefined;
    const columns = [...header.keys()].filter((c) => c !== "A").sort((a, b) => colOrder(a) - colOrder(b));
    let group = "";
    const targets = new Map<string, Target>();
    for (const col of columns) {
      const g = normalizeHeader(groupRow?.get(col));
      if (g) group = g;
      const target = targetFor(group, normalizeHeader(header.get(col)), sheetName);
      if (target) targets.set(col, target);
    }
    report.push({ name: sheet.name, columns: targets.size, recognized: targets.size > 0 });
    if (targets.size === 0) continue;

    for (let r = headerRow + 1; r <= sheet.maxRow; r += 1) {
      const row = sheet.rows.get(r);
      const ts = localTimestamp(row?.get("A"));
      if (!row || !ts) continue;
      const out = byTs.get(ts) ?? { ts };
      let isHarmonicRow = false;
      for (const [col, target] of targets) {
        const value = numeric(row.get(col));
        if (value === null) continue;
        if (target.kind === "harmonic") {
          const fam = (out.harmonics ??= {});
          const bucket = (fam[target.family] ??= {});
          const arr = (bucket[String(target.order)] ??= [null, null, null]);
          arr[target.phase] = value;
          isHarmonicRow = true;
          continue;
        }
        const current = out[target.field];
        if (target.kind === "field") out[target.field] = value;
        else if (target.kind === "min") out[target.field] = current === undefined ? value : Math.min(current, value);
        else out[target.field] = current === undefined ? value : Math.max(current, value);
        fields.add(target.field);
        out._main = true;
      }
      if (isHarmonicRow || out._main) byTs.set(ts, out);
    }
  }

  // THD máximo de la lectura = el más alto de las tres fases (promedio del intervalo).
  for (const row of byTs.values()) {
    for (const family of ["v", "i"] as const) {
      const phases = PHASES.map((p) => row[`thd_${family}_${p}` as ReadingField]).filter((v): v is number => typeof v === "number");
      if (phases.length) { row[`thd_${family}_max` as ReadingField] = Math.max(...phases); fields.add(`thd_${family}_max` as ReadingField); }
    }
    if (row.harmonics) harmonicReadings += 1;
  }

  const rows = [...byTs.values()].sort((a, b) => a.ts.localeCompare(b.ts)).map(({ _main, ...rest }) => { void _main; return rest; });
  const mainTimes = [...byTs.values()].filter((r) => r._main).map((r) => Date.parse(`${r.ts}:00Z`)).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < mainTimes.length; i += 1) gaps.push((mainTimes[i]! - mainTimes[i - 1]!) / 60000);
  gaps.sort((a, b) => a - b);
  const intervalMinutes = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : null;
  if (intervalMinutes && gaps.some((g) => g > intervalMinutes * 3)) {
    const missing = gaps.filter((g) => g > intervalMinutes * 1.5).reduce((sum, g) => sum + Math.round(g / intervalMinutes) - 1, 0);
    warnings.push(`Faltan unas ${missing} lecturas entre el inicio y el fin (huecos en la medición).`);
  }
  const unrecognized = report.filter((s) => !s.recognized).map((s) => s.name);
  if (unrecognized.length) warnings.push(`Hojas que no se reconocieron y no se cargan: ${unrecognized.join(", ")}.`);
  return {
    rows, first: rows[0]?.ts ?? null, last: rows.at(-1)?.ts ?? null, intervalMinutes,
    fields: [...fields].sort(), harmonicReadings, sheets: report, warnings,
  };
}
