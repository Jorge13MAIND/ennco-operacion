import { notFound } from "next/navigation";

import { SolarQuoteSheet } from "@/components/solar/SolarQuoteSheet";
import { SolarSheetBar } from "@/components/solar/SolarSheetBar";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { computeQuote } from "@/lib/solar/quote";
import { getQuote, loadSolarCatalog } from "@/lib/solar/server";
import { workbookCatalog } from "@/lib/solar/workbook";
import "@/styles/solar-sheet.css";

export const dynamic = "force-dynamic";

/** Hoja de la cotización para imprimir o guardar como PDF, con el formato del libro. */
export default async function SolarSheetPage({ searchParams }: { searchParams: Promise<{ cotizacion?: string; imprimir?: string }> }) {
  const access = await requireOperationsAccess();
  const params = await searchParams;
  if (!params.cotizacion) notFound();

  let quote;
  try { quote = await getQuote(access, params.cotizacion); } catch { notFound(); }
  if (!quote?.input) notFound();

  let catalog;
  try { catalog = (await loadSolarCatalog(access)).catalog; } catch { catalog = workbookCatalog(); }

  let result;
  try { result = computeQuote(quote.input, catalog); } catch { notFound(); }

  return (
    <div className="hj-wrap">
      <SolarSheetBar auto={params.imprimir === "1"} name={quote.name} quoteId={quote.id} />
      <SolarQuoteSheet result={result} />
    </div>
  );
}
