#!/usr/bin/env node
/**
 * Siembra el catálogo de SunOne en el hub: tipos, productos, fotos y fichas técnicas.
 *
 * Corre fuera de la app, con la llave service_role (salta RLS; las RPC exigen auth.uid() y por
 * eso aquí se escribe directo a las tablas y al bucket). Idempotente: identifica cada producto
 * por tipo + nombre + código y solo sube archivos que falten o que se pidan con --refresh.
 *
 * Uso:
 *   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... ORG_ID=... \
 *   node tools/productos/seed-sunone.mjs --manifest data/productos/sunone-2026-09-21.json \
 *     --files "/ruta/a/📋 Documentación/[2026-09-21] Productos" [--dry-run] [--refresh]
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, extname } from "node:path";

const arg = (name, fallback = null) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const flag = (name) => process.argv.includes(name);
const URL_BASE = process.env.SUPABASE_URL?.replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORG = process.env.ORG_ID;
const manifestPath = arg("--manifest"); const filesDir = arg("--files"); const dryRun = flag("--dry-run"); const refresh = flag("--refresh");
if (!URL_BASE || !KEY || !ORG || !manifestPath || !filesDir) { console.error("Faltan SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ORG_ID, --manifest o --files"); process.exit(2); }

const BUCKET = "ennco-productos";
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const MIME = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

async function rest(path, init = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { ...init, headers: { ...headers, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
async function upload(path, file) {
  const body = readFileSync(file);
  const res = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${encodeURI(path)}`, { method: "POST", headers: { ...headers, "Content-Type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream", "x-upsert": "true" }, body });
  if (!res.ok) throw new Error(`upload ${path} → ${res.status} ${(await res.text()).slice(0, 200)}`);
}

const DEFAULT_CATEGORIES = [
  ["modulo-fotovoltaico", "Módulo fotovoltaico", "module", "panel", "por_unidad", 10], ["inversor", "Inversor", "inverter", "inverter", "por_unidad", 20],
  ["microinversor", "Microinversor", "microinverter", "inverter", "por_unidad", 30], ["accesorio", "Accesorio", "accessory", "box", "por_unidad", 40],
  ["estructura", "Estructura", "structure", "structure", "por_panel", 50], ["mano-de-obra", "Mano de obra", "labor", "wrench", "por_panel", 60],
  ["adicional", "Adicional", "additional", "list-plus", null, 70], ["baterias", "Baterías", "battery", "battery", "por_unidad", 80],
  ["controladores", "Controladores", "controller", "controller", "por_unidad", 90], ["inversores-off-grid", "Inversores Off-grid", "offgrid_inverter", "inverter", "por_unidad", 100],
];

const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8"));
console.log(`${manifest.products.length} productos en el manifiesto · ${dryRun ? "SIMULACIÓN" : "escritura real"}`);

// 1. Tipos
const existingCats = await rest(`ennco_product_categories?organization_id=eq.${ORG}&select=id,slug`);
const catBySlug = new Map(existingCats.map((c) => [c.slug, c.id]));
for (const [slug, name, kind, icon, unit, sort] of DEFAULT_CATEGORIES) {
  if (catBySlug.has(slug)) continue;
  if (dryRun) { console.log(`+ tipo ${slug}`); catBySlug.set(slug, `dry-${slug}`); continue; }
  const [row] = await rest("ennco_product_categories", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ organization_id: ORG, slug, name, kind, icon, default_unit_basis: unit, sort }) });
  catBySlug.set(slug, row.id); console.log(`+ tipo ${slug}`);
}

// 2. Productos
const existing = await rest(`ennco_products?organization_id=eq.${ORG}&select=id,category_id,name,code,photo_path,datasheet_path,sort`);
const keyOf = (categoryId, name, code) => `${categoryId}|${name.trim().toLowerCase()}|${(code ?? "").trim().toLowerCase()}`;
const byKey = new Map(existing.map((p) => [keyOf(p.category_id, p.name, p.code), p]));
let created = 0, updated = 0, uploaded = 0, missing = 0;
for (const [index, item] of manifest.products.entries()) {
  const categoryId = catBySlug.get(item.category);
  if (!categoryId) throw new Error(`tipo desconocido: ${item.category}`);
  const row = {
    organization_id: ORG, category_id: categoryId, name: item.name, brand: item.brand ?? null, code: item.code ?? null, description: item.description ?? null,
    currency: item.currency, pricing_mode: item.pricingMode ?? "unit", unit_basis: item.unitBasis ?? null, base_price: item.basePrice, utility_pct: item.utilityPct ?? null,
    tiers: item.tiers ?? [], rating: item.rating ?? null, rating_unit: item.ratingUnit ?? null, favorite: Boolean(item.favorite), source: "sunone", sort: (index + 1) * 10,
  };
  let product = byKey.get(keyOf(categoryId, item.name, item.code));
  if (dryRun) { console.log(`${product ? "=" : "+"} ${item.name} (${item.code ?? "sin código"})`); continue; }
  if (product) {
    await rest(`ennco_products?id=eq.${product.id}`, { method: "PATCH", body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }) }); updated++;
  } else {
    [product] = await rest("ennco_products", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) }); created++;
  }
  for (const [kind, field, base] of [["photo", "photo_path", "foto"], ["datasheet", "datasheet_path", "ficha"]]) {
    const rel = item[kind]; if (!rel) continue;
    const file = resolve(filesDir, rel);
    if (!existsSync(file)) { console.warn(`  ! falta archivo: ${rel}`); missing++; continue; }
    if (product[field] && !refresh) continue;
    const path = `${ORG}/${product.id}/${base}${extname(file).toLowerCase() === ".jpeg" ? ".jpg" : extname(file).toLowerCase()}`;
    await upload(path, file);
    await rest(`ennco_products?id=eq.${product.id}`, { method: "PATCH", body: JSON.stringify({ [field]: path }) });
    uploaded++; console.log(`  ↑ ${kind} ${(statSync(file).size / 1024).toFixed(0)} KB → ${path}`);
  }
}
console.log(`listo · creados ${created} · actualizados ${updated} · archivos subidos ${uploaded} · archivos faltantes ${missing}`);
