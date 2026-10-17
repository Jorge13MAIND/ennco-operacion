/* Parte pura del lector de .xlsx (sin node:zlib): convierte el XML del libro en hojas. La usan el
   lector del servidor (precios/xlsx.ts) y el del navegador (medidores/xlsx-browser.ts). */
export const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

export type Cell = string | number | boolean | null;
export type Sheet = { name: string; rows: Map<number, Map<string, Cell>>; maxRow: number };

export function colIndex(letters: string): number { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
export function colLetters(index: number): string { let s = ""; let n = index; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }

/** Lee todas las hojas; los valores de formula se toman del resultado guardado. */
export function parseSheets(text: (name: string) => string): Sheet[] {
  const shared = [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unescape([...m[1]!.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join("")));
  const rels = new Map([...text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)].map((m) => [m[1]!, m[2]!]));
  const relsAlt = new Map([...text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*?Target="([^"]+)"[^>]*?Id="([^"]+)"/g)].map((m) => [m[2]!, m[1]!]));
  const sheets: Sheet[] = [];
  for (const m of text("xl/workbook.xml").matchAll(/<sheet\b[^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"/g)) {
    const target = (rels.get(m[2]!) ?? relsAlt.get(m[2]!) ?? "").replace(/^\/?(xl\/)?/, "");
    const xml = text(`xl/${target}`);
    const rows = new Map<number, Map<string, Cell>>(); let maxRow = 0;
    for (const c of xml.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const col = c[1]!, row = Number(c[2]), attr = c[3] ?? "", inner = c[4] ?? "";
      const type = /t="([a-zA-Z]+)"/.exec(attr)?.[1] ?? "n";
      let value: Cell = null;
      if (type === "inlineStr") value = unescape([...inner.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join(""));
      else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        if (v == null) continue;
        if (type === "s") value = shared[Number(v)] ?? "";
        else if (type === "b") value = v === "1";
        else if (type === "str" || type === "e") value = unescape(v);
        else value = Number(v);
      }
      if (value === null || value === "") continue;
      if (!rows.has(row)) rows.set(row, new Map());
      rows.get(row)!.set(col, value); if (row > maxRow) maxRow = row;
    }
    sheets.push({ name: unescape(m[1]!), rows, maxRow });
  }
  return sheets;
}

