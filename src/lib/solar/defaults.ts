import type { Period, QuoteInput, Segment, SolarCatalog } from "@/lib/solar/types";

/** El bloque industrial del libro es mensual siempre; comercial y residencial siguen la captura. */
export function effectivePeriod(input: Pick<QuoteInput, "segment" | "period">): Period {
  return input.segment === "INDUSTRIAL" ? "Mensual" : input.period;
}

/** Serial de Excel (días desde 1899-12-30) ↔ fecha ISO, para los campos de periodo. */
export function serialToIso(serial: number | null | undefined): string {
  if (serial == null || !Number.isFinite(serial)) return "";
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);
}
export function isoToSerial(iso: string): number | null {
  if (!iso) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round((ms - Date.UTC(1899, 11, 30)) / 86_400_000) : null;
}

export const SEGMENT_TARIFFS: Record<Segment, string[]> = {
  RESIDENTIAL: ["1", "1A", "1B", "1C", "1D", "1E", "1F", "DAC"],
  COMMERCIAL: ["PDBT", "GDBT", "APBT", "RABT"],
  INDUSTRIAL: ["GDMTO", "GDMTH", "DIST"],
};

export const DEFAULT_SERVICES = ["Gestión de Contrato de Interconexión (GE)", "Medidor Bidireccional", "", "", "", "", ""];

/** Captura vacía razonable por segmento; el ejemplo del libro se carga aparte. */
export function defaultQuoteInput(segment: Segment, catalog: SolarCatalog): QuoteInput {
  const today = new Date();
  const end = isoToSerial(today.toISOString().slice(0, 10)) ?? 45000;
  const bimonthly = segment !== "INDUSTRIAL";
  const panel = catalog.modules[0];
  const inverter = catalog.inverters.find((i) => (segment === "INDUSTRIAL" ? i.nominalW >= 50000 : segment === "COMMERCIAL" ? i.nominalW >= 5000 : i.nominalW >= 3000)) ?? catalog.inverters[0];
  return {
    segment,
    customer: { name: "", subtitle: "", supplier: "Comisión Federal de Electricidad" },
    city: catalog.cities.find((c) => c.city === "León")?.city ?? catalog.cities[0]?.city ?? "",
    period: bimonthly ? "Bimestral" : "Mensual",
    summerTariff: false,
    currentTariff: segment === "RESIDENTIAL" ? "1" : segment === "COMMERCIAL" ? "PDBT" : "GDMTH",
    baseTariff: segment === "RESIDENTIAL" ? "1" : null,
    contractedDemandKw: null,
    periodStartSerial: segment === "RESIDENTIAL" ? null : end - (bimonthly ? 60 : 30),
    periodEndSerial: segment === "RESIDENTIAL" ? null : end,
    billedMonth: today.getMonth() + 1,
    meterType: "Digital", phases: segment === "INDUSTRIAL" ? 3 : 2, voltage: segment === "INDUSTRIAL" ? 440 : 220,
    electricalConfig: segment === "INDUSTRIAL" ? "3F-4H@440/254 V 60 Hz" : "2F-3H@220/127 V 60 Hz",
    annualIncrease: 0.07,
    consumptionKwh: Array(12).fill(0),
    demandKw: segment === "INDUSTRIAL" ? Array(12).fill(0) : null,
    kwhBase: 0, kwhIntermediate: 0, kwhPeak: 0, kwhSemiPeak: 0, kwBase: 0, kwIntermediate: 0, kwPeak: 0, kwSemiPeak: 0, kvarh: 0, targetPowerFactor: 0.96,
    moduleModel: panel?.model ?? "",
    orientationCount: 1,
    orientations: [{ modules: 0, azimuth: 0, inclination: 15 }],
    mountingSystem: catalog.mounting.es[0]?.name ?? null,
    degradation: 0.0042,
    inverters: inverter ? [{ model: inverter.model, quantity: 1 }] : [],
    services: DEFAULT_SERVICES.map((concept, i) => ({ enabled: i === 0, concept, costMxn: i === 0 ? 1200 : 0 })),
    currency: "MXN", exchangeRate: 20, pricePerWatt: segment === "INDUSTRIAL" ? 16.5 : segment === "COMMERCIAL" ? 18 : 18.25,
    utilityFactor: 0.5, discount: 0, addIva: true, taxDeduction: segment !== "RESIDENTIAL",
    advances: [0.6, 0.2, 0.15, 0.05], financingBase: 0, financing: [{ share: 0, months: 0 }, { share: 0, months: 0 }, { share: 0, months: 0 }],
    language: "Español", structureWarrantyYears: 20, startTime: "2 a 3 semanas", deliveryTime: "2 a 3 semanas", validityDays: 30,
    generation: null,
  };
}
