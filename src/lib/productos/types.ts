/* Productos: el catálogo de SunOne dentro del hub. Tipos compartidos entre la base, la API y la pantalla. */

export const PRODUCT_KINDS = ["module", "inverter", "microinverter", "accessory", "structure", "labor", "additional", "battery", "controller", "offgrid_inverter", "other"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

/** Tipos que se cotizan como equipo: llevan ficha eléctrica, potencia y el bloque "Precio y utilidad". */
export const EQUIPMENT_KINDS: readonly ProductKind[] = ["module", "inverter", "microinverter", "battery", "controller", "offgrid_inverter"];

export type Currency = "USD" | "MXN";
export type PricingMode = "unit" | "range";
export type UnitBasis = "por_unidad" | "por_panel";

export type ProductCategory = {
  id: string; slug: string; name: string; kind: ProductKind; icon: string;
  defaultUnitBasis: UnitBasis | null; sort: number; active: boolean;
};

export type PriceTier = { minQty: number; maxQty: number | null; price: number };

export type Product = {
  id: string; categoryId: string; name: string; brand: string | null; code: string | null; description: string | null;
  currency: Currency; pricingMode: PricingMode; unitBasis: UnitBasis | null;
  basePrice: number; utilityPct: number | null; finalPrice: number; tiers: PriceTier[];
  rating: number | null; ratingUnit: "W" | "kW" | null;
  photoPath: string | null; datasheetPath: string | null;
  /** URLs firmadas de lectura, vigentes una hora; las calcula el servidor al leer. */
  photoUrl?: string | null; datasheetUrl?: string | null;
  favorite: boolean; source: string; hasSpecs: boolean; specs: Record<string, unknown> | null;
  active: boolean; sort: number; createdAt: string; updatedAt: string;
};

export type ProductCatalog = { categories: ProductCategory[]; products: Product[] };

export const isEquipmentKind = (kind: ProductKind) => EQUIPMENT_KINDS.includes(kind);

/** Precio final = precio base + utilidad sobre costo. Mismo cálculo que la base (columna generada). */
export function finalPrice(basePrice: number, utilityPct: number | null | undefined): number {
  return Math.round(basePrice * (1 + (utilityPct ?? 0) / 100) * 10000) / 10000;
}

export const UNIT_BASIS_LABEL: Record<UnitBasis, string> = { por_unidad: "Por unidad", por_panel: "Por panel" };
export const PRICING_MODE_LABEL: Record<PricingMode, string> = { unit: "Por unidad", range: "Por rango" };
