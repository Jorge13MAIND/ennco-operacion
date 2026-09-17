import { api, context, ProjectApiError } from "@/lib/solar/api";
import { importPriceWorkbook } from "@/lib/precios/import";
import { importPrices } from "@/lib/precios/server";
export const dynamic = "force-dynamic";
/** Recibe el .xlsx de Paco (multipart, campo "archivo"); con ?previa=1 solo devuelve el reporte sin guardar. */
export async function POST(request: Request) {
  return api(async () => {
    const c = await context(request);
    const form = await request.formData().catch(() => null);
    const file = form?.get("archivo");
    if (!(file instanceof File)) throw new ProjectApiError("PRICE_FILE_REQUIRED", 400);
    if (file.size > 15_000_000) throw new ProjectApiError("PROJECT_REQUEST_TOO_LARGE", 413);
    const year = Number(form?.get("anio") ?? new Date().getUTCFullYear());
    let payload;
    try { payload = importPriceWorkbook(Buffer.from(await file.arrayBuffer()), Number.isFinite(year) ? year : new Date().getUTCFullYear()); } catch { throw new ProjectApiError("PRICE_FILE_INVALID", 422); }
    const preview = new URL(request.url).searchParams.get("previa") === "1";
    if (preview) return { report: payload.report, suppliers: payload.suppliers, items: payload.items.length, quotes: payload.items.reduce((a, i) => a + i.quotes.length, 0), fxByPeriod: payload.fxByPeriod };
    try { return { result: await importPrices(c, payload), report: payload.report }; } catch (e) {
      const code = e instanceof Error ? e.message : "SOLAR_STORAGE_UNAVAILABLE";
      throw new ProjectApiError(code, code === "SOLAR_FORBIDDEN" ? 403 : 503);
    }
  });
}
