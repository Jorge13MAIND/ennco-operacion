/* Reglas de precio del Excel de ENNCO: por material, el precio vigente de cada proveedor es su
   cotizacion mas reciente; el costo es el maximo entre proveedores (o minimo o promedio, segun el
   ajuste) y el precio final = costo x (1 + IVA) x (1 + margen), como el "$ FINAL" de la hoja. */
import type { Currency, PriceCatalog, PriceItem, PriceQuote, PriceSettings, Supplier } from "@/lib/precios/types";

export type SupplierPrice = { supplier: Supplier; unitPrice: number; period: string };
export type ItemPricing = {
  item: PriceItem;
  bySupplier: SupplierPrice[];
  /** Proveedor y precio que fija el costo segun la regla. */
  cost: number | null; costSupplier: Supplier | null; costPeriod: string | null;
  marginApplied: number;
  finalPrice: number | null;
  /** Costo y final en pesos (igual al de arriba cuando la moneda es MXN). */
  costMxn: number | null; finalMxn: number | null; fx: number | null;
};

export const periodKey = (iso: string) => iso.slice(0, 7);
export const monthStart = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;

/** Tipo de cambio para un periodo: el del mes, o el mas reciente anterior, o el mas reciente que haya. */
export function fxFor(settings: PriceSettings, period: string | null): number | null {
  const entries = Object.entries(settings.fxByPeriod).filter(([, v]) => typeof v === "number" && v > 0).sort(([a], [b]) => (a < b ? -1 : 1));
  if (!entries.length) return null;
  if (period) {
    const key = periodKey(period);
    const upTo = entries.filter(([k]) => k.slice(0, 7) <= key);
    if (upTo.length) return upTo[upTo.length - 1]![1];
  }
  return entries[entries.length - 1]![1];
}

export function marginFor(settings: PriceSettings, category: string): number {
  const m = settings.marginByCategory[category];
  return typeof m === "number" && m >= 0 ? m : settings.margin;
}

/** Precio vigente por proveedor: la cotizacion mas reciente de cada uno (opcionalmente hasta un periodo). */
export function latestBySupplier(quotes: PriceQuote[], suppliers: Supplier[], itemId: string, upTo?: string): SupplierPrice[] {
  const byId = new Map(suppliers.map((s) => [s.id, s]));
  const best = new Map<string, PriceQuote>();
  for (const q of quotes) {
    if (q.itemId !== itemId || q.unitPrice <= 0) continue;
    if (upTo && q.period > upTo) continue;
    const prev = best.get(q.supplierId);
    if (!prev || q.period > prev.period) best.set(q.supplierId, q);
  }
  return [...best.values()].map((q) => ({ supplier: byId.get(q.supplierId) ?? { id: q.supplierId, name: "?", active: true }, unitPrice: q.unitPrice, period: q.period }))
    .filter((p) => p.supplier.active !== false)
    .sort((a, b) => a.supplier.name.localeCompare(b.supplier.name, "es"));
}

export function priceItem(catalog: PriceCatalog, item: PriceItem, upTo?: string): ItemPricing {
  const { settings } = catalog;
  const bySupplier = latestBySupplier(catalog.quotes, catalog.suppliers, item.id, upTo);
  let chosen: SupplierPrice | null = null; let cost: number | null = null;
  if (bySupplier.length) {
    if (settings.priceRule === "AVG") { cost = bySupplier.reduce((a, p) => a + p.unitPrice, 0) / bySupplier.length; chosen = null; }
    else {
      chosen = bySupplier.reduce((a, p) => (settings.priceRule === "MIN" ? (p.unitPrice < a.unitPrice ? p : a) : (p.unitPrice > a.unitPrice ? p : a)));
      cost = chosen.unitPrice;
    }
  }
  const marginApplied = marginFor(settings, item.category);
  const finalPrice = cost == null ? null : cost * (1 + settings.iva) * (1 + marginApplied);
  const period = chosen?.period ?? (bySupplier.length ? bySupplier.map((p) => p.period).sort().pop()! : null);
  const fx = item.currency === "USD" ? fxFor(settings, period) : null;
  const toMxn = (v: number | null) => (v == null ? null : item.currency === "USD" ? (fx == null ? null : v * fx) : v);
  return { item, bySupplier, cost, costSupplier: chosen?.supplier ?? null, costPeriod: period, marginApplied, finalPrice, costMxn: toMxn(cost), finalMxn: toMxn(finalPrice), fx };
}

export function priceAll(catalog: PriceCatalog, upTo?: string): ItemPricing[] {
  return catalog.items.filter((i) => i.active).map((i) => priceItem(catalog, i, upTo));
}

/** Meses con al menos una cotizacion, mas reciente primero. */
export function periodsIn(catalog: PriceCatalog): string[] {
  return [...new Set(catalog.quotes.map((q) => periodKey(q.period)))].sort().reverse();
}

export const MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export function periodLabel(iso: string): string {
  const [y, m] = iso.split("-"); const i = Number(m) - 1;
  return `${(MONTHS_ES[i] ?? m)?.replace(/^./, (c) => c.toUpperCase())} ${y}`;
}
export function convert(amount: number, from: Currency, to: Currency, fx: number | null): number | null {
  if (from === to) return amount;
  if (fx == null || fx <= 0) return null;
  return from === "USD" ? amount * fx : amount / fx;
}
