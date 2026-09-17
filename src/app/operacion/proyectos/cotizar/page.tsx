import { notFound } from "next/navigation";

import { SolarQuoteWorkspace } from "@/components/solar/SolarQuoteWorkspace";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import golden from "@/lib/solar/__fixtures__/golden-v101.json";
import { defaultQuoteInput } from "@/lib/solar/defaults";
import { getQuote, loadSolarCatalog, workbookVersions, type CatalogVersions, type StoredQuote } from "@/lib/solar/server";
import { workbookCatalog } from "@/lib/solar/workbook";
import type { QuoteInput, Segment } from "@/lib/solar/types";

export const dynamic = "force-dynamic";

const SEGMENTS: Segment[] = ["RESIDENTIAL", "COMMERCIAL", "INDUSTRIAL"];

export default async function CotizarPage({ searchParams }: { searchParams: Promise<{ segmento?: string; cotizacion?: string; consumo?: string }> }) {
  const access = await requireOperationsAccess();
  const params = await searchParams;
  // Si Catálogos no responde se cotiza con el libro: la pantalla nunca se queda sin catálogo.
  let catalog = workbookCatalog();
  let versions: CatalogVersions = workbookVersions();
  try {
    const loaded = await loadSolarCatalog(access);
    catalog = loaded.catalog;
    versions = loaded.versions;
  } catch {
    versions = workbookVersions();
  }
  let initial: StoredQuote | null = null;
  if (params.cotizacion) {
    try { initial = await getQuote(access, params.cotizacion); } catch { notFound(); }
  }
  const segment = (initial?.segment ?? (SEGMENTS.includes(params.segmento as Segment) ? params.segmento : "RESIDENTIAL")) as Segment;
  const example = (golden as Record<string, { inputs: QuoteInput }>)[segment]?.inputs ?? null;
  // La calculadora de consumo llega con un estimado mensual: llena los 12 periodos del
  // historial, que es lo que hacia el boton "Exportar datos a residencial" del libro.
  const defaults = defaultQuoteInput(segment, catalog);
  const estimated = Number(params.consumo);
  if (!initial && Number.isFinite(estimated) && estimated > 0) {
    defaults.consumptionKwh = Array.from({ length: 12 }, () => estimated);
  }
  return (
    <SolarQuoteWorkspace
      catalog={catalog}
      defaults={defaults}
      example={example}
      initial={initial}
      live={access.evidenceClass === "live"}
      versions={versions}
    />
  );
}
