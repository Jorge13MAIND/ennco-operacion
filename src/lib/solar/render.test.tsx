import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => "/operacion/proyectos/cotizar",
  useSearchParams: () => new URLSearchParams(),
}));

import grantInput from "@/lib/solar/__fixtures__/quote-grant.json";
import { SolarHome } from "@/components/solar/SolarHome";
import { SolarQuoteWorkspace } from "@/components/solar/SolarQuoteWorkspace";
import { workbookCatalog } from "@/lib/solar/workbook";
import { defaultQuoteInput } from "@/lib/solar/defaults";
import type { CatalogVersions, StoredQuote } from "@/lib/solar/server";
import type { QuoteInput } from "@/lib/solar/types";

const versions = { solar_cities: { name: "Libro v1.0.1", source: "workbook", version: 0 } } as unknown as CatalogVersions;
const quote = {
  id: "4484a250-a1c7-41bf-9d9a-afe8012376cb", projectId: null, segment: "RESIDENTIAL", name: "Cotización Prueba Grant",
  status: "DRAFT", version: 1, catalogVersions: versions,
  summary: { city: "Querétaro", systemKw: 2.34, modules: 4, annualGeneration: 4071.67, coverage: 0, annualWithout: 0, annualWith: 406.92, cashPrice: 50929.8, irr: 0, paybackTotal: -0.87, tariff: "1" },
  createdAt: "2026-09-16T20:58:44.023921+00:00", updatedAt: "2026-09-16T20:58:44.023921+00:00",
  input: grantInput as unknown as QuoteInput,
} as unknown as StoredQuote;

describe("pantallas del cotizador con la cotización real de producción", () => {
  it("la lista de cotizaciones se renderiza", () => {
    expect(renderToStaticMarkup(<SolarHome live quotes={[quote]} versions={versions} />)).toContain("Cotización Prueba Grant");
  });
  it("la pantalla de captura se renderiza al abrir esa cotización", () => {
    const catalog = workbookCatalog();
    const html = renderToStaticMarkup(
      <SolarQuoteWorkspace catalog={catalog} defaults={defaultQuoteInput("RESIDENTIAL", catalog)} example={null} initial={quote} live versions={versions} />,
    );
    expect(html).toContain("Cotización Prueba Grant");
  });
  it("la pantalla de captura se renderiza en blanco", () => {
    const catalog = workbookCatalog();
    const html = renderToStaticMarkup(
      <SolarQuoteWorkspace catalog={catalog} defaults={defaultQuoteInput("RESIDENTIAL", catalog)} example={null} initial={null} live versions={versions} />,
    );
    expect(html).toContain("Nueva cotización");
  });
});
