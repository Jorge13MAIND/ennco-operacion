import "server-only";
import { z } from "zod";

import type { OperationsAccessContext } from "@/lib/auth/authorization";
import { PRODUCT_KINDS, type Product, type ProductCatalog } from "@/lib/productos/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/* Acceso a productos: solo por RPC con guarda de membresía; archivos en el bucket privado
   ennco-productos con URL firmada de una hora. El rol de solo lectura no escribe. */

export const PRODUCTS_BUCKET = "ennco-productos";
const SIGNED_URL_TTL = 60 * 60;

function organization(access: OperationsAccessContext): string {
  if (access.evidenceClass !== "live" || !access.organizationId) throw new Error("SOLAR_STORAGE_UNAVAILABLE");
  return access.organizationId;
}
function writable(access: OperationsAccessContext) { if (access.role === "auditor_readonly") throw new Error("SOLAR_FORBIDDEN"); }
function fail(error: { message: string }): never {
  const known = error.message.match(/PRODUCT_[A-Z_]+|DIRECT_LANE_MEMBER_REQUIRED/u)?.[0];
  throw new Error(known ?? "SOLAR_STORAGE_UNAVAILABLE");
}
const EMPTY: ProductCatalog = { categories: [], products: [] };

function numeric(value: unknown): number { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function normalizeProduct(raw: Record<string, unknown>): Product {
  const p = raw as unknown as Product;
  return { ...p, basePrice: numeric(p.basePrice), finalPrice: numeric(p.finalPrice), utilityPct: p.utilityPct == null ? null : numeric(p.utilityPct), rating: p.rating == null ? null : numeric(p.rating), tiers: Array.isArray(p.tiers) ? p.tiers : [] };
}

export async function readProductCatalog(access: OperationsAccessContext): Promise<ProductCatalog> {
  if (access.evidenceClass !== "live" || !access.organizationId) return EMPTY;
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("product_catalog_read", { target_organization_id: access.organizationId });
  if (error) fail(error);
  const catalog = data as { categories: ProductCatalog["categories"]; products: Record<string, unknown>[] };
  const products = catalog.products.map(normalizeProduct);
  // URLs firmadas en lote: una llamada para todas las fotos y otra para todas las fichas.
  const paths = [...new Set(products.flatMap((p) => [p.photoPath, p.datasheetPath]).filter((x): x is string => Boolean(x)))];
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await client.storage.from(PRODUCTS_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  return {
    categories: catalog.categories,
    products: products.map((p) => ({ ...p, photoUrl: p.photoPath ? urls.get(p.photoPath) ?? null : null, datasheetUrl: p.datasheetPath ? urls.get(p.datasheetPath) ?? null : null })),
  };
}

export const categorySchema = z.object({
  id: z.uuid().nullable().optional(),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/u).optional(),
  name: z.string().trim().min(1).max(60),
  kind: z.enum(PRODUCT_KINDS).optional(),
  icon: z.string().max(40).optional(),
  defaultUnitBasis: z.enum(["por_unidad", "por_panel"]).nullable().optional(),
  sort: z.number().int().min(0).max(10_000).optional(),
  active: z.boolean().optional(),
});
export function slugify(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 40) || "tipo";
}
export async function saveCategory(access: OperationsAccessContext, input: z.infer<typeof categorySchema>) {
  writable(access); const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("product_category_save", {
    target_organization_id: organization(access), target_id: input.id ?? null, target_slug: input.slug ?? slugify(input.name), target_name: input.name,
    target_kind: input.kind ?? "other", target_icon: input.icon ?? "box", target_default_unit_basis: input.defaultUnitBasis ?? null, target_sort: input.sort ?? null, target_active: input.active ?? true,
  });
  if (error) fail(error); return data;
}
export async function seedDefaultCategories(access: OperationsAccessContext) {
  writable(access); const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("product_categories_seed_defaults", { target_organization_id: organization(access) });
  if (error) fail(error); return data;
}

export const tierSchema = z.object({ minQty: z.number().min(0), maxQty: z.number().min(0).nullable(), price: z.number().min(0) });
export const productSchema = z.object({
  id: z.uuid().nullable().optional(),
  categoryId: z.uuid(),
  name: z.string().trim().min(1).max(160),
  brand: z.string().max(80).nullable().optional(),
  code: z.string().max(80).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  currency: z.enum(["USD", "MXN"]),
  pricingMode: z.enum(["unit", "range"]).optional(),
  unitBasis: z.enum(["por_unidad", "por_panel"]).nullable().optional(),
  basePrice: z.number().min(0),
  utilityPct: z.number().min(0).max(1000).nullable().optional(),
  tiers: z.array(tierSchema).max(20).optional(),
  rating: z.number().min(0).nullable().optional(),
  ratingUnit: z.enum(["W", "kW"]).nullable().optional(),
  favorite: z.boolean().optional(),
  specs: z.record(z.string(), z.unknown()).nullable().optional(),
});
export async function saveProduct(access: OperationsAccessContext, input: z.infer<typeof productSchema>) {
  writable(access); const client = await createSupabaseServerClient();
  const { id, ...payload } = input;
  const { data, error } = await client.rpc("product_save", { target_organization_id: organization(access), target_id: id ?? null, payload });
  if (error) fail(error); return normalizeProduct(data as Record<string, unknown>);
}
export async function setProductActive(access: OperationsAccessContext, id: string, active: boolean) {
  writable(access); const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("product_set_active", { target_organization_id: organization(access), target_id: id, target_active: active });
  if (error) fail(error); return data;
}
export async function setProductFavorite(access: OperationsAccessContext, id: string, favorite: boolean) {
  writable(access); const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("product_set_favorite", { target_organization_id: organization(access), target_id: id, target_favorite: favorite });
  if (error) fail(error); return data;
}

const FILE_RULES = {
  photo: { mimes: ["image/png", "image/jpeg", "image/webp"], maxBytes: 5 * 1024 * 1024, ext: { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as Record<string, string>, name: "foto" },
  datasheet: { mimes: ["application/pdf"], maxBytes: 10 * 1024 * 1024, ext: { "application/pdf": "pdf" } as Record<string, string>, name: "ficha" },
} as const;

/** Sube la foto o la ficha al bucket y la liga al producto. Las reglas son las de SunOne: PNG/JPG/WebP hasta 5 MB, PDF hasta 10 MB. */
export async function uploadProductFile(access: OperationsAccessContext, id: string, kind: "photo" | "datasheet", file: File) {
  writable(access); const org = organization(access);
  const rule = FILE_RULES[kind];
  if (!(rule.mimes as readonly string[]).includes(file.type)) throw new Error("PRODUCT_FILE_TYPE_INVALID");
  if (file.size > rule.maxBytes) throw new Error("PRODUCT_FILE_TOO_LARGE");
  const client = await createSupabaseServerClient();
  const path = `${org}/${id}/${rule.name}.${rule.ext[file.type]}`;
  const { error: uploadError } = await client.storage.from(PRODUCTS_BUCKET).upload(path, file, { contentType: file.type, upsert: true });
  if (uploadError) throw new Error("PRODUCT_FILE_UPLOAD_FAILED");
  const { data, error } = await client.rpc("product_set_file", { target_organization_id: org, target_id: id, target_kind: kind, target_path: path });
  if (error) fail(error); return data;
}

export async function signedProductUrl(access: OperationsAccessContext, path: string): Promise<string> {
  const org = organization(access);
  if (!path.startsWith(`${org}/`)) throw new Error("PRODUCT_FILE_PATH_INVALID");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.storage.from(PRODUCTS_BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  if (error || !data?.signedUrl) throw new Error("PRODUCT_NOT_FOUND");
  return data.signedUrl;
}
