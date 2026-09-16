import "server-only";

import type { OperationsAccessContext } from "@/lib/auth/authorization";
import { listCatalogs } from "@/lib/projects/repository";
import { workbookCatalog } from "@/lib/solar/workbook";
import { computeQuote } from "@/lib/solar/quote";
import type { QuoteSaveInput } from "@/lib/solar/schema";
import { quoteSummary, type QuoteSummary } from "@/lib/solar/summary";
import type { QuoteInput, SolarCatalog } from "@/lib/solar/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "zod";

/** Forma mínima que debe tener cada catálogo aprobado para sustituir al libro. */
const overrideSchemas: Record<string, z.ZodType<unknown>> = {
  solar_modules: z.array(z.object({ model: z.string(), pmaxW: z.number(), vmpV: z.number(), coefV: z.number(), toncC: z.number() }).passthrough()).min(1),
  solar_inverters: z.array(z.object({ model: z.string(), nominalW: z.number(), pmaxFvW: z.number() }).passthrough()).min(1),
  solar_cities: z.array(z.object({ city: z.string(), irradiance: z.array(z.number().nullable()).length(12), latitude: z.number().nullable() }).passthrough()).min(1),
  solar_factor_k: z.record(z.string(), z.record(z.string(), z.array(z.number().nullable()).length(12))),
  solar_tariffs: z.object({ residential: z.array(z.object({ tariff: z.string() }).passthrough()), dac: z.array(z.object({ region: z.string() }).passthrough()), lowVoltage: z.array(z.object({ tariff: z.string(), zone: z.string() }).passthrough()), mediumVoltage: z.array(z.object({ tariff: z.string(), zone: z.string() }).passthrough()), rates: z.object({ iva: z.number(), dapResidential: z.number(), dapCommercial: z.number(), dapIndustrial: z.number(), lowVoltageMetering: z.number(), powerFactorBonus: z.number(), powerFactorPenalty: z.number(), residentialMinimumKwh: z.number(), incomeTaxDeduction: z.number(), dapResidentialWithPv: z.number() }), loadFactor: z.record(z.string(), z.number()) }).passthrough(),
  solar_prices: z.object({ RESIDENTIAL: z.object({ structureUsdPerModule: z.number(), laborUsdPerModule: z.number() }).passthrough(), COMMERCIAL: z.object({ structureUsdPerModule: z.number(), laborUsdPerModule: z.number() }).passthrough(), INDUSTRIAL: z.object({ structureUsdPerModule: z.number(), laborUsdPerModule: z.number() }).passthrough() }),
  solar_generation: z.object({ RESIDENTIAL: z.object({ performanceRatio: z.number(), loss1: z.number(), loss2: z.number(), daysPerMonth: z.array(z.number()).length(12) }).passthrough(), COMMERCIAL: z.object({ performanceRatio: z.number() }).passthrough(), INDUSTRIAL: z.object({ performanceRatio: z.number() }).passthrough() }),
  solar_mounting: z.object({ es: z.array(z.object({ name: z.string() }).passthrough()), en: z.array(z.object({ name: z.string() }).passthrough()) }),
};

/**
 * Catálogos vigentes: el libro (data/solar) es la base; una entrada APROBADA en Catálogos con
 * categoría solar_* la sustituye (versión más alta gana). Así Paco actualiza tarifas o agrega un
 * módulo sin deploy, y cada cotización guarda qué versiones usó.
 */
export const SOLAR_CATALOG_CATEGORIES = {
  solar_modules: "modules", solar_inverters: "inverters", solar_cities: "cities", solar_factor_k: "factorK",
  solar_tariffs: "tariffs", solar_prices: "prices", solar_generation: "generation", solar_mounting: "mounting",
} as const;
export type SolarCatalogCategory = keyof typeof SOLAR_CATALOG_CATEGORIES;
export type CatalogVersions = Record<string, { name: string; version: number; source: "workbook" | "catalog" }>;

/** Versiones cuando todo viene del libro. Sirve de respaldo si Catálogos no responde. */
export function workbookVersions(): CatalogVersions {
  return Object.fromEntries(Object.keys(SOLAR_CATALOG_CATEGORIES).map((c) => [c, { name: "Libro v1.0.1", version: 0, source: "workbook" as const }]));
}

export async function loadSolarCatalog(access: OperationsAccessContext): Promise<{ catalog: SolarCatalog; versions: CatalogVersions }> {
  const catalog = workbookCatalog();
  const versions: CatalogVersions = workbookVersions();
  if (access.evidenceClass !== "live" || !access.organizationId) return { catalog, versions };
  try {
    const entries = await listCatalogs(access);
    for (const [category, field] of Object.entries(SOLAR_CATALOG_CATEGORIES)) {
      const approved = entries.filter((e) => e.category === category && e.status === "APPROVED").sort((a, b) => b.version - a.version)[0];
      if (!approved) continue;
      const data = approved.data as Record<string, unknown>;
      const value = "rows" in data ? data.rows : data;
      const parsed = overrideSchemas[category]?.safeParse(value);
      if (!parsed?.success) {
        versions[category] = { name: `${approved.name} (forma inválida, se usa el libro)`, version: approved.version, source: "workbook" };
        continue;
      }
      (catalog as unknown as Record<string, unknown>)[field] = value;
      versions[category] = { name: approved.name, version: approved.version, source: "catalog" };
    }
  } catch {
    versions.solar_modules = { ...versions.solar_modules!, name: "Libro v1.0.1 (Catálogos no disponible)" };
  }
  return { catalog, versions };
}

export type StoredQuote = {
  id: string; projectId: string | null; segment: QuoteInput["segment"]; name: string; status: string; version: number;
  summary: Partial<QuoteSummary>; catalogVersions: CatalogVersions; createdAt: string; updatedAt: string; input?: QuoteInput; result?: Record<string, unknown>;
};

function organization(access: OperationsAccessContext): string {
  if (access.evidenceClass !== "live" || !access.organizationId) throw new Error("SOLAR_STORAGE_UNAVAILABLE");
  return access.organizationId;
}

export async function listQuotes(access: OperationsAccessContext): Promise<StoredQuote[]> {
  if (access.evidenceClass !== "live" || !access.organizationId) return [];
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("solar_quotes_list", { target_organization_id: access.organizationId });
  if (error) throw new Error("SOLAR_STORAGE_UNAVAILABLE");
  return (data ?? []) as StoredQuote[];
}

export async function getQuote(access: OperationsAccessContext, id: string): Promise<StoredQuote> {
  if (!z.uuid().safeParse(id).success) throw new Error("SOLAR_QUOTE_NOT_FOUND");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("solar_quote_get", { target_organization_id: organization(access), target_quote_id: id });
  if (error) throw new Error(/SOLAR_QUOTE_NOT_FOUND/u.test(error.message) ? "SOLAR_QUOTE_NOT_FOUND" : "SOLAR_STORAGE_UNAVAILABLE");
  return data as StoredQuote;
}

export async function saveQuote(access: OperationsAccessContext, payload: QuoteSaveInput): Promise<StoredQuote> {
  if (access.role === "auditor_readonly") throw new Error("SOLAR_FORBIDDEN");
  const { catalog, versions } = await loadSolarCatalog(access);
  let result;
  try { result = computeQuote(payload.input, catalog); } catch (e) { throw new Error(e instanceof Error && /SOLAR_[A-Z_]+_NOT_FOUND/u.test(e.message) ? "SOLAR_INPUT_NOT_FOUND" : "SOLAR_STORAGE_UNAVAILABLE"); }
  const summary = quoteSummary(result);
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("solar_quote_save", {
    target_organization_id: organization(access),
    target_quote_id: payload.id ?? null,
    target_project_id: payload.projectId ?? null,
    target_segment: payload.input.segment,
    target_name: payload.name,
    target_input: payload.input,
    target_result: { summary, modulesNeeded: result.modulesNeeded, demandWarning: result.demandWarning, warnings: result.warnings, bill: { annualWithout: result.bill.annualWithout, annualWith: result.bill.annualWith }, projection: { irr: result.projection.irr, paybackTotal: result.projection.paybackTotal } },
    target_catalog_versions: versions,
    expected_version: payload.expectedVersion ?? null,
    target_status: payload.status ?? null,
  });
  if (error) {
    if (/SOLAR_QUOTE_VERSION_CONFLICT/u.test(error.message)) throw new Error("SOLAR_QUOTE_VERSION_CONFLICT");
    if (/SOLAR_QUOTE_NOT_FOUND|SOLAR_QUOTE_PROJECT_NOT_FOUND/u.test(error.message)) throw new Error("SOLAR_QUOTE_NOT_FOUND");
    throw new Error("SOLAR_STORAGE_UNAVAILABLE");
  }
  return data as StoredQuote;
}
