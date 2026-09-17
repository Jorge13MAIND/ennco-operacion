import { EngineeringWorkspace, type EngineeringProject, type QuoteRef } from "@/components/solar/EngineeringWorkspace";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getQuote, listQuotes, loadSolarCatalog } from "@/lib/solar/server";
import { workbookCatalog } from "@/lib/solar/workbook";

export const dynamic = "force-dynamic";

/** Cálculos de ingeniería básicos: sombras, arreglos, circuitos DC y AC, tableros y capacitores. */
export default async function IngenieriaPage({ searchParams }: { searchParams: Promise<{ cotizacion?: string; herramienta?: string }> }) {
  const access = await requireOperationsAccess();
  const params = await searchParams;
  let catalog = workbookCatalog();
  try { catalog = (await loadSolarCatalog(access)).catalog; } catch { /* se trabaja con el libro */ }
  let quotes: QuoteRef[] = [];
  try { quotes = (await listQuotes(access)).map((q) => ({ id: q.id, name: q.name, segment: q.segment })); } catch { /* sin lista */ }
  let initialProject: EngineeringProject | null = null;
  const quoteId = params.cotizacion ?? null;
  if (quoteId) {
    try {
      const q = await getQuote(access, quoteId);
      if (q.input) {
        initialProject = {
          name: q.input.customer.name, city: q.input.city, moduleModel: q.input.moduleModel,
          inverterModel: q.input.inverters[0]?.model ?? catalog.inverters[0]?.model ?? "",
          modulesToInstall: q.input.orientations.reduce((a, o) => a + (o.modules ?? 0), 0),
          invertersCount: Math.max(1, q.input.inverters.reduce((a, i) => a + (i.quantity ?? 0), 0)),
        };
      }
    } catch { /* la cotización no existe: se abre vacía */ }
  }
  return <EngineeringWorkspace catalog={catalog} initialProject={initialProject} initialTool={params.herramienta ?? null} quoteId={initialProject ? quoteId : null} quotes={quotes} />;
}
