import { dacRow, findCity, loadFactor, lowVoltageTariff, MEDIUM_VOLTAGE_TARIFFS, mediumVoltageTariff, residentialTariff } from "@/lib/solar/catalog";
import { effectivePeriod } from "@/lib/solar/defaults";
import { excelRound, safeDiv, sum } from "@/lib/solar/math";
import type { BillColumn, GenerationResult, QuoteInput, SolarCatalog, TariffResult } from "@/lib/solar/types";

/**
 * Cal_Tarifa_Residencial / Comercial / Industrial. Bloque "sin FV": los 12 periodos del historial, el
 * más reciente primero. Bloque "con FV": los 12 periodos siguientes proyectados restando la generación
 * del mes calendario homólogo (k = 13 − j). Incluye las correcciones documentadas en Notas_Reconstruccion:
 * arrastre solo de crédito, meses no facturados sin cargo, ventana DAC de 12 meses, PDBT por kWh.
 */

/** Índice homólogo en el bloque izquierdo (1 = más reciente) para la columna derecha j (0..11). */
export function homologousIndex(j: number): number {
  return j === 0 ? 1 : 13 - j;
}
/** Mes calendario (1..12) de la columna derecha j. */
export function projectedMonth(latest: number, j: number): number {
  return ((latest + j - 1) % 12) + 1;
}

export function computeResidentialBill(input: QuoteInput, generation: GenerationResult, catalog: SolarCatalog): TariffResult {
  const city = findCity(catalog, input.city);
  const baseCode = input.baseTariff || (input.currentTariff.toUpperCase() === "DAC" ? "1" : input.currentTariff);
  const row = residentialTariff(catalog, baseCode);
  if (!row) throw new Error(`SOLAR_TARIFF_NOT_FOUND: ${baseCode}`);
  const dac = dacRow(catalog, city?.region ?? null);
  const rates = catalog.tariffs.rates;
  const mpp = effectivePeriod(input) === "Bimestral" ? 2 : 1;
  const summer = input.summerTariff;
  const step1 = summer ? row.summerBasicStep : row.basicStep;
  const step2 = summer ? row.summerIntermediateStep : row.intermediateStep;
  const step3 = summer ? row.summerIntermediate2Step : 0;
  const price1 = summer ? row.summerBasicPrice : row.basicPrice;
  const price2 = summer ? row.summerIntermediatePrice : row.intermediatePrice;
  const price3 = summer ? row.summerIntermediate2Price : 0;
  const price4 = summer ? row.summerExcessPrice : row.excessPrice;
  const dacFixed = dac?.fixedMonthly ?? 0;
  const dacPrice = dac?.pricePerKwh ?? 0;
  const isDac = input.currentTariff.toUpperCase() === "DAC";
  const cons = input.consumptionKwh;
  const latest = generation.latestMonth;
  const P = generation.periodGeneration;

  const tiers = (kwh: number) => {
    const t1 = Math.min(kwh, step1 * mpp);
    const t2 = Math.min(Math.max(kwh - t1, 0), step2 * mpp);
    const t3 = Math.min(Math.max(kwh - t1 - t2, 0), step3 * mpp);
    const t4 = Math.max(kwh - t1 - t2 - t3, 0);
    return { t1, t2, t3, t4 };
  };
  const without: BillColumn[] = cons.map((kwh, i) => {
    const t = tiers(kwh);
    const c1 = kwh === 0 ? 0 : Math.max(t.t1, rates.residentialMinimumKwh * mpp) * price1;
    const c2 = t.t2 * price2; const c3 = t.t3 * price3; const c4 = t.t4 * price4;
    const tiered = c1 + c2 + c3 + c4;
    const dacFixedCharge = kwh === 0 ? 0 : dacFixed * mpp;
    const dacEnergy = Math.max(kwh, 0) * dacPrice;
    const dacTotal = dacFixedCharge + dacEnergy;
    const subtotal = isDac ? dacTotal : tiered;
    const iva = subtotal * rates.iva;
    const dap = (subtotal + iva) * rates.dapResidential;
    return { period: i + 1, kwh, ...t, c1, c2, c3, c4, tiered, dacFixedCharge, dacEnergy, dacTotal, tariff: isDac ? "DAC" : row.tariff, subtotal, iva, dap, total: subtotal + iva + dap };
  });
  const annualConsumption = sum(cons);
  const withPv: BillColumn[] = [];
  let prevNet = 0; let prevRolling = 0;
  for (let j = 0; j < 12; j += 1) {
    const flag = mpp === 2 ? 1 - (j % 2) : 1;
    const k = homologousIndex(j);
    const gen = P[projectedMonth(latest, j) - 1] ?? 0;
    const net = j === 0 ? (cons[0] ?? 0) - gen : (flag === 0 ? prevNet : (cons[k - 1] ?? 0) - gen + Math.min(prevNet, 0));
    const t = tiers(net);
    const c1 = flag === 0 ? 0 : Math.max(t.t1, rates.residentialMinimumKwh * mpp) * price1;
    const c2 = flag === 0 ? 0 : t.t2 * price2; const c3 = flag === 0 ? 0 : t.t3 * price3; const c4 = flag === 0 ? 0 : t.t4 * price4;
    const tiered = c1 + c2 + c3 + c4;
    const dacFixedCharge = flag === 0 ? 0 : dacFixed * mpp;
    const dacEnergy = flag === 0 ? 0 : Math.max(net, 0) * dacPrice;
    const dacTotal = dacFixedCharge + dacEnergy;
    const rolling = j === 0 ? annualConsumption - (cons[0] ?? 0) + Math.max(net, 0) : prevRolling - (flag === 0 ? 0 : (cons[k - 1] ?? 0)) + (flag === 0 ? 0 : Math.max(net, 0));
    const tariff = rolling > row.dacLimitBimonthlyKwh ? "DAC" : row.tariff;
    const subtotal = tariff === "DAC" ? dacTotal : tiered;
    const iva = subtotal * rates.iva;
    const dap = (subtotal + iva) * rates.dapResidentialWithPv;
    const projectedWithout = flag === 0 ? 0 : ((without[k - 1]?.total as number) ?? 0) * (1 + input.annualIncrease / k);
    withPv.push({ period: j + 1, month: projectedMonth(latest, j), billed: flag === 1, generation: gen, net, ...t, c1, c2, c3, c4, tiered, dacFixedCharge, dacEnergy, dacTotal, rolling12m: rolling, tariff, subtotal, iva, dap, total: subtotal + iva + dap, projectedWithout });
    prevNet = net; prevRolling = rolling;
  }
  const annualWithout = sum(without.map((c) => c.total as number));
  const annualWith = sum(withPv.map((c) => c.total as number));
  const projected = sum(withPv.map((c) => c.projectedWithout as number));
  const remainingShare = safeDiv(annualWith, projected, 0);
  return {
    tariff: input.currentTariff, zone: city?.region ?? null, monthsPerPeriod: mpp, without, with: withPv, annualWithout, annualWith,
    savingsShare: projected > 0 ? 1 - remainingShare : 0, remainingShare, warnings: dac ? [] : [`Sin tarifa DAC para la región ${city?.region ?? "?"}`],
  };
}

/** Fechas del historial (Excel serial). Comercial: cada periodo dura lo mismo que el último; industrial alterna 31/30 días. */
export function periodDates(startSerial: number | null | undefined, endSerial: number | null | undefined, monthly: boolean): { left: Array<{ start: number; end: number; days: number }>; right: Array<{ start: number; end: number; days: number }>; assumed: boolean } {
  const fallbackDays = monthly ? 31 : 59;
  let start = startSerial ?? 0;
  let end = endSerial ?? 0;
  let assumed = false;
  if (!(Number.isFinite(start) && Number.isFinite(end)) || end <= start) {
    // Sin fechas válidas se asume un periodo típico que termina en la fecha dada (o hoy).
    end = Number.isFinite(end) && end > 0 ? end : Math.round((Date.now() - Date.UTC(1899, 11, 30)) / 86_400_000);
    start = end - fallbackDays;
    assumed = true;
  }
  const left = [{ start, end, days: end - start }];
  for (let i = 1; i < 12; i += 1) {
    const prev = left[i - 1]!;
    const e = prev.start - 1;
    const s = monthly ? prev.start - (i % 2 ? 31 : 30) : e - (end - start) + 1;
    left.push({ start: s, end: e, days: e - s });
  }
  const right = [{ start, end, days: end - start }];
  for (let j = 1; j < 12; j += 1) {
    const s = right[j - 1]!.end + 1;
    const e = s + (left[j]!.end - left[j]!.start);
    right.push({ start: s, end: e, days: e - s });
  }
  return { left, right, assumed };
}

export function computeCommercialBill(input: QuoteInput, generation: GenerationResult, catalog: SolarCatalog): TariffResult {
  const city = findCity(catalog, input.city);
  const zone = city?.division ?? null;
  const tariff = input.currentTariff.toUpperCase();
  const row = lowVoltageTariff(catalog, tariff, zone);
  if (!row) throw new Error(`SOLAR_TARIFF_NOT_FOUND: ${tariff} ${zone ?? ""}`);
  const rates = catalog.tariffs.rates;
  const fc = loadFactor(catalog, tariff);
  const mpp = effectivePeriod(input) === "Bimestral" ? 2 : 1;
  // Ninguna tarifa de baja tensión es de media tensión: el cargo por medición del 2 % queda en 0 aquí, como en el libro.
  const mt = MEDIUM_VOLTAGE_TARIFFS.includes(tariff);
  const gdbt = tariff === "GDBT";
  const cons = input.consumptionKwh;
  const demand = input.demandKw ?? Array(12).fill(0);
  const dates = periodDates(input.periodStartSerial, input.periodEndSerial, false);
  const latest = generation.latestMonth;
  const P = generation.periodGeneration;
  const charges = (days: number, kwh: number, base: number, flag: boolean, fp: number) => {
    const kwfact = safeDiv(kwh, days * 24 * fc, 0);
    const fixed = flag ? row.fixed * mpp : 0;
    const distribution = gdbt ? kwfact * row.distribution : kwh * row.distribution;
    const transmission = kwh * row.transmission;
    const cenace = kwh * row.cenace;
    const energy = Math.max(base, 0) * row.energy;
    const capacity = gdbt ? kwfact * row.capacity : kwh * row.capacity;
    const mem = kwh * row.mem;
    const supply = fixed + distribution + transmission + cenace + energy + capacity + mem;
    const metering = mt ? supply * rates.lowVoltageMetering : 0;
    const powerFactorAdj = mt || gdbt ? (fp < 90 ? rates.powerFactorPenalty * (90 / fp - 1) * supply : -rates.powerFactorBonus * supply) : 0;
    const subtotal = supply + metering + powerFactorAdj;
    const iva = subtotal * rates.iva;
    const dap = subtotal * rates.dapCommercial;
    return { kwfact, fixed, distribution, transmission, cenace, energy, capacity, mem, supply, metering, powerFactorAdj, subtotal, iva, dap, total: subtotal + iva + dap };
  };
  const without: BillColumn[] = cons.map((kwh, i) => {
    const d = dates.left[i]!;
    const billableKw = gdbt ? safeDiv(kwh, d.days * 24 * fc, 0) : Math.max(demand[i] ?? 0, 0);
    const fp = 100;
    return { period: i + 1, start: d.start, end: d.end, days: d.days, kwh, demandKw: demand[i] ?? 0, billableKw, powerFactor: fp, ...charges(d.days, kwh, kwh, kwh !== 0, fp) };
  });
  const withPv: BillColumn[] = [];
  let prevNet = 0;
  for (let j = 0; j < 12; j += 1) {
    const k = homologousIndex(j);
    const flag = (cons[k - 1] ?? 0) !== 0;
    const d = dates.right[j]!;
    const raw = flag ? (cons[k - 1] ?? 0) - (P[projectedMonth(latest, j) - 1] ?? 0) : 0;
    const net = j === 0 ? Math.max(raw, 0) : (flag ? raw + Math.min(prevNet, 0) : prevNet);
    const kwh = Math.max(net, 0);
    const fp = 100;
    withPv.push({ period: j + 1, month: projectedMonth(latest, j), billed: flag, start: d.start, end: d.end, days: d.days, generation: P[projectedMonth(latest, j) - 1] ?? 0, rawNet: raw, net, kwh, demandKw: demand[k - 1] ?? 0, powerFactor: fp, ...charges(d.days, kwh, kwh, flag, fp), projectedWithout: without[k - 1]?.total ?? 0 });
    prevNet = net;
  }
  const annualWithout = sum(without.map((c) => c.total as number));
  const annualWith = sum(withPv.map((c) => c.total as number));
  const remainingShare = safeDiv(annualWith, annualWithout, 0);
  return { tariff, zone, monthsPerPeriod: mpp, without, with: withPv, annualWithout, annualWith, savingsShare: annualWithout > 0 ? 1 - remainingShare : 0, remainingShare, warnings: dates.assumed ? ["Sin fechas válidas del último periodo: se asumió un periodo de 59 días que termina hoy."] : [] };
}

export function computeIndustrialBill(input: QuoteInput, generation: GenerationResult, catalog: SolarCatalog): TariffResult {
  const city = findCity(catalog, input.city);
  const zone = city?.division ?? null;
  const tariff = input.currentTariff.toUpperCase();
  const row = mediumVoltageTariff(catalog, tariff, zone);
  if (!row) throw new Error(`SOLAR_TARIFF_NOT_FOUND: ${tariff} ${zone ?? ""}`);
  const rates = catalog.tariffs.rates;
  const fc = loadFactor(catalog, tariff);
  const mt = MEDIUM_VOLTAGE_TARIFFS.includes(tariff);
  const cons = input.consumptionKwh;
  const dates = periodDates(input.periodStartSerial, input.periodEndSerial, true);
  const latest = generation.latestMonth;
  const P = generation.periodGeneration;
  const base0 = { kwhBase: input.kwhBase ?? 0, kwhIntermediate: input.kwhIntermediate ?? 0, kwhPeak: input.kwhPeak ?? 0, kwhSemiPeak: input.kwhSemiPeak ?? 0, kwBase: input.kwBase ?? 0, kwIntermediate: input.kwIntermediate ?? 0, kwPeak: input.kwPeak ?? 0, kwSemiPeak: input.kwSemiPeak ?? 0, kvarh: input.kvarh ?? 0 };
  const prorate = (i: number) => {
    const ratio = i === 0 ? 1 : safeDiv(cons[i] ?? 0, cons[0] ?? 0, 0);
    return Object.fromEntries(Object.entries(base0).map(([key, value]) => [key, value * ratio])) as typeof base0;
  };
  const charges = (days: number, kwh: number, parts: typeof base0) => {
    const billableKw = safeDiv(kwh, days * 24 * fc, 0);
    // Sin energía no hay factor de potencia que penalizar (el libro divide entre cero y da infinito).
    const fp = parts.kvarh === 0 || kwh <= 0 ? 100 : excelRound((kwh / Math.sqrt(kwh ** 2 + parts.kvarh ** 2)) * 100, 2);
    const fixed = row.fixed;
    const distribution = billableKw * row.distribution;
    const transmission = kwh * row.transmission;
    const cenace = kwh * row.cenace;
    const energyBase = Math.max(parts.kwhBase, 0) * row.energyBase;
    const energyIntermediate = Math.max(parts.kwhIntermediate, 0) * row.energyIntermediate;
    const energyPeak = Math.max(parts.kwhPeak, 0) * row.energyPeak;
    const energySemiPeak = Math.max(parts.kwhSemiPeak, 0) * row.energySemiPeak;
    const capacity = billableKw * row.capacity;
    const mem = kwh * row.mem;
    const supply = fixed + distribution + transmission + cenace + energyBase + energyIntermediate + energyPeak + energySemiPeak + capacity + mem;
    const metering = mt ? supply * rates.lowVoltageMetering : 0;
    const powerFactorAdj = fp > 0 && fp < 90 ? rates.powerFactorPenalty * (90 / fp - 1) * supply : -rates.powerFactorBonus * supply;
    const subtotal = supply + metering + powerFactorAdj;
    const iva = subtotal * rates.iva;
    const dap = supply * rates.dapIndustrial;
    return { billableKw, powerFactor: fp, fixed, distribution, transmission, cenace, energyBase, energyIntermediate, energyPeak, energySemiPeak, capacity, mem, supply, metering, powerFactorAdj, subtotal, iva, dap, total: subtotal + iva + dap };
  };
  const without: BillColumn[] = cons.map((kwh, i) => {
    const d = dates.left[i]!;
    const parts = prorate(i);
    const maxDemand = Math.max(parts.kwBase, parts.kwIntermediate, parts.kwPeak);
    return { period: i + 1, start: d.start, end: d.end, days: d.days, kwh, ...parts, maxDemand, ...charges(d.days, kwh, parts) };
  });
  const withPv: BillColumn[] = [];
  for (let j = 0; j < 12; j += 1) {
    const k = homologousIndex(j);
    const src = without[k - 1]!;
    const d = dates.right[j]!;
    const gen = P[projectedMonth(latest, j) - 1] ?? 0;
    const intermediate = (src.kwhIntermediate as number) - gen;
    const peak = (src.kwhPeak as number) + Math.min(intermediate, 0);
    const semiPeak = (src.kwhSemiPeak as number) + Math.min(peak, 0);
    const base = (src.kwhBase as number) + Math.min(semiPeak, 0);
    const kwh = Math.max(base, 0) + Math.max(intermediate, 0) + Math.max(peak, 0) + Math.max(semiPeak, 0);
    const parts = { kwhBase: base, kwhIntermediate: intermediate, kwhPeak: peak, kwhSemiPeak: semiPeak, kwBase: src.kwBase as number, kwIntermediate: src.kwIntermediate as number, kwPeak: src.kwPeak as number, kwSemiPeak: src.kwSemiPeak as number, kvarh: src.kvarh as number };
    const maxDemand = Math.max(parts.kwBase, parts.kwIntermediate, parts.kwPeak);
    withPv.push({ period: j + 1, month: projectedMonth(latest, j), billed: true, start: d.start, end: d.end, days: d.days, generation: gen, net: kwh, kwh, ...parts, maxDemand, ...charges(d.days, kwh, parts), projectedWithout: src.total ?? 0 });
  }
  const annualWithout = sum(without.map((c) => c.total as number));
  const annualWith = sum(withPv.map((c) => c.total as number));
  const remainingShare = safeDiv(annualWith, annualWithout, 0);
  const avgDemand = sum(withPv.map((c) => c.maxDemand as number)) / 12;
  const avgFp = sum(withPv.map((c) => c.powerFactor as number)) / 12 / 100;
  const target = input.targetPowerFactor ?? 0.96;
  const capacitorKvar = avgDemand * (Math.tan(Math.acos(avgFp)) - Math.tan(Math.acos(target)));
  const indWarnings = dates.assumed ? ["Sin fechas válidas del último periodo: se asumió un periodo de 31 días que termina hoy."] : [];
  return { tariff, zone, monthsPerPeriod: 1, without, with: withPv, annualWithout, annualWith, savingsShare: annualWithout > 0 ? 1 - remainingShare : 0, remainingShare, warnings: indWarnings, extra: { averageDemandKw: avgDemand, averagePowerFactor: avgFp, targetPowerFactor: target, capacitorKvar } };
}

export function computeBill(input: QuoteInput, generation: GenerationResult, catalog: SolarCatalog): TariffResult {
  if (input.segment === "RESIDENTIAL") return computeResidentialBill(input, generation, catalog);
  if (input.segment === "COMMERCIAL") return computeCommercialBill(input, generation, catalog);
  return computeIndustrialBill(input, generation, catalog);
}
