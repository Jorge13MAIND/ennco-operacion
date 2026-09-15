import type { DacRow, LowVoltageTariffRow, MediumVoltageTariffRow, ResidentialTariffRow, SolarCatalog, SolarCity, SolarInverter, SolarModule } from "@/lib/solar/types";

/** Búsquedas sobre un catálogo ya resuelto (libro o versiones aprobadas). Sin datos embebidos: apto para el navegador. */
const norm = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

export function findModule(catalog: SolarCatalog, model: string): SolarModule | null {
  return catalog.modules.find((m) => norm(m.model) === norm(model)) ?? null;
}
export function findInverter(catalog: SolarCatalog, model: string): SolarInverter | null {
  return catalog.inverters.find((m) => norm(m.model) === norm(model)) ?? null;
}
export function findCity(catalog: SolarCatalog, city: string): SolarCity | null {
  return catalog.cities.find((c) => norm(c.city) === norm(city)) ?? null;
}
/** SUMIF sobre las banderas de Inf_Factor_K: si la latitud o la inclinación no están en la tabla, el factor es 0. */
export function factorK(catalog: SolarCatalog, latitude: number, inclination: number): number[] {
  const table = catalog.factorK[String(Math.round(latitude))]?.[String(Math.round(inclination))];
  return Array.from({ length: 12 }, (_, i) => table?.[i] ?? 0);
}
export function residentialTariff(catalog: SolarCatalog, tariff: string): ResidentialTariffRow | null {
  const key = norm(tariff).replace(/\.0$/u, "");
  return catalog.tariffs.residential.find((r) => norm(r.tariff) === key) ?? null;
}
export function dacRow(catalog: SolarCatalog, region: string | null): DacRow | null {
  return catalog.tariffs.dac.find((r) => norm(r.region) === norm(region)) ?? null;
}
export function lowVoltageTariff(catalog: SolarCatalog, tariff: string, zone: string | null): LowVoltageTariffRow | null {
  return catalog.tariffs.lowVoltage.find((r) => norm(r.tariff) === norm(tariff) && norm(r.zone) === norm(zone)) ?? null;
}
export function mediumVoltageTariff(catalog: SolarCatalog, tariff: string, zone: string | null): MediumVoltageTariffRow | null {
  return catalog.tariffs.mediumVoltage.find((r) => norm(r.tariff) === norm(tariff) && norm(r.zone) === norm(zone)) ?? null;
}
export function loadFactor(catalog: SolarCatalog, tariff: string): number {
  const entry = Object.entries(catalog.tariffs.loadFactor).find(([k]) => norm(k) === norm(tariff));
  return entry ? entry[1] : 0;
}
/** Inf_Irrad_Sol!U: irradiancia de diseño en W/m² = promedio anual × 0.97 / 6 × 1000. */
export function cityIrradianceWm2(city: SolarCity): number {
  const values = city.irradiance.map((v) => v ?? 0);
  const average = values.reduce((a, b) => a + b, 0) / values.length;
  return (average * 0.97) / 6 * 1000;
}
/** Inf_Módulos!S / R: temperatura de celda máxima y mínima para una ciudad. */
export function cellTemperatures(city: SolarCity, toncC: number): { max: number; min: number } {
  const u = cityIrradianceWm2(city);
  return { max: ((toncC + 20) * (u + (city.tMaxC ?? 0))) / 800, min: (city.tMinC ?? 0) - ((toncC - 20) * u) / 1600 };
}
export const MONTH_NAMES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
export const MEDIUM_VOLTAGE_TARIFFS = ["GDMTO", "GDMTH", "DIST", "DIT"];
