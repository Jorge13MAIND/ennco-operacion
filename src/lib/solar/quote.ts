import { cellTemperatures, findCity, findInverter, findModule } from "@/lib/solar/catalog";
import { computeGeneration } from "@/lib/solar/generation";
import { excelInt, excelRoundUp, safeDiv, sum } from "@/lib/solar/math";
import { computeProjection } from "@/lib/solar/projection";
import { computeBill } from "@/lib/solar/tariffs";
import type { BomLine, PricingResult, QuoteInput, QuoteResult, SolarCatalog } from "@/lib/solar/types";

export const DEMAND_WARNING = "El sistema fotovoltaico es más grande que la demanda contratada, por lo que será necesario solicitar un aumento de carga por lo menos a la misma capacidad del sistema fotovoltaico; o reducir la capacidad del sistema a la misma capacidad de la demanda contratada.";

/**
 * Inf_Vac_* + Precios_SFV + Inf_Apoyo en una sola pasada. Es la función que la pantalla llama al
 * cambiar cualquier entrada; todo lo demás (tablas del recibo, meses de generación, BOM) viene dentro.
 */
export function computeQuote(input: QuoteInput, catalog: SolarCatalog): QuoteResult {
  const panel = findModule(catalog, input.moduleModel);
  const city = findCity(catalog, input.city);
  if (!panel) throw new Error(`SOLAR_MODULE_NOT_FOUND: ${input.moduleModel}`);
  if (!city) throw new Error(`SOLAR_CITY_NOT_FOUND: ${input.city}`);
  const rates = catalog.tariffs.rates;
  const generation = computeGeneration(input, catalog);
  const modulePowerW = panel.pmaxW;
  const modulesTotal = sum(input.orientations.map((o) => o.modules));
  const systemKw = (modulesTotal * modulePowerW) / 1000;
  const annualGeneration = generation.annual;
  const annualConsumption = generation.annualConsumption;
  // L44 = ROUNDUP(consumo / (generación / módulos)); sin módulos se usa la energía por módulo de la orientación 1.
  const perModule = modulesTotal > 0 ? annualGeneration / modulesTotal : sum(generation.orientations[0]?.energyPerModule ?? []);
  const modulesNeeded = perModule > 0 ? excelRoundUp(annualConsumption / perModule, 0) : 0;
  // Inf_Módulos!W: Vmp a la temperatura máxima de celda de la ciudad (el libro usaba la ciudad de la captura residencial para los tres segmentos).
  const temps = cellTemperatures(city, panel.toncC);
  const vmpHot = panel.vmpV * (1 + panel.coefV * (temps.max - 25));
  const warnings = [...generation.warnings];
  const inverters = input.inverters.filter((s) => s.model).map((s) => {
    const inverter = findInverter(catalog, s.model);
    if (!inverter) warnings.push(`Inversor "${s.model}" no está en el catálogo: no se dimensiona ni se cotiza.`);
    const minModules = inverter && inverter.startUpV != null && vmpHot > 0 ? excelRoundUp(inverter.startUpV / vmpHot, 0) * s.quantity : 0;
    const maxModules = inverter ? excelInt(inverter.pmaxFvW / modulePowerW) * s.quantity : 0;
    return { model: s.model, quantity: s.quantity, minModules, maxModules, modules: 0, systemKw: 0, inverter };
  });
  const firstInverter = inverters[0];
  if (firstInverter) { firstInverter.modules = modulesTotal; firstInverter.systemKw = systemKw; }
  const demandWarning = input.segment !== "RESIDENTIAL" && input.contractedDemandKw != null && systemKw > input.contractedDemandKw ? DEMAND_WARNING : null;
  const bill = computeBill(input, generation, catalog);
  warnings.push(...bill.warnings);
  const pricing = computePricing(input, catalog, panel, modulesTotal, systemKw);
  const cashPrice = pricing.cashPrice;
  const deduction = input.taxDeduction ? (cashPrice / (1 + rates.iva)) * rates.incomeTaxDeduction : 0;
  const projection = computeProjection({
    cost: cashPrice, deduction, annualConsumption, annualGeneration, paymentWithout: bill.annualWithout, paymentWith: bill.annualWith,
    annualIncrease: input.annualIncrease, degradation: input.degradation,
  });
  const kwh0 = input.consumptionKwh[0] ?? 0;
  const powerFactor = input.segment === "INDUSTRIAL" && (input.kvarh ?? 0) > 0 ? Math.round((kwh0 / Math.sqrt(kwh0 ** 2 + (input.kvarh ?? 0) ** 2)) * 10000) / 100 : null;
  return {
    input, module: panel, city,
    averageConsumption: annualConsumption / 12, annualConsumption, annualGeneration, coverage: safeDiv(annualGeneration, annualConsumption, 0),
    modulePowerW, modulesNeeded, systemNeededKw: (modulesNeeded * modulePowerW) / 1000,
    inverters, modulesTotal, systemKw, demandWarning, generation, bill, pricing, projection, powerFactor, warnings,
  };
}

/** Precios_SFV (BOM con utilidad × tipo de cambio → precio sugerido por watt) e Inf_Vac_*!F105 (precio de contado). */
export function computePricing(input: QuoteInput, catalog: SolarCatalog, module: { brand: string; pmaxW: number; priceUsd: number | null }, modulesTotal: number, systemKw: number): PricingResult {
  const rates = catalog.tariffs.rates;
  const seg = catalog.prices[input.segment];
  const u = input.utilityFactor;
  // Corrección 18: el libro solo cotizaba el primer inversor (Precios_SFV toma C58); aquí entran todos los capturados.
  const inverterLines: BomLine[] = input.inverters.filter((sel) => sel.model && sel.quantity > 0).map((sel) => {
    const inv = findInverter(catalog, sel.model);
    return { concept: "Inversor", brand: inv?.brand ?? null, powerW: inv?.nominalW ?? null, quantity: sel.quantity, unitUsd: inv?.priceUsd ?? 0, totalUsd: (inv?.priceUsd ?? 0) * sel.quantity * (1 + u) };
  });
  const bom: BomLine[] = [
    { concept: "Módulo solar", brand: module.brand, powerW: module.pmaxW, quantity: modulesTotal, unitUsd: module.priceUsd ?? 0, totalUsd: modulesTotal * (module.priceUsd ?? 0) * (1 + u) },
    ...(inverterLines.length > 0 ? inverterLines : [{ concept: "Inversor", brand: null, powerW: null, quantity: 0, unitUsd: 0, totalUsd: 0 }]),
    { concept: "Estructura", brand: null, powerW: null, quantity: modulesTotal, unitUsd: seg.structureUsdPerModule, totalUsd: modulesTotal * seg.structureUsdPerModule * (1 + u) },
    { concept: "Mano de obra", brand: null, powerW: null, quantity: modulesTotal, unitUsd: seg.laborUsdPerModule, totalUsd: modulesTotal * seg.laborUsdPerModule * (1 + u) },
  ];
  const bomTotalUsd = sum(bom.map((l) => l.totalUsd));
  const bomTotalMxn = bomTotalUsd * input.exchangeRate;
  const watts = systemKw * 1000;
  const suggestedPricePerWatt = safeDiv(bomTotalMxn, watts, 0);
  const servicesUsd = sum(input.services.map((s) => (s.enabled ? safeDiv(s.costMxn, input.exchangeRate, 0) : 0)));
  const servicesMxn = servicesUsd * input.exchangeRate;
  const cashPrice = (watts * input.pricePerWatt * (1 - input.discount) + servicesMxn) * (input.addIva ? 1 + rates.iva : 1);
  const advances = input.advances.map((pct) => cashPrice * pct);
  const base = input.financingBase === 0 ? cashPrice : input.financingBase;
  const financing = input.financing.map((f) => {
    const amount = f.months === 0 ? 0 : base * f.share;
    return { amount, months: f.months, monthly: safeDiv(amount, f.months, 0) };
  });
  return { bom, bomTotalUsd, bomTotalMxn, suggestedPricePerWatt, discountVsSuggested: safeDiv(input.pricePerWatt, suggestedPricePerWatt, 1) - 1, servicesUsd, servicesMxn, cashPrice, advances, financing };
}
