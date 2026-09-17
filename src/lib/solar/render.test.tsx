import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  usePathname: () => "/operacion/proyectos/cotizar",
  useSearchParams: () => new URLSearchParams(),
}));

import golden from "@/lib/solar/__fixtures__/golden-v101.json";
import grantInput from "@/lib/solar/__fixtures__/quote-grant.json";
import { SolarHome } from "@/components/solar/SolarHome";
import { SolarQuoteSheet } from "@/components/solar/SolarQuoteSheet";
import { SolarQuoteWorkspace } from "@/components/solar/SolarQuoteWorkspace";
import { computeQuote } from "@/lib/solar/quote";
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

describe("la lista tolera cotizaciones con datos incompletos", () => {
  const versionsFallback = {} as unknown as CatalogVersions;
  const roto = {
    id: "00000000-0000-4000-8000-000000000000", projectId: null, segment: "COMMERCIAL", name: "Sin resumen",
    status: "DRAFT", version: 1, catalogVersions: versionsFallback, summary: {},
    createdAt: "fecha inválida", updatedAt: "fecha inválida",
  } as unknown as StoredQuote;
  it("una cotización sin resumen ni fecha válida no rompe la pantalla", () => {
    const html = renderToStaticMarkup(<SolarHome live quotes={[roto]} versions={versionsFallback} />);
    expect(html).toContain("Sin resumen");
  });
  it("sin catálogos ni cotizaciones se avisa del fallo de lectura", () => {
    const html = renderToStaticMarkup(<SolarHome live quotes={[]} storageError versions={versionsFallback} />);
    expect(html).toContain("No se pudieron leer las cotizaciones guardadas");
  });
});

describe("hoja imprimible de la cotización", () => {
  const catalog = workbookCatalog();
  it("dibuja la hoja del libro con los datos de la cotización guardada de Grant", () => {
    const result = computeQuote(grantInput as unknown as QuoteInput, catalog);
    const html = renderToStaticMarkup(<SolarQuoteSheet result={result} />);
    expect(html).toContain("Datos Generales del Proyecto:");
    expect(html).toContain("Información del Centro de Carga:");
    expect(html).toContain("Información del Sistema Fotovoltaico:");
    expect(html).toContain("Servicios Adicionales Al Sistema Fotovoltaico:");
    expect(html).toContain("Condiciones de Proyecto:");
    expect(html).toContain("Garantías del Proyecto:");
    expect(html).toContain("Términos generales:");
    expect(html).toContain("Cobertura Energética:");
  });
  it("el ejemplo del libro (Saltillo) sale con su precio de contado y su cobertura", () => {
    const result = computeQuote((golden as Record<string, { inputs: QuoteInput }>).RESIDENTIAL!.inputs, catalog);
    const html = renderToStaticMarkup(<SolarQuoteSheet result={result} />);
    expect(html).toContain("92,528.85");
    expect(html).toContain("117%");
  });
});

describe("la hoja sirve para los tres segmentos", () => {
  const catalog = workbookCatalog();
  const cases = (golden as Record<string, { inputs: QuoteInput }>);
  for (const segment of ["RESIDENTIAL", "COMMERCIAL", "INDUSTRIAL"]) {
    it(`${segment} se dibuja completa`, () => {
      const html = renderToStaticMarkup(<SolarQuoteSheet result={computeQuote(cases[segment]!.inputs, catalog)} />);
      expect(html).toContain("Términos generales:");
      expect(html).toContain("Garantías del Proyecto:");
      expect(html).not.toContain("NaN");
      expect(html).not.toContain("Infinity");
    });
  }
  it("una cotización sin servicios ni financiamiento no rompe la hoja", () => {
    const base = cases.RESIDENTIAL!.inputs;
    const input: QuoteInput = { ...base, services: [], financing: [], advances: [], orientationCount: 1 };
    const html = renderToStaticMarkup(<SolarQuoteSheet result={computeQuote(input, catalog)} />);
    expect(html).toContain("Servicios Adicionales Al Sistema Fotovoltaico:");
  });
});
