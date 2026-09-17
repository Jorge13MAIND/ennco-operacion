import { apiError, context, headers, ProjectApiError } from "@/lib/solar/api";
import { computeQuote } from "@/lib/solar/quote";
import { buildQuoteSheetPdf } from "@/lib/solar/sheet-pdf";
import { getQuote, loadSolarCatalog } from "@/lib/solar/server";
import { workbookCatalog } from "@/lib/solar/workbook";

export const dynamic = "force-dynamic";

/** Hoja de la cotización en PDF, dibujada con pdf-lib (no impresa desde el navegador). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const c = await context();
    const quote = await getQuote(c, (await params).id).catch(() => { throw new ProjectApiError("SOLAR_QUOTE_NOT_FOUND", 404); });
    if (!quote.input) throw new ProjectApiError("SOLAR_QUOTE_NOT_FOUND", 404);
    let catalog; try { catalog = (await loadSolarCatalog(c)).catalog; } catch { catalog = workbookCatalog(); }
    let result; try { result = computeQuote(quote.input, catalog); } catch { throw new ProjectApiError("SOLAR_INPUT_NOT_FOUND", 422); }
    const pdf = await buildQuoteSheetPdf(result);
    const name = (quote.name || "Cotización").replace(/[^\p{L}\p{N} .,_-]/gu, "").slice(0, 80);
    return new Response(new Uint8Array(pdf), { headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}.pdf"` } });
  } catch (e) { return apiError(e); }
}
