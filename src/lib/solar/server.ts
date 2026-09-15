import "server-only";

import type { OperationsAccessContext } from "@/lib/auth/authorization";
import { listCatalogs } from "@/lib/projects/repository";
import { workbookCatalog } from "@/lib/solar/catalog";
import { computeQuote } from "@/lib/solar/quote";
import type { QuoteSaveInput } from "@/lib/solar/schema";
import { quoteSummary, type QuoteSummary } from "@/lib/solar/summary";
import type { QuoteInput, SolarCatalog } from "@/lib/solar/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

export async function loadSolarCatalog(access: OperationsAccessContext): Promise<{ catalog: SolarCatalog; versions: CatalogVersions }> {
  const catalog = workbookCatalog();
  const versions: CatalogVersions = Object.fromEntries(Object.keys(SOLAR_CATALOG_CATEGORIES).map((c) => [c, { name: "Libro v1.0.1", version: 0, source: "workbook" }]));
  if (access.evidenceClass !== "live" || !access.organizationId) return { catalog, versions };
  try {
    const entries = await listCatalogs(access);
    for (const [category, field] of Object.entries(SOLAR_CATALOG_CATEGORIES)) {
      const approved = entries.filter((e) => e.category === category && e.status === "APPROVED").sort((a, b) => b.version - a.version)[0];
      if (!approved) continue;
      const data = approved.data as Record<string, unknown>;
      const value = "rows" in data ? data.rows : data;
      (catalog as unknown as Record<string, unknown>)[field] = value;
      versions[category] = { name: approved.name, version: approved.version, source: "catalog" };
    }
  } catch {
    // Sin acceso a Catálogos: se usa el libro.
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
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("solar_quote_get", { target_organization_id: organization(access), target_quote_id: id });
  if (error) throw new Error(/SOLAR_QUOTE_NOT_FOUND/u.test(error.message) ? "SOLAR_QUOTE_NOT_FOUND" : "SOLAR_STORAGE_UNAVAILABLE");
  return data as StoredQuote;
}

export async function saveQuote(access: OperationsAccessContext, payload: QuoteSaveInput): Promise<StoredQuote> {
  if (access.role === "auditor_readonly") throw new Error("SOLAR_FORBIDDEN");
  const { catalog, versions } = await loadSolarCatalog(access);
  const result = computeQuote(payload.input, catalog);
  const summary = quoteSummary(result);
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("solar_quote_save", {
    target_organization_id: organization(access),
    target_quote_id: payload.id ?? null,
    target_project_id: payload.projectId ?? null,
    target_segment: payload.input.segment,
    target_name: payload.name,
    target_input: payload.input,
    target_result: { summary, modulesNeeded: result.modulesNeeded, demandWarning: result.demandWarning, bill: { annualWithout: result.bill.annualWithout, annualWith: result.bill.annualWith }, projection: { irr: result.projection.irr, paybackTotal: result.projection.paybackTotal } },
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
