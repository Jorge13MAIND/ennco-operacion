import { factorK as lookupFactorK, findCity, findModule } from "@/lib/solar/catalog";
import { effectivePeriod } from "@/lib/solar/defaults";
import { sum } from "@/lib/solar/math";
import type { GenerationResult, OrientationGeneration, QuoteInput, SolarCatalog } from "@/lib/solar/types";

/**
 * Gen_Energía: energía mensual por módulo = P/1000 × G × K × días × PR × margen × (1 − Poi1 − Poi2),
 * por orientación (hasta 4), sumada al mes calendario. El consumo se alinea al mes calendario a partir
 * del mes del último recibo (Inf_Apoyo!C6:C17) y, en bimestral, la generación del periodo suma el mes
 * facturado con el anterior (P49:P60).
 */
export function computeGeneration(input: QuoteInput, catalog: SolarCatalog): GenerationResult {
  const city = findCity(catalog, input.city);
  const panel = findModule(catalog, input.moduleModel);
  if (!city) throw new Error(`SOLAR_CITY_NOT_FOUND: ${input.city}`);
  if (!panel) throw new Error(`SOLAR_MODULE_NOT_FOUND: ${input.moduleModel}`);
  const defaults = catalog.generation[input.segment];
  const parameters = {
    performanceRatio: input.generation?.performanceRatio ?? defaults.performanceRatio,
    safetyMargin: input.generation?.safetyMargin ?? defaults.safetyMargin ?? catalog.generation.RESIDENTIAL.safetyMargin ?? 0.93,
    loss1: input.generation?.loss1 ?? defaults.loss1,
    loss2: input.generation?.loss2 ?? defaults.loss2,
  };
  const latitude = city.latitude ?? 0;
  const irradiance = city.irradiance.map((v) => v ?? 0);
  const days = defaults.daysPerMonth;
  const warnings: string[] = [];
  const period = effectivePeriod(input);
  const orientations: OrientationGeneration[] = input.orientations.slice(0, 4).map((o, index) => {
    // Energía por módulo siempre con la potencia del módulo (el libro la anula sin módulos; aquí sirve para dimensionar desde cero).
    const powerW = panel.pmaxW;
    const k = lookupFactorK(catalog, latitude, o.inclination);
    if (o.modules > 0 && k.every((v) => v === 0)) warnings.push(`Orientación ${index + 1}: no hay Factor K para latitud ${latitude}° e inclinación ${o.inclination}° (usa múltiplos de 5° entre 0 y 90); la generación de esa orientación es 0.`);
    const energyPerModule = irradiance.map((g, i) => (powerW / 1000) * g * (k[i] ?? 0) * (days[i] ?? 0) * parameters.performanceRatio * parameters.safetyMargin * (1 - parameters.loss1 - parameters.loss2));
    const energy = energyPerModule.map((e) => o.modules * e);
    return { modules: o.modules, inclination: o.inclination, azimuth: o.azimuth, powerW, irradiance, factorK: k, days, energyPerModule, energy, annual: sum(energy) };
  });
  while (orientations.length < 4) orientations.push({ modules: 0, inclination: 0, azimuth: 0, powerW: 0, irradiance, factorK: Array(12).fill(0), days, energyPerModule: Array(12).fill(0), energy: Array(12).fill(0), annual: 0 });
  const monthly = Array.from({ length: 12 }, (_, i) => sum(orientations.map((o) => o.energy[i] ?? 0)));
  const latest = Math.min(12, Math.max(1, Math.round(input.billedMonth || 12)));
  // S{r} = INDEX(F27:F38, MOD(latest - mes, 12) + 1): consumo del mes calendario m.
  const consumptionByMonth = Array.from({ length: 12 }, (_, i) => input.consumptionKwh[(((latest - (i + 1)) % 12) + 12) % 12] ?? 0);
  if (period === "Bimestral") {
    const billed = input.consumptionKwh.filter((v) => v !== 0).length;
    if (billed > 6) warnings.push(`Periodo bimestral con ${billed} renglones de consumo: el libro espera 6 recibos con ceros en los meses intermedios; la generación se está contando de más.`);
    if ((input.consumptionKwh[0] ?? 0) === 0 && billed > 0) warnings.push("El primer renglón del historial debe ser el último recibo (distinto de cero); si empieza en cero, los periodos facturados quedan desalineados.");
  }
  const periodGeneration = monthly.map((v, i) => {
    if (period !== "Bimestral") return v;
    if (consumptionByMonth[i] === 0) return 0;
    return v + (monthly[(i + 11) % 12] ?? 0);
  });
  const annual = sum(monthly);
  const annualConsumption = sum(input.consumptionKwh);
  return {
    latitude, latestMonth: latest, orientations, monthly, consumptionByMonth, periodGeneration, annual, annualConsumption,
    coverageCapped: annualConsumption > 0 ? Math.min(1, annual / annualConsumption) : 0, warnings, parameters,
  };
}
