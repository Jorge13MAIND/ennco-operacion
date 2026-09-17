import "server-only";
import { z } from "zod";

import type { OperationsAccessContext } from "@/lib/auth/authorization";
import type { PriceCatalog, PriceSettings, SolarProject } from "@/lib/precios/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/* Acceso a precios y proyectos: solo por RPC con guarda de membresia. El rol de solo lectura no escribe. */

function organization(access: OperationsAccessContext): string {
  if (access.evidenceClass !== "live" || !access.organizationId) throw new Error("SOLAR_STORAGE_UNAVAILABLE");
  return access.organizationId;
}
function writable(access: OperationsAccessContext) { if (access.role === "auditor_readonly") throw new Error("SOLAR_FORBIDDEN"); }
function fail(error: { message: string }, notFound: string): never {
  if (/NOT_FOUND/u.test(error.message)) throw new Error(notFound);
  throw new Error("SOLAR_STORAGE_UNAVAILABLE");
}
const EMPTY: PriceCatalog = { suppliers: [], items: [], quotes: [], settings: { iva: 0.16, margin: 0.3, marginByCategory: {}, fxByPeriod: {}, priceRule: "MAX" } };

export async function readPriceCatalog(access: OperationsAccessContext): Promise<PriceCatalog> {
  if (access.evidenceClass !== "live" || !access.organizationId) return EMPTY;
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("price_catalog_read", { target_organization_id: access.organizationId });
  if (error) throw new Error("SOLAR_STORAGE_UNAVAILABLE");
  const c = data as PriceCatalog;
  return { ...c, quotes: c.quotes.map((q) => ({ ...q, unitPrice: Number(q.unitPrice) })), settings: { ...c.settings, iva: Number(c.settings.iva), margin: Number(c.settings.margin) } };
}

export const supplierSchema = z.object({ id: z.uuid().nullable().optional(), name: z.string().min(1).max(120), active: z.boolean().optional() });
export async function saveSupplier(access: OperationsAccessContext, input: z.infer<typeof supplierSchema>) {
  writable(access); const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("price_supplier_save", { target_organization_id: organization(access), target_id: input.id ?? null, target_name: input.name, target_active: input.active ?? true });
  if (error) fail(error, "PRICE_SUPPLIER_NOT_FOUND"); return data;
}

export const itemSchema = z.object({
  id: z.uuid().nullable().optional(), category: z.string().min(1).max(80), name: z.string().min(1).max(200), unit: z.string().max(20).optional(),
  currency: z.enum(["MXN", "USD"]).optional(), equipment: z.object({ kind: z.enum(["module", "inverter"]), model: z.string().min(1) }).nullable().optional(),
  active: z.boolean().optional(), notes: z.string().max(500).nullable().optional(),
});
export async function saveItem(access: OperationsAccessContext, input: z.infer<typeof itemSchema>) {
  writable(access); const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("price_item_save", { target_organization_id: organization(access), target_id: input.id ?? null, target_category: input.category, target_name: input.name, target_unit: input.unit ?? "Pzs", target_currency: input.currency ?? "MXN", target_equipment: input.equipment ?? null, target_active: input.active ?? true, target_notes: input.notes ?? null });
  if (error) fail(error, "PRICE_ITEM_NOT_FOUND"); return data;
}

export const quoteSchema = z.object({ itemId: z.uuid(), supplierId: z.uuid(), period: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/), unitPrice: z.number().min(0), source: z.string().max(80).nullable().optional() });
export async function saveQuote(access: OperationsAccessContext, input: z.infer<typeof quoteSchema>) {
  writable(access); const client = await createSupabaseServerClient();
  const period = input.period.length === 7 ? `${input.period}-01` : input.period;
  const { data, error } = await client.rpc("price_quote_save", { target_organization_id: organization(access), target_item_id: input.itemId, target_supplier_id: input.supplierId, target_period: period, target_unit_price: input.unitPrice, target_source: input.source ?? "manual" });
  if (error) fail(error, "PRICE_ITEM_NOT_FOUND"); return data;
}

export const settingsSchema = z.object({ iva: z.number().min(0).max(1), margin: z.number().min(0).max(5), marginByCategory: z.record(z.string(), z.number().min(0).max(5)), fxByPeriod: z.record(z.string(), z.number().positive()), priceRule: z.enum(["MAX", "MIN", "AVG"]) });
export async function saveSettings(access: OperationsAccessContext, input: PriceSettings) {
  writable(access); const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("price_settings_save", { target_organization_id: organization(access), target_iva: input.iva, target_margin: input.margin, target_margin_by_category: input.marginByCategory, target_fx_by_period: input.fxByPeriod, target_price_rule: input.priceRule });
  if (error) fail(error, "PRICE_ITEM_NOT_FOUND"); return data;
}

export async function importPrices(access: OperationsAccessContext, payload: { suppliers: string[]; items: unknown[]; fxByPeriod: Record<string, number> }) {
  writable(access); const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("price_import", { target_organization_id: organization(access), payload });
  if (error) throw new Error("SOLAR_STORAGE_UNAVAILABLE"); return data as { suppliers: number; items: number };
}

/* ---------- proyectos ---------- */
const projectItemSchema = z.object({ itemId: z.uuid().nullable().optional(), description: z.string().min(1).max(200), unit: z.string().max(20).optional(), quantity: z.number().min(0), supplierId: z.uuid().nullable().optional(), unitCost: z.number().min(0), currency: z.enum(["MXN", "USD"]).optional(), fx: z.number().positive().nullable().optional(), sort: z.number().int().optional(), purchased: z.boolean().optional() });
export const projectSchema = z.object({
  id: z.uuid().nullable().optional(), name: z.string().min(1).max(200), customer: z.string().max(200).nullable().optional(), quoteId: z.uuid().nullable().optional(),
  status: z.enum(["COTIZADO", "APROBADO", "EN_COMPRA", "INSTALADO", "CERRADO", "CANCELADO"]).optional(), notes: z.string().max(2000).nullable().optional(), items: z.array(projectItemSchema).max(500).nullable().optional(),
});
const normalizeProject = (p: SolarProject): SolarProject => ({ ...p, items: (p.items ?? []).map((i) => ({ ...i, quantity: Number(i.quantity), unitCost: Number(i.unitCost), fx: i.fx == null ? null : Number(i.fx) })) });

export async function listProjects(access: OperationsAccessContext): Promise<SolarProject[]> {
  if (access.evidenceClass !== "live" || !access.organizationId) return [];
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("solar_projects_list", { target_organization_id: access.organizationId });
  if (error) throw new Error("SOLAR_STORAGE_UNAVAILABLE"); return ((data ?? []) as SolarProject[]).map(normalizeProject);
}
export async function getProject(access: OperationsAccessContext, id: string): Promise<SolarProject> {
  if (!z.uuid().safeParse(id).success) throw new Error("SOLAR_PROJECT_NOT_FOUND");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("solar_project_get", { target_organization_id: organization(access), target_id: id });
  if (error) fail(error, "SOLAR_PROJECT_NOT_FOUND"); return normalizeProject(data as SolarProject);
}
export async function saveProject(access: OperationsAccessContext, input: z.infer<typeof projectSchema>): Promise<SolarProject> {
  writable(access); const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("solar_project_save", { target_organization_id: organization(access), target_id: input.id ?? null, target_name: input.name, target_customer: input.customer ?? null, target_quote_id: input.quoteId ?? null, target_status: input.status ?? null, target_notes: input.notes ?? null, target_items: input.items ?? null });
  if (error) fail(error, /QUOTE/u.test(error.message) ? "SOLAR_QUOTE_NOT_FOUND" : "SOLAR_PROJECT_NOT_FOUND"); return normalizeProject(data as SolarProject);
}
export async function deleteProject(access: OperationsAccessContext, id: string) {
  writable(access); const client = await createSupabaseServerClient();
  const { error } = await client.rpc("solar_project_delete", { target_organization_id: organization(access), target_id: id });
  if (error) fail(error, "SOLAR_PROJECT_NOT_FOUND"); return { deleted: true };
}
