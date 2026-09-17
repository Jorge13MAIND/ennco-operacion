export type Currency = "MXN" | "USD";
export type PriceRule = "MAX" | "MIN" | "AVG";
export type Supplier = { id: string; name: string; active: boolean };
export type EquipmentLink = { kind: "module" | "inverter"; model: string } | null;
export type PriceItem = { id: string; category: string; name: string; unit: string; currency: Currency; equipment: EquipmentLink; sort: number; active: boolean; notes: string | null };
/** period = primer dia del mes, ISO yyyy-mm-dd. */
export type PriceQuote = { itemId: string; supplierId: string; period: string; unitPrice: number };
export type PriceSettings = { iva: number; margin: number; marginByCategory: Record<string, number>; fxByPeriod: Record<string, number>; priceRule: PriceRule };
export type PriceCatalog = { suppliers: Supplier[]; items: PriceItem[]; quotes: PriceQuote[]; settings: PriceSettings };

export type ProjectStatus = "COTIZADO" | "APROBADO" | "EN_COMPRA" | "INSTALADO" | "CERRADO" | "CANCELADO";
export type ProjectItem = { id?: string; itemId: string | null; description: string; unit: string; quantity: number; supplierId: string | null; unitCost: number; currency: Currency; fx: number | null; sort: number; purchased: boolean };
export type SolarProject = { id: string; name: string; customer: string | null; quoteId: string | null; status: ProjectStatus; notes: string | null; createdAt: string; updatedAt: string; items: ProjectItem[] };

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = { COTIZADO: "Cotizado", APROBADO: "Aprobado", EN_COMPRA: "En compra", INSTALADO: "Instalado", CERRADO: "Cerrado", CANCELADO: "Cancelado" };
export const EQUIPMENT_CATEGORY = "Equipos FV";
