import { z } from "zod";

import { NEED_TYPES, TARIFFS, ZONES } from "@/lib/domain/types";
import type { PrequoteAssumption, PrequoteEstimate, PrequoteInput, Tariff } from "@/lib/domain/types";

export const prequoteInputSchema = z.object({
  needType: z.enum(NEED_TYPES),
  monthlySpendMxn: z.number().finite().min(0).max(50_000_000),
  tariff: z.enum(TARIFFS),
  existingCapacityKwp: z.number().finite().min(0).max(100_000),
  coverageTargetPct: z.number().finite().min(30).max(100),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  zone: z.enum(ZONES),
  contact: z.object({
    company: z.string().trim().min(2).max(160),
    fullName: z.string().trim().min(2).max(160),
    role: z.string().trim().min(2).max(120),
    email: z.email().max(254),
    phone: z.string().trim().min(8).max(30),
  }),
  consent: z.literal(true),
  receiptUploadId: z.string().uuid().optional(),
  attribution: z
    .object({
      source: z.string().trim().max(100).optional(),
      medium: z.string().trim().max(100).optional(),
      campaign: z.string().trim().max(100).optional(),
      content: z.string().trim().max(100).optional(),
    })
    .optional(),
});

type PrequoteModel = {
  version: string;
  status: "DRAFT_REVIEW_REQUIRED" | "APPROVED" | "EXPIRED";
  sourceDate: string;
  peakSunHours: number;
  performanceRatio: number;
  daysPerMonth: number;
  moduleWp: number;
  roofAreaM2PerKwp: number;
  tariffMxnPerKwh: Record<Tariff, number>;
  investmentMxnPerKwp: Array<{ minKwp: number; value: number }>;
  uncertaintyPct: number;
};

export const DRAFT_PREQUOTE_MODEL: PrequoteModel = {
  version: "ENNCO-PREQ-2026-08-DRAFT-01",
  status: "DRAFT_REVIEW_REQUIRED",
  sourceDate: "2026-08-11",
  peakSunHours: 5.5,
  performanceRatio: 0.8,
  daysPerMonth: 30.4,
  moduleWp: 600,
  roofAreaM2PerKwp: 6.5,
  tariffMxnPerKwh: {
    GDMTH: 2.7,
    GDMTO: 2.45,
    PDBT: 4.6,
    UNKNOWN: 3.3,
  },
  investmentMxnPerKwp: [
    { minKwp: 250, value: 9_250 },
    { minKwp: 100, value: 11_500 },
    { minKwp: 30, value: 14_000 },
    { minKwp: 0, value: 17_000 },
  ],
  uncertaintyPct: 0.15,
};

function investmentPerKwp(capacityKwp: number, model: PrequoteModel): number {
  return model.investmentMxnPerKwp.find((tier) => capacityKwp >= tier.minKwp)?.value ?? 17_000;
}

function range(value: number, uncertaintyPct: number): { min: number; max: number } {
  return {
    min: Math.max(0, value * (1 - uncertaintyPct)),
    max: value * (1 + uncertaintyPct),
  };
}

function assumptions(model: PrequoteModel, tariff: Tariff): PrequoteAssumption[] {
  const source = "Modelo preliminar ENNCO. Requiere validación de Paco antes de producción.";
  return [
    { key: "hsp", label: "Horas sol pico", value: model.peakSunHours, unit: "h/día", source, sourceDate: model.sourceDate },
    { key: "pr", label: "Rendimiento del sistema", value: model.performanceRatio, unit: "ratio", source, sourceDate: model.sourceDate },
    { key: "module", label: "Potencia del módulo", value: model.moduleWp, unit: "Wp", source, sourceDate: model.sourceDate },
    { key: "area", label: "Área por capacidad", value: model.roofAreaM2PerKwp, unit: "m²/kWp", source, sourceDate: model.sourceDate },
    { key: "tariff", label: "Costo efectivo de energía", value: model.tariffMxnPerKwh[tariff], unit: "MXN/kWh", source, sourceDate: model.sourceDate },
  ];
}

export function calculatePrequote(input: PrequoteInput, model: PrequoteModel = DRAFT_PREQUOTE_MODEL): PrequoteEstimate {
  const pricePerKwh = model.tariffMxnPerKwh[input.tariff];
  const estimatedMonthlyKwh = input.monthlySpendMxn / pricePerKwh;
  const monthlyProductionPerKwp = model.peakSunHours * model.daysPerMonth * model.performanceRatio;
  const targetKwh = estimatedMonthlyKwh * (input.coverageTargetPct / 100);
  const grossCapacityKwp = targetKwh / monthlyProductionPerKwp;
  const newCapacityKwp = Math.max(0, grossCapacityKwp - input.existingCapacityKwp);
  const investment = newCapacityKwp * investmentPerKwp(newCapacityKwp, model);
  const area = newCapacityKwp * model.roofAreaM2PerKwp;

  let verdict: PrequoteEstimate["verdict"] = "INDUSTRIAL_REVIEW";
  if (input.monthlySpendMxn < 8_000) verdict = "OUT_OF_SCOPE";
  else if (newCapacityKwp < 100) verdict = "COMMERCIAL";

  return {
    capacityKwp: range(newCapacityKwp, model.uncertaintyPct),
    investmentMxn: range(investment, model.uncertaintyPct),
    roofAreaM2: range(area, model.uncertaintyPct),
    estimatedMonthlyKwh,
    verdict,
    modelVersion: model.version,
    modelStatus: model.status,
    calculatedAt: new Date().toISOString(),
    assumptions: assumptions(model, input.tariff),
    disclaimer:
      "Estimación preliminar. No constituye oferta, garantía, beneficio fiscal definitivo ni compromiso de instalación. Requiere revisión del recibo y visita técnica.",
  };
}
