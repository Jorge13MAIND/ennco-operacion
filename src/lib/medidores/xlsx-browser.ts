import { parseSheets, type Sheet } from "@/lib/precios/xlsx-parse";

/**
 * Lector de .xlsx para el navegador: el archivo del analizador no sube al servidor (en Vercel el límite
 * es de 4.5 MB y una medición de 8 días cada minuto pesa más). Solo descomprime lo que hace falta para
 * leer las hojas (libro, relaciones, textos y hojas), no gráficas ni imágenes.
 */
export type Inflate = (raw: Uint8Array) => Promise<Uint8Array>;

const MAX_ENTRY_BYTES = 120 * 1024 * 1024;
const MAX_TOTAL_BYTES = 400 * 1024 * 1024;
const WANTED = /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/;

export async function readXlsxBytes(bytes: Uint8Array, inflate: Inflate): Promise<Sheet[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 70000); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("XLSX_INVALID");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder("utf-8");
  const files = new Map<string, string>();
  let total = 0;
  for (let k = 0; k < count; k += 1) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) throw new Error("XLSX_INVALID");
    const method = view.getUint16(p + 10, true);
    const csize = view.getUint32(p + 20, true);
    const usize = view.getUint32(p + 24, true);
    const nlen = view.getUint16(p + 28, true), xlen = view.getUint16(p + 30, true), clen = view.getUint16(p + 32, true);
    const off = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (!WANTED.test(name)) continue;
    if (usize > MAX_ENTRY_BYTES) throw new Error("XLSX_TOO_LARGE");
    const start = off + 30 + view.getUint16(off + 26, true) + view.getUint16(off + 28, true);
    const raw = bytes.subarray(start, start + csize);
    const data = method === 8 ? await inflate(raw) : raw;
    total += data.length;
    if (data.length > MAX_ENTRY_BYTES || total > MAX_TOTAL_BYTES) throw new Error("XLSX_TOO_LARGE");
    files.set(name, decoder.decode(data));
  }
  return parseSheets((name) => files.get(name) ?? "");
}

/** Descompresión con la API del navegador (DecompressionStream "deflate-raw"). */
export const browserInflate: Inflate = async (raw) => {
  const stream = new Blob([raw.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};
