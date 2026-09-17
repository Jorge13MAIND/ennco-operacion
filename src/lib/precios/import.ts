/* Lee la "Tabla comparativa de precios" de ENNCO en el formato en que Paco la lleva:
   - Hojas de materiales (Regina, LISTA PROYECTOS): renglon de meses, renglon de encabezados
     (Equipos | Cant. | Unidad | Precio Uni. | Proveedor ... por mes), renglones de categoria
     (solo texto en A) y renglones de material con precio y proveedor por mes. El renglon
     DOLAR trae el tipo de cambio del mes.
   - Hojas de equipo (PRECIOS INV, PRECIOS MOD): bloques por periodo con una columna por
     proveedor, MAX y $ FINAL (que no se importan: se recalculan). Los renglones sin numero son
     la marca.
   Devuelve el paquete que espera price_import. */
import { colIndex, colLetters, readXlsx, type Cell, type Sheet } from "@/lib/precios/xlsx";
import { EQUIPMENT_CATEGORY, type Currency, type EquipmentLink } from "@/lib/precios/types";

export type ImportedQuote = { supplier: string; period: string; unitPrice: number };
export type ImportedItem = { category: string; name: string; unit: string; currency: Currency; equipment: EquipmentLink; sort: number; quotes: ImportedQuote[] };
export type ImportPayload = { suppliers: string[]; items: ImportedItem[]; fxByPeriod: Record<string, number>; report: { sheets: Array<{ name: string; kind: string; items: number; quotes: number }>; warnings: string[] } };

const MONTHS: Record<string, number> = { ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6, JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, SETIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12 };
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
/** "JUNIO/JULIO" → julio (el ultimo del rango). */
function monthOf(text: Cell): number | null {
  if (typeof text !== "string") return null;
  const parts = norm(text).split(/[\/\-\s]+/).map((p) => MONTHS[p]).filter((m): m is number => typeof m === "number");
  return parts.length ? parts[parts.length - 1]! : null;
}
const period = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}-01`;
const num = (v: Cell): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\s*[\d.,]+\s*$/.test(v) ? Number(v.replace(/,/g, "")) : null);
const str = (v: Cell): string => (typeof v === "string" ? clean(v) : typeof v === "number" ? String(v) : "");

function cell(sheet: Sheet, row: number, col: string): Cell { return sheet.rows.get(row)?.get(col) ?? null; }
function rowCols(sheet: Sheet, row: number): string[] { return [...(sheet.rows.get(row)?.keys() ?? [])].sort((a, b) => colIndex(a) - colIndex(b)); }

/** Hoja de materiales por mes. */
function importMaterials(sheet: Sheet, year: number, out: ImportPayload) {
  // Renglon de meses: el primero (hasta la fila 5) con dos o mas nombres de mes.
  let monthRow = 0; const months: Array<{ priceCol: string; supplierCol: string; month: number }> = [];
  for (let r = 1; r <= 5 && !monthRow; r += 1) {
    const found = rowCols(sheet, r).map((c) => ({ c, m: monthOf(cell(sheet, r, c)) })).filter((x) => x.m);
    if (found.length >= 2) { monthRow = r; for (const f of found) months.push({ priceCol: f.c, supplierCol: colLetters(colIndex(f.c) + 1), month: f.m! }); }
  }
  if (!monthRow) { out.report.warnings.push(`${sheet.name}: no encontré el renglón de meses; hoja omitida.`); return; }
  // Encabezados: renglon con "Unidad" (o "Equipos").
  let unitCol = "C"; let headerRow = 0;
  for (let r = 1; r <= 5; r += 1) for (const c of rowCols(sheet, r)) { const v = norm(str(cell(sheet, r, c))); if (v === "UNIDAD") { unitCol = c; headerRow = r; } }
  const startRow = Math.max(monthRow, headerRow) + 1;
  let category = categoryName(str(cell(sheet, monthRow, "A")) || str(cell(sheet, headerRow || monthRow, "A")) || "General");
  if (/^EQUIPOS$/i.test(category)) category = EQUIPMENT_CATEGORY;
  let sort = 0; let nItems = 0; let nQuotes = 0;
  for (let r = startRow; r <= sheet.maxRow; r += 1) {
    const a = str(cell(sheet, r, "A")); if (!a) continue;
    const unit = str(cell(sheet, r, unitCol));
    const onlyA = rowCols(sheet, r).every((c) => c === "A");
    if (norm(a) === "DOLAR" || months.some((m) => norm(str(cell(sheet, r, m.priceCol))) === "DOLAR")) {
      // Renglon de tipo de cambio: el numero va en la columna del proveedor de cada mes (Paco escribe DOLAR en la de precio).
      for (const m of months) { const v = num(cell(sheet, r, m.supplierCol)) ?? num(cell(sheet, r, m.priceCol)); if (v && v > 5 && v < 60) out.fxByPeriod[period(year, m.month)] = v; }
      if (norm(a) !== "DOLAR") { category = categoryName(a); sort = 0; }
      continue;
    }
    if (onlyA) { category = categoryName(a); sort = 0; continue; }  // encabezado de categoria: solo texto en A
    const quotes: ImportedQuote[] = [];
    for (const m of months) {
      const p = num(cell(sheet, r, m.priceCol)); const s = str(cell(sheet, r, m.supplierCol));
      if (p != null && p > 0 && s && !MONTHS[norm(s)]) { const sn = supplierName(s); quotes.push({ supplier: sn, period: period(year, m.month), unitPrice: p }); if (!out.suppliers.includes(sn)) out.suppliers.push(sn); }
    }
    // Dolares: todo Equipos FV, y el cable solar cuando el precio por metro es de dolares (menor a 5).
    const currency: Currency = norm(category) === norm(EQUIPMENT_CATEGORY) || (/CABLE SOLAR/.test(norm(a)) && quotes.some((q) => q.unitPrice < 5)) ? "USD" : "MXN";
    out.items.push({ category, name: a, unit: unit || "Pzs", currency, equipment: null, sort: sort += 1, quotes });
    nItems += 1; nQuotes += quotes.length;
  }
  out.report.sheets.push({ name: sheet.name, kind: "materiales", items: nItems, quotes: nQuotes });
}

/** Hoja de equipo (inversores o paneles): bloques por periodo con proveedores en columnas. */
function importEquipment(sheet: Sheet, year: number, category: string, kind: "inverter" | "module", out: ImportPayload) {
  const blocks: Array<{ from: number; to: number; month: number }> = [];
  const cols1 = rowCols(sheet, 1);
  for (let i = 0; i < cols1.length; i += 1) {
    const m = monthOf(cell(sheet, 1, cols1[i]!)); if (!m) continue;
    const from = colIndex(cols1[i]!); const next = cols1[i + 1] ? colIndex(cols1[i + 1]!) - 1 : from + 8;
    blocks.push({ from, to: next, month: m });
  }
  if (!blocks.length) { out.report.warnings.push(`${sheet.name}: sin periodos en el renglón 1; hoja omitida.`); return; }
  // Renglon 3: proveedores por columna; se corta en la columna MAX / $ FINAL del renglon 2.
  const stops = new Set(rowCols(sheet, 2).filter((c) => /^(MAX|\$ ?FINAL)$/.test(norm(str(cell(sheet, 2, c))))).map(colIndex));
  const supplierCols: Array<{ col: string; name: string; month: number }> = [];
  for (const b of blocks) for (let ci = b.from; ci <= b.to; ci += 1) { if (stops.has(ci)) break; const name = str(cell(sheet, 3, colLetters(ci))); if (name) supplierCols.push({ col: colLetters(ci), name: supplierName(titleCase(name)), month: b.month }); }
  for (const s of supplierCols) if (!out.suppliers.includes(s.name)) out.suppliers.push(s.name);
  let brand = ""; let sort = 0; let nItems = 0; let nQuotes = 0;
  for (let r = 4; r <= sheet.maxRow; r += 1) {
    const a = str(cell(sheet, r, "A")); if (!a) continue;
    const quotes: ImportedQuote[] = [];
    for (const s of supplierCols) { const p = num(cell(sheet, r, s.col)); if (p != null && p > 0) quotes.push({ supplier: s.name, period: period(year, s.month), unitPrice: p }); }
    const anyNumber = rowCols(sheet, r).some((c) => c !== "A" && num(cell(sheet, r, c)) != null);
    if (!anyNumber) { brand = a; continue; }
    const name = brand && !norm(a).startsWith(norm(brand).split(" ")[0]!) ? `${brand} ${a}` : a;
    out.items.push({ category, name: clean(name), unit: "Pzs", currency: "USD", equipment: { kind, model: a }, sort: sort += 1, quotes });
    nItems += 1; nQuotes += quotes.length;
  }
  out.report.sheets.push({ name: sheet.name, kind: category, items: nItems, quotes: nQuotes });
}
const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
/** Un mismo proveedor escrito de varias formas en el Excel. */
const SUPPLIER_ALIAS: Record<string, string> = { ASCENCIO: "Grupo Ascencio", "GRUPO ASCENCIO": "Grupo Ascencio", DM: "DM Solar", "DM SOLAR": "DM Solar", EXEL: "Exel", EXCEL: "Exel", "EVOVID SOLAR": "EVOVID Solar", "NOS MUEVE EL SOL": "Nos mueve el Sol" };
export function supplierName(raw: string): string { const c = clean(raw); return SUPPLIER_ALIAS[norm(c)] ?? c; }
/** Nombres de categoria: espacios antes de la pulgada y el significado de EA / EV (lectura nuestra: pared gruesa y pared delgada). */
export function categoryName(raw: string): string {
  let c = clean(raw).replace(/\s+"/g, '"').replace(/(\d)\s+(\d\/\d)/g, "$1 $2");
  c = c.replace(/\bEA\b/, "pared gruesa (EA)").replace(/\bEV\b/, "pared delgada (EV)");
  return c;
}

export function importPriceWorkbook(buf: Buffer, year = new Date().getUTCFullYear()): ImportPayload {
  const out: ImportPayload = { suppliers: [], items: [], fxByPeriod: {}, report: { sheets: [], warnings: [] } };
  for (const sheet of readXlsx(buf)) {
    const n = norm(sheet.name);
    if (/PRECIOS?\s*INV/.test(n)) importEquipment(sheet, year, "Inversores", "inverter", out);
    else if (/PRECIOS?\s*MOD|PANEL/.test(n)) importEquipment(sheet, year, "Paneles", "module", out);
    else importMaterials(sheet, year, out);
  }
  // Un mismo material en dos hojas: se unen sus cotizaciones (la mas reciente manda si se repite mes y proveedor).
  const merged = new Map<string, ImportedItem>();
  for (const it of out.items) {
    const key = `${norm(it.category)}|${norm(it.name)}`;
    const prev = merged.get(key);
    if (!prev) merged.set(key, it);
    else { for (const q of it.quotes) { const i = prev.quotes.findIndex((x) => x.supplier === q.supplier && x.period === q.period); if (i >= 0) prev.quotes[i] = q; else prev.quotes.push(q); } }
  }
  out.items = [...merged.values()];
  const seen = new Map<string, string>(); for (const sp of out.suppliers.map(supplierName)) if (!seen.has(norm(sp))) seen.set(norm(sp), sp);
  out.suppliers = [...seen.values()].sort((a, b) => a.localeCompare(b, "es"));
  for (const it of out.items) for (const q of it.quotes) q.supplier = seen.get(norm(supplierName(q.supplier))) ?? q.supplier;
  return out;
}
