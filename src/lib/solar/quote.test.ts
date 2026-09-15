import { describe, expect, it } from "vitest";

import golden from "@/lib/solar/__fixtures__/golden-v101.json";
import { workbookCatalog } from "@/lib/solar/workbook";
import { computeQuote } from "@/lib/solar/quote";
import type { QuoteInput, Segment } from "@/lib/solar/types";

/**
 * Los tres proyectos de ejemplo del libro (Saltillo residencial, Irapuato comercial PDBT, León
 * industrial GDMTH) recalculados en la v1.0.1. El motor debe reproducir cada cifra clave con la
 * precisión del propio Excel.
 */
const catalog = workbookCatalog();
const cases = golden as Record<Segment, { inputs: QuoteInput; expected: Record<string, unknown> }>;

function close(actual: number, expected: unknown, rel = 1e-9, abs = 1e-6) {
  const e = Number(expected);
  expect(Math.abs(actual - e) <= Math.max(abs, Math.abs(e) * rel), `esperado ${e}, obtenido ${actual}`).toBe(true);
}

for (const segment of ["RESIDENTIAL", "COMMERCIAL", "INDUSTRIAL"] as const) {
  const { inputs, expected } = cases[segment];
  const result = computeQuote(inputs, catalog);
  describe(`${segment}: ejemplo del libro`, () => {
    it("dimensiona igual que Inf_Vac", () => {
      close(result.averageConsumption, expected.averageConsumption);
      close(result.annualConsumption, expected.annualConsumption);
      close(result.annualGeneration, expected.annualGeneration);
      close(result.coverage, expected.coverage);
      expect(result.modulePowerW).toBe(Number(expected.modulePowerW));
      expect(result.modulesNeeded).toBe(Number(expected.modulesNeeded));
      close(result.systemNeededKw, expected.systemNeededKw);
      expect(result.modulesTotal).toBe(Number(expected.modulesTotal));
      close(result.systemKw, expected.systemKw);
      expect(result.inverters[0]?.maxModules).toBe(Number(expected.maxModules));
    });
    it("genera mes a mes como Gen_Energía", () => {
      const months = expected.generationMonthly as number[];
      months.forEach((m, i) => close(result.generation.monthly[i] ?? NaN, m));
      close(result.generation.annual, expected.generationAnnual);
    });
    it("calcula el recibo sin y con FV como Cal_Tarifa", () => {
      (expected.billWithout as number[]).forEach((v, i) => close(result.bill.without[i]?.total as number, v, 1e-9, 1e-5));
      (expected.billWith as number[]).forEach((v, i) => close(result.bill.with[i]?.total as number, v, 1e-9, 1e-5));
      close(result.bill.annualWithout, expected.billWithoutAnnual, 1e-9, 1e-4);
      close(result.bill.annualWith, expected.billWithAnnual, 1e-9, 1e-4);
      if (expected.netKwh) (expected.netKwh as number[]).forEach((v, i) => close(result.bill.with[i]?.net as number, v, 1e-9, 1e-5));
      if (expected.dacFlags) (expected.dacFlags as Array<string | number>).forEach((v, i) => expect(String(result.bill.with[i]?.tariff)).toBe(String(v).replace(/\.0$/u, "")));
    });
    it("pone precio como Precios_SFV y F105", () => {
      close(result.pricing.bomTotalMxn, expected.bomTotalMxn, 1e-9, 1e-4);
      close(result.pricing.suggestedPricePerWatt, expected.suggestedPricePerWatt);
      close(result.pricing.cashPrice, expected.cashPrice, 1e-9, 1e-4);
      (expected.advancesMxn as number[]).forEach((v, i) => close(result.pricing.advances[i] ?? NaN, v, 1e-9, 1e-4));
      (expected.financingMxn as number[]).forEach((v, i) => close(result.pricing.financing[i]?.amount ?? NaN, v, 1e-9, 1e-4));
      close(result.pricing.financing[0]?.monthly ?? NaN, expected.monthlyPayment, 1e-9, 1e-4);
    });
    it("proyecta a 30 años como Inf_Apoyo", () => {
      const p = expected.projection as Record<string, number>;
      close(result.projection.cost, p.cost, 1e-9, 1e-4);
      close(result.projection.deduction, p.deduction, 1e-9, 1e-4);
      close(result.projection.years[0]?.payment ?? NaN, p.firstPayment, 1e-9, 1e-4);
      close(result.projection.years[0]?.paymentWithPv ?? NaN, p.firstPaymentPv, 1e-9, 1e-4);
      close(result.projection.irr, p.irr, 1e-7, 1e-7);
      expect(result.projection.paybackYears).toBe(Number(p.paybackYears));
      close(result.projection.paybackFraction, p.paybackFraction, 1e-8, 1e-8);
    });
  });
}

describe("industrial: banco de capacitores", () => {
  it("reproduce R60 con el factor de potencia objetivo del libro", () => {
    const { inputs, expected } = cases.INDUSTRIAL;
    const result = computeQuote({ ...inputs, targetPowerFactor: 0.96 }, catalog);
    close(result.bill.extra?.capacitorKvar ?? NaN, expected.capacitorKvar, 1e-6, 1e-6);
  });
});
