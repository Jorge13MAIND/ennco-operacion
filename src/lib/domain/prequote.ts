import { z } from "zod";

import modelDraft from "../../../data/prequote/model-draft-v2.json";
import { NEED_TYPES, TARIFFS, ZONES } from "@/lib/domain/types";
import type { PrequoteAssumption, PrequoteEstimate, PrequoteInput } from "@/lib/domain/types";
import { PRIVACY_NOTICE_VERSION } from "@/lib/privacy/notice";

const numericRangeSchema = z.object({
  min: z.number().finite().nonnegative(),
  max: z.number().finite().positive(),
}).refine((value) => value.max >= value.min, "INVALID_RANGE");

const prequoteModelSchema = z.object({
  version: z.string().min(1),
  status: z.enum(["DRAFT_REVIEW_REQUIRED", "APPROVED", "EXPIRED"]),
  sourceDate: z.iso.date(),
  validUntil: z.iso.datetime({ offset: true }),
  effectiveEnergyRateMxnPerKwh: numericRangeSchema,
  monthlyYieldKwhPerKwp: numericRangeSchema,
  moduleWp: numericRangeSchema,
  roofAreaM2PerKwp: numericRangeSchema,
  investmentMxnPerKwp: z.array(z.object({
    minKwp: z.number().nonnegative(),
    min: z.number().positive(),
    max: z.number().positive(),
    evidenceStatus: z.enum([
      "EXTRAPOLATED_NO_MATCHING_HISTORY",
      "OBSERVED_30_TO_55_KWP",
      "OBSERVED_SMALL_PROJECTS",
    ]),
  }).refine((tier) => tier.max >= tier.min, "INVALID_INVESTMENT_RANGE")).min(1),
  publicInputMonthlySpendStrictLeadThresholdMxn: z.number().positive(),
  industrialCapacityThresholdKwp: z.number().positive(),
  modelApprovalRequiredBy: z.string().min(1),
  sourceManifestPath: z.string().min(1),
});

export type PrequoteModel = z.infer<typeof prequoteModelSchema>;

export const DRAFT_PREQUOTE_MODEL: PrequoteModel = prequoteModelSchema.parse(modelDraft);

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
  privacyNoticeVersion: z.literal(PRIVACY_NOTICE_VERSION),
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

const zeroRange = { min: 0, max: 0 } as const;

function isSolarSizingRequest(input: PrequoteInput): boolean {
  return input.needType === "SOLAR_NEW";
}

function selectInvestmentTier(capacityMaxKwp: number, model: PrequoteModel) {
  return [...model.investmentMxnPerKwp]
    .sort((left, right) => right.minKwp - left.minKwp)
    .find((tier) => capacityMaxKwp >= tier.minKwp) ?? model.investmentMxnPerKwp.at(-1)!;
}

function assumptions(model: PrequoteModel, tariff: PrequoteInput["tariff"]): PrequoteAssumption[] {
  return [
    {
      key: "effective_rate",
      label: "Costo efectivo observado",
      value: `${model.effectiveEnergyRateMxnPerKwh.min.toFixed(2)} a ${model.effectiveEnergyRateMxnPerKwh.max.toFixed(2)}`,
      unit: "MXN/kWh",
      source: "Cuatro propuestas anónimas ENNCO. La tarifa CFE seleccionada requiere recibo para cálculo técnico.",
      sourceDate: model.sourceDate,
    },
    {
      key: "monthly_yield",
      label: "Producción mensual observada",
      value: `${model.monthlyYieldKwhPerKwp.min} a ${model.monthlyYieldKwhPerKwp.max}`,
      unit: "kWh/kWp",
      source: "Cuatro propuestas anónimas ENNCO de 2026.",
      sourceDate: model.sourceDate,
    },
    {
      key: "module",
      label: "Potencia de módulo observada",
      value: `${model.moduleWp.min} a ${model.moduleWp.max}`,
      unit: "Wp",
      source: "Propuestas ENNCO y ficha técnica LONGi Hi-MO X10 650 W.",
      sourceDate: model.sourceDate,
    },
    {
      key: "area",
      label: "Área preliminar de ingeniería",
      value: `${model.roofAreaM2PerKwp.min} a ${model.roofAreaM2PerKwp.max}`,
      unit: "m²/kWp",
      source: "Dimensión física del módulo más margen preliminar de acceso y separación.",
      sourceDate: model.sourceDate,
    },
    {
      key: "tariff",
      label: "Tarifa declarada",
      value: tariff,
      unit: "revisión",
      source: "Entrada del solicitante. CFE publica cargos por energía, capacidad y otros componentes.",
      sourceDate: model.sourceDate,
    },
  ];
}

function modelStatusAt(model: PrequoteModel, now: Date): PrequoteEstimate["modelStatus"] {
  return now.getTime() > new Date(model.validUntil).getTime() ? "EXPIRED" : model.status;
}

export function calculatePrequote(
  input: PrequoteInput,
  model: PrequoteModel = DRAFT_PREQUOTE_MODEL,
  now: Date = new Date(),
): PrequoteEstimate {
  const calculatedAt = now.toISOString();
  const shared = {
    strictLeadStatus: "DOES_NOT_COUNT_WITHOUT_HUMAN_EVIDENCE" as const,
    modelVersion: model.version,
    modelStatus: modelStatusAt(model, now),
    modelValidUntil: model.validUntil,
    calculatedAt,
    assumptions: assumptions(model, input.tariff),
    disclaimer:
      "Estimación preliminar. No constituye oferta, precio final, garantía, beneficio fiscal definitivo ni compromiso de instalación. Requiere recibo, revisión y visita técnica.",
  };

  if (!isSolarSizingRequest(input)) {
    return {
      ...shared,
      estimateKind: "SERVICE_REVIEW",
      capacityKwp: zeroRange,
      investmentMxn: zeroRange,
      roofAreaM2: zeroRange,
      estimatedMonthlyKwh: zeroRange,
      panelCount: zeroRange,
      verdict: "TECHNICAL_REVIEW",
      evidenceConfidence: "TECHNICAL_REVIEW_REQUIRED",
      limitations: [
        "Este servicio no se dimensiona automáticamente.",
        "El equipo técnico ENNCO debe validar alcance, garantías, precio y fecha antes de una propuesta.",
      ],
    };
  }

  const targetFraction = input.coverageTargetPct / 100;
  const estimatedMonthlyKwh = {
    min: input.monthlySpendMxn / model.effectiveEnergyRateMxnPerKwh.max,
    max: input.monthlySpendMxn / model.effectiveEnergyRateMxnPerKwh.min,
  };
  const capacityKwp = {
    min: Math.max(
      0,
      (estimatedMonthlyKwh.min * targetFraction) / model.monthlyYieldKwhPerKwp.max - input.existingCapacityKwp,
    ),
    max: Math.max(
      0,
      (estimatedMonthlyKwh.max * targetFraction) / model.monthlyYieldKwhPerKwp.min - input.existingCapacityKwp,
    ),
  };
  const investmentTier = selectInvestmentTier(capacityKwp.max, model);
  const investmentMxn = {
    min: capacityKwp.min * investmentTier.min,
    max: capacityKwp.max * investmentTier.max,
  };
  const roofAreaM2 = {
    min: capacityKwp.min * model.roofAreaM2PerKwp.min,
    max: capacityKwp.max * model.roofAreaM2PerKwp.max,
  };
  const panelCount = {
    min: Math.ceil((capacityKwp.min * 1000) / model.moduleWp.max),
    max: Math.ceil((capacityKwp.max * 1000) / model.moduleWp.min),
  };
  const extrapolated = capacityKwp.max >= model.industrialCapacityThresholdKwp;

  let verdict: PrequoteEstimate["verdict"] = "COMMERCIAL_REVIEW";
  if (input.monthlySpendMxn < 8_000) verdict = "OUT_OF_SCOPE";
  else if (
    input.monthlySpendMxn > model.publicInputMonthlySpendStrictLeadThresholdMxn
    && extrapolated
  ) verdict = "INDUSTRIAL_REVIEW";

  return {
    ...shared,
    estimateKind: "SOLAR_RANGE",
    capacityKwp,
    investmentMxn,
    roofAreaM2,
    estimatedMonthlyKwh,
    panelCount,
    verdict,
    evidenceConfidence: extrapolated ? "EXTRAPOLATED_REVIEW_REQUIRED" : "SOURCE_RANGE",
    limitations: [
      "Las referencias disponibles no superan 54.825 kWp. Un proyecto industrial requiere validación específica.",
      "La tarifa CFE no se reduce a un precio universal por kWh. El recibo define el cálculo técnico.",
      "El área incluye un margen preliminar. No sustituye levantamiento, estructura ni sembrado.",
      investmentTier.evidenceStatus === "EXTRAPOLATED_NO_MATCHING_HISTORY"
        ? "La banda industrial es una extrapolación y requiere validación técnica."
        : "La banda de inversión se apoya en referencias anónimas de ENNCO.",
    ],
  };
}
