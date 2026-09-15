import { notFound } from "next/navigation";

import { SolarQuoteWorkspace } from "@/components/solar/SolarQuoteWorkspace";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import golden from "@/lib/solar/__fixtures__/golden-v101.json";
import { defaultQuoteInput } from "@/lib/solar/defaults";
import { getQuote, loadSolarCatalog, type StoredQuote } from "@/lib/solar/server";
import type { QuoteInput, Segment } from "@/lib/solar/types";

export const dynamic = "force-dynamic";

const SEGMENTS: Segment[] = ["RESIDENTIAL", "COMMERCIAL", "INDUSTRIAL"];

export default async function CotizarPage({ searchParams }: { searchParams: Promise<{ segmento?: string; cotizacion?: string }> }) {
  const access = await requireOperationsAccess();
  const params = await searchParams;
  const { catalog, versions } = await loadSolarCatalog(access);
  let initial: StoredQuote | null = null;
  if (params.cotizacion) {
    try { initial = await getQuote(access, params.cotizacion); } catch { notFound(); }
  }
  const segment = (initial?.segment ?? (SEGMENTS.includes(params.segmento as Segment) ? params.segmento : "RESIDENTIAL")) as Segment;
  const example = (golden as Record<string, { inputs: QuoteInput }>)[segment]?.inputs ?? null;
  return (
    <SolarQuoteWorkspace
      catalog={catalog}
      defaults={defaultQuoteInput(segment, catalog)}
      example={example}
      initial={initial}
      live={access.evidenceClass === "live"}
      versions={versions}
    />
  );
}
