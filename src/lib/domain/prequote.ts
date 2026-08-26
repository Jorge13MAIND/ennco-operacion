import { z } from "zod";

import approvedModel from "../../../data/prequote/model-approved-v3.json";
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
      "PACO_APPROVED_FROM_30_KWP",
      "PACO_APPROVED_UNDER_30_KWP",
    ]),
  }).refine((tier) => tier.max >= tier.min, "INVALID_INVESTMENT_RANGE")).min(1),
  industrialInvestmentPolicy: z.literal("TECHNICAL_COMMERCIAL_REVIEW_REQUIRED"),
  commercialReferences: z.object({
    hiddenDefectsWarrantyMonths: z.number().int().positive(),
    cashDiscountPct: numericRangeSchema,
    installedModuleStartingPriceMxn: z.number().positive(),
    contractualPriceRequiresCommercialValidation: z.literal(true),
    installationDateDependsOnMaterialsAndWorkSchedule: z.literal(true),
    automaticCommitmentsAllowed: z.literal(false),
  }),
  publicInputMonthlySpendStrictLeadThresholdMxn: z.number().positive(),
  industrialCapacityThresholdKwp: z.number().positive(),
  modelApprovalRequiredBy: z.string().min(1),
  approvalSourcePath: z.string().min(1),
  sourceManifestPath: z.string().min(1),
});

export type PrequoteModel = z.infer<typeof prequoteModelSchema>;

export const APPROVED_PREQUOTE_MODEL: PrequoteModel = prequoteModelSchema.parse(approvedModel);

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
      label: "Tarifa efectiva de referencia",
      value: `${model.effectiveEnergyRateMxnPerKwh.min.toFixed(2)} a ${model.effectiveEnergyRateMxnPerKwh.max.toFixed(2)}`,
      unit: "MXN/kWh",
      source: "Rango validado por Paco. La tarifa CFE seleccionada requiere recibo para cálculo técnico.",
      sourceDate: model.sourceDate,
    },
    {
      key: "monthly_yield",
      label: "Producción mensual estimada",
      value: `${model.monthlyYieldKwhPerKwp.min} a ${model.monthlyYieldKwhPerKwp.max}`,
      unit: "kWh/kWp",
      source: "Rango validado por Paco para la estimación preliminar.",
      sourceDate: model.sourceDate,
    },
    {
      key: "module",
      label: "Potencia de módulo de referencia",
      value: `${model.moduleWp.min} a ${model.moduleWp.max}`,
      unit: "Wp",
      source: "Rango validado por Paco y contrastado con propuestas ENNCO y ficha técnica de fabricante.",
      sourceDate: model.sourceDate,
    },
    {
      key: "area",
      label: "Superficie preliminar requerida",
      value: `${model.roofAreaM2PerKwp.min} a ${model.roofAreaM2PerKwp.max}`,
      unit: "m²/kWp",
      source: "Rango validado por Paco. Requiere levantamiento, estructura, acceso y sembrado.",
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
  model: PrequoteModel = APPROVED_PREQUOTE_MODEL,
  now: Date = new Date(),
): PrequoteEstimate {
  const calculatedAt = now.toISOString();
  const shared = {
    strictLeadStatus: "DOES_NOT_COUNT_WITHOUT_HUMAN_EVIDENCE" as const,
    modelVersion: model.version,
    modelStatus: modelStatusAt(model, now),
    modelValidUntil: model.validUntil,
    calculatedAt,
    commercialReferences: model.commercialReferences,
    assumptions: assumptions(model, input.tariff),
    disclaimer:
      "Estimación preliminar sujeta a revisión del recibo CFE, tarifa, condiciones del sitio, estructura, distancias, obra eléctrica y revisión técnica. No constituye oferta, precio contractual ni fecha de instalación.",
  };

  if (!isSolarSizingRequest(input)) {
    return {
      ...shared,
      estimateKind: "SERVICE_REVIEW",
      capacityKwp: zeroRange,
      investmentMxn: null,
      investmentStatus: "NOT_APPLICABLE",
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
  const industrialReviewRequired = capacityKwp.max >= model.industrialCapacityThresholdKwp;
  const minimumInvestmentTier = selectInvestmentTier(capacityKwp.min, model);
  const maximumInvestmentTier = selectInvestmentTier(capacityKwp.max, model);
  const investmentMxn = industrialReviewRequired ? null : {
    min: capacityKwp.min * minimumInvestmentTier.min,
    max: capacityKwp.max * maximumInvestmentTier.max,
  };
  const roofAreaM2 = {
    min: capacityKwp.min * model.roofAreaM2PerKwp.min,
    max: capacityKwp.max * model.roofAreaM2PerKwp.max,
  };
  const panelCount = {
    min: Math.ceil((capacityKwp.min * 1000) / model.moduleWp.max),
    max: Math.ceil((capacityKwp.max * 1000) / model.moduleWp.min),
  };
  let verdict: PrequoteEstimate["verdict"] = "COMMERCIAL_REVIEW";
  if (input.monthlySpendMxn < 8_000) verdict = "OUT_OF_SCOPE";
  else if (industrialReviewRequired) verdict = "INDUSTRIAL_REVIEW";

  return {
    ...shared,
    estimateKind: "SOLAR_RANGE",
    capacityKwp,
    investmentMxn,
    investmentStatus: industrialReviewRequired
      ? "TECHNICAL_COMMERCIAL_REVIEW_REQUIRED"
      : "PRELIMINARY_RANGE",
    roofAreaM2,
    estimatedMonthlyKwh,
    panelCount,
    verdict,
    evidenceConfidence: industrialReviewRequired ? "INDUSTRIAL_REVIEW_REQUIRED" : "SOURCE_RANGE",
    limitations: [
      "Los proyectos iguales o mayores a 100 kWp requieren validación técnica y comercial porque el histórico propio no permite establecer un rango definitivo.",
      "La tarifa CFE no se reduce a un precio universal por kWh. El recibo define el cálculo técnico.",
      "El área incluye un margen preliminar. No sustituye levantamiento, estructura ni sembrado.",
      industrialReviewRequired
        ? "No se presenta un rango automático de inversión para 100 kWp o más."
        : "La banda de inversión fue validada por Paco y sigue sujeta a revisión comercial.",
    ],
  };
}
