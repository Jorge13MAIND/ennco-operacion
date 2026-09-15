import type { QuoteResult } from "@/lib/solar/types";

/** Resumen compacto que se guarda con la cotización y se muestra en listas. */
export type QuoteSummary = {
  city: string; module: string; modules: number; systemKw: number; annualConsumption: number; annualGeneration: number; coverage: number;
  annualWithout: number; annualWith: number; savingsShare: number; cashPrice: number; pricePerWatt: number; irr: number; paybackTotal: number;
  tariff: string; inverter: string | null; computedAt: string;
};

export function quoteSummary(result: QuoteResult): QuoteSummary {
  return {
    city: result.city.city, module: result.module.model, modules: result.modulesTotal, systemKw: result.systemKw,
    annualConsumption: result.annualConsumption, annualGeneration: result.annualGeneration, coverage: result.coverage,
    annualWithout: result.bill.annualWithout, annualWith: result.bill.annualWith, savingsShare: result.bill.savingsShare,
    cashPrice: result.pricing.cashPrice, pricePerWatt: result.input.pricePerWatt, irr: result.projection.irr, paybackTotal: result.projection.paybackTotal,
    tariff: result.bill.tariff, inverter: result.inverters[0]?.model ?? null, computedAt: new Date().toISOString(),
  };
}
