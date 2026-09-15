import { describe, expect, it } from "vitest";

import scenarios from "@/lib/solar/__fixtures__/scenarios-v101.json";
import { workbookCatalog } from "@/lib/solar/workbook";
import { computeQuote } from "@/lib/solar/quote";
import type { QuoteInput } from "@/lib/solar/types";

/**
 * Batería de la auditoría (15-sep): 21 escenarios que cambian ciudad, módulo, inversor, consumo,
 * tarifa, periodo, orientaciones, IVA, descuento, servicios, financiamiento y mes del recibo en el
 * libro v1.0.1, recalculados con LibreOffice. El motor reproduce todos salvo tres desviaciones
 * deliberadas y documentadas:
 *  - R6_mensual y C1_gdbt_mensual: el bloque de generación residencial y comercial del libro está
 *    cableado como bimestral (P = V + V anterior) aunque la captura diga Mensual, así que resta dos
 *    meses de generación a un recibo de un mes. El motor resta un mes. (Corrección 16)
 *  - R7_dos_orientaciones: en el libro las orientaciones 2 a 4 traen pérdidas distintas a la 1
 *    (residencial 7.5 % + 7.5 % contra 0.3 % + 0.3 %; comercial 4.8 % o 0 %; industrial 5.3 %).
 *    El motor aplica a todas las orientaciones los parámetros de la cotización. (Corrección 17)
 */
const catalog = workbookCatalog();
const cases = scenarios as Record<string, { changes: string[]; inputs: QuoteInput; expected: Record<string, unknown> }>;
const DEVIATIONS: Record<string, "monthly" | "orientations"> = { R6_mensual: "monthly", C1_gdbt_mensual: "monthly", R7_dos_orientaciones: "orientations" };

function close(actual: number | undefined, expected: unknown, rel = 1e-9, abs = 1e-5) {
  const e = Number(expected);
  if (!Number.isFinite(e)) return;
  expect(actual, `esperado ${e}`).toBeDefined();
  expect(Math.abs((actual as number) - e) <= Math.max(abs, Math.abs(e) * rel), `esperado ${e}, obtenido ${actual}`).toBe(true);
}

for (const [name, { inputs, expected }] of Object.entries(cases)) {
  const deviation = DEVIATIONS[name];
  describe(`escenario ${name}${deviation ? ` (desviación documentada: ${deviation})` : ""}`, () => {
    const result = computeQuote(inputs, catalog);
    it("generación y dimensionamiento", () => {
      if (deviation === "orientations") {
        // La orientación 1 sí debe coincidir con el libro (D61); la 2 difiere por las pérdidas del libro.
        close(result.generation.orientations[0]?.annual, 3814.04391594106);
        expect(result.generation.orientations[1]?.annual ?? 0).toBeGreaterThan(Number(expected.generationAnnual) - 3814.04391594106);
        return;
      }
      close(result.annualGeneration, expected.generationAnnual);
      (expected.generationMonthly as number[]).forEach((m, i) => close(result.generation.monthly[i], m));
      expect(result.modulesNeeded).toBe(Number(expected.modulesNeeded));
      expect(result.inverters[0]?.maxModules).toBe(Number(expected.maxModules));
      close(result.systemKw, expected.systemKw);
    });
    it("recibo sin y con FV", () => {
      (expected.billWithout as number[]).forEach((v, i) => close(result.bill.without[i]?.total as number, v));
      if (deviation) return;
      (expected.billWith as number[]).forEach((v, i) => close(result.bill.with[i]?.total as number, v));
      if (expected.netKwh) (expected.netKwh as number[]).forEach((v, i) => close(result.bill.with[i]?.net as number, v));
      if (expected.dacFlags) (expected.dacFlags as Array<string | number>).forEach((v, i) => expect(String(result.bill.with[i]?.tariff)).toBe(String(v).replace(/\.0$/u, "")));
    });
    it("precio y proyección", () => {
      close(result.pricing.bomTotalMxn, expected.bomTotalMxn, 1e-9, 1e-4);
      close(result.pricing.suggestedPricePerWatt, expected.suggestedPricePerWatt);
      close(result.pricing.cashPrice, expected.cashPrice, 1e-9, 1e-4);
      (expected.financingMxn as number[]).forEach((v, i) => close(result.pricing.financing[i]?.amount, v, 1e-9, 1e-4));
      const p = expected.projection as Record<string, number>;
      close(result.projection.deduction, p.deduction, 1e-9, 1e-4);
      if (deviation) return;
      close(result.projection.irr, p.irr, 1e-7, 1e-7);
      expect(result.projection.paybackYears).toBe(Number(p.paybackYears));
      close(result.projection.paybackFraction, p.paybackFraction, 1e-8, 1e-8);
    });
  });
}

describe("desviaciones documentadas: comportamiento del motor", () => {
  it("residencial mensual resta un solo mes de generación por periodo", () => {
    const { inputs } = cases.R6_mensual!;
    const result = computeQuote(inputs, catalog);
    const latest = result.generation.latestMonth;
    const gen = result.generation.monthly[latest - 1] ?? 0;
    expect(result.generation.periodGeneration[latest - 1]).toBeCloseTo(gen, 9);
    expect(result.bill.with[0]?.net).toBeCloseTo((inputs.consumptionKwh[0] ?? 0) - gen, 9);
  });
  it("todas las orientaciones usan los mismos parámetros de generación", () => {
    const { inputs } = cases.R7_dos_orientaciones!;
    const result = computeQuote(inputs, catalog);
    const perModule = (o: number) => (result.generation.orientations[o]?.annual ?? 0) / (result.generation.orientations[o]?.modules ?? 1);
    // Misma ciudad y módulo: la diferencia entre orientaciones solo es el Factor K (inclinación), no las pérdidas.
    expect(result.generation.orientations[1]?.factorK).not.toEqual(result.generation.orientations[0]?.factorK);
    expect(Math.abs(perModule(1) / perModule(0) - 1)).toBeLessThan(0.12);
  });
});

describe("robustez", () => {
  const base = cases.I1_gdmto!.inputs;
  it("900 módulos industriales no rompen el cálculo (el libro da #DIV/0!)", () => {
    const result = computeQuote({ ...base, orientations: [{ modules: 900, azimuth: 0, inclination: 5 }] }, catalog);
    expect(Number.isFinite(result.pricing.cashPrice)).toBe(true);
    expect(Number.isFinite(result.projection.irr)).toBe(true);
    expect(result.demandWarning).not.toBeNull();
  });
  it("consumo en ceros no divide entre cero", () => {
    const result = computeQuote({ ...base, consumptionKwh: Array(12).fill(0), kwhBase: 0, kwhIntermediate: 0, kwhPeak: 0, kvarh: 0 }, catalog);
    expect(result.modulesNeeded).toBe(0);
    expect(Number.isFinite(result.bill.annualWithout)).toBe(true);
    expect(Number.isFinite(result.projection.paybackTotal)).toBe(true);
  });
  it("sin módulos: generación 0 y precio solo de servicios", () => {
    const result = computeQuote({ ...base, orientations: [{ modules: 0, azimuth: 0, inclination: 5 }] }, catalog);
    expect(result.annualGeneration).toBe(0);
    expect(result.pricing.suggestedPricePerWatt).toBe(0);
    expect(Number.isFinite(result.pricing.cashPrice)).toBe(true);
  });
  it("ciudad o tarifa inexistente avisan con un código claro", () => {
    expect(() => computeQuote({ ...base, city: "Atlántida" }, catalog)).toThrow(/SOLAR_CITY_NOT_FOUND/u);
    expect(() => computeQuote({ ...base, currentTariff: "GDMTX" }, catalog)).toThrow(/SOLAR_TARIFF_NOT_FOUND/u);
  });
});

describe("hallazgos de la revisión independiente (15-sep)", () => {
  const ind = cases.I1_gdmto!.inputs;
  const res = cases.R1_leon!.inputs;
  it("A1: consumo 0 con kVArh no produce infinito en el recibo industrial", () => {
    const result = computeQuote({ ...ind, consumptionKwh: Array(12).fill(0), kvarh: 4000 }, catalog);
    expect(Number.isFinite(result.bill.annualWithout)).toBe(true);
    expect(Number.isFinite(result.bill.annualWith)).toBe(true);
    expect(Number.isFinite(result.projection.irr)).toBe(true);
  });
  it("A3: el industrial siempre es mensual aunque la captura diga bimestral", () => {
    const monthly = computeQuote(ind, catalog);
    const bimonthly = computeQuote({ ...ind, period: "Bimestral" }, catalog);
    expect(bimonthly.bill.annualWith).toBeCloseTo(monthly.bill.annualWith, 6);
    expect(bimonthly.generation.periodGeneration).toEqual(monthly.generation.periodGeneration);
  });
  it("A2: bimestral con 12 renglones o primer renglón en cero avisa", () => {
    const full = computeQuote({ ...res, consumptionKwh: Array(12).fill(500) }, catalog);
    expect(full.warnings.some((w) => /bimestral/u.test(w))).toBe(true);
    const shifted = computeQuote({ ...res, consumptionKwh: [0, 788, 0, 890, 0, 1101, 0, 1270, 0, 802, 0, 848] }, catalog);
    expect(shifted.warnings.some((w) => /primer renglón/u.test(w))).toBe(true);
  });
  it("A4: sin fechas válidas se asume un periodo y se avisa; nunca hay días negativos", () => {
    const result = computeQuote({ ...cases.C2_guadalajara!.inputs, periodStartSerial: null, periodEndSerial: null }, catalog);
    expect(result.bill.without.every((c) => (c.days as number) > 0)).toBe(true);
    expect(result.warnings.some((w) => /fechas/u.test(w))).toBe(true);
    const inverted = computeQuote({ ...cases.C2_guadalajara!.inputs, periodStartSerial: 45620, periodEndSerial: 45567 }, catalog);
    expect(inverted.bill.annualWithout).toBeGreaterThan(0);
  });
  it("A5: inclinación sin Factor K avisa en vez de callar", () => {
    const result = computeQuote({ ...res, orientations: [{ modules: 7, azimuth: 0, inclination: 17 }] }, catalog);
    expect(result.annualGeneration).toBe(0);
    expect(result.warnings.some((w) => /Factor K/u.test(w))).toBe(true);
  });
  it("A6: sin módulos capturados ya se dimensiona el sistema necesario", () => {
    const result = computeQuote({ ...res, orientations: [{ modules: 0, azimuth: 0, inclination: 20 }] }, catalog);
    expect(result.modulesNeeded).toBeGreaterThan(0);
    expect(result.annualGeneration).toBe(0);
  });
  it("A10: inversor desconocido avisa; los inversores adicionales entran al BOM (corrección 18)", () => {
    const unknown = computeQuote({ ...res, inverters: [{ model: "Inversor X", quantity: 1 }] }, catalog);
    expect(unknown.warnings.some((w) => /no está en el catálogo/u.test(w))).toBe(true);
    const two = computeQuote({ ...res, inverters: [{ model: "Growatt (MIN 4600TL-X2)", quantity: 1 }, { model: "Growatt (MIN 2500TL-X2)", quantity: 1 }] }, catalog);
    expect(two.pricing.bom.filter((l) => l.concept === "Inversor")).toHaveLength(2);
  });
  it("A8/A9: ahorro nulo no reporta 100 % y el retorno se marca como no recuperado", () => {
    const result = computeQuote({ ...res, consumptionKwh: Array(12).fill(0), orientations: [{ modules: 10, azimuth: 0, inclination: 20 }] }, catalog);
    expect(result.bill.savingsShare).toBe(0);
    expect(result.projection.recovers).toBe(false);
  });
  it("A11: flujos en cero dan TIR 0", () => {
    const result = computeQuote({ ...res, consumptionKwh: Array(12).fill(0), pricePerWatt: 0, services: [], taxDeduction: false, orientations: [{ modules: 0, azimuth: 0, inclination: 20 }] }, catalog);
    expect(result.projection.irr).toBe(0);
  });
  it("A12: DAC sin tarifa base usa la tarifa 1", () => {
    const result = computeQuote({ ...res, currentTariff: "DAC", baseTariff: null }, catalog);
    expect(result.bill.without[0]?.tariff).toBe("DAC");
  });
});
