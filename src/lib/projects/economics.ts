import { z } from "zod";
import type { JsonRecord, ProjectRecord } from "./types";

const positive = z.number().finite().positive().max(1e12);
const nonnegative = z.number().finite().nonnegative().max(1e12);
const reference = z.string().trim().min(1).max(1000);
const month = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
const resourceMonthSchema = z
  .object({
    month,
    dailyPlaneOfArrayKwhM2: z.number().finite().min(0).max(24),
    sourceRef: reference,
    datasetPeriod: reference,
    tiltDeg: z.number().finite().min(0).max(90),
    azimuthDeg: z.number().finite().min(-180).max(180),
  })
  .strict();
function consecutiveYear(months: string[]): boolean {
  if (months.length !== 12 || new Set(months).size !== 12) return false;
  const order = months
    .map((m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5)))
    .sort((a, b) => a - b);
  return order.every((value, i) => i === 0 || value - order[i - 1]! === 1);
}
function monthDays(value: string): number {
  return new Date(
    Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5)), 0),
  ).getUTCDate();
}

export const preliminarySizingSchema = z
  .object({
    annualDemandKwh: positive,
    coveragePct: z.number().finite().gt(0).max(100),
    modulePowerW: positive,
    monthlyResource: z.array(resourceMonthSchema).length(12),
    performanceRatio: z.number().finite().gt(0).max(1),
    sourceRef: reference,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!consecutiveYear(value.monthlyResource.map((m) => m.month)))
      ctx.addIssue({
        code: "custom",
        path: ["monthlyResource"],
        message:
          "Se requieren doce meses consecutivos, sin duplicados, para dimensionar el año.",
      });
    const first = value.monthlyResource[0];
    if (
      first &&
      value.monthlyResource.some(
        (m) =>
          m.tiltDeg !== first.tiltDeg ||
          m.azimuthDeg !== first.azimuthDeg ||
          m.datasetPeriod !== first.datasetPeriod,
      )
    )
      ctx.addIssue({
        code: "custom",
        path: ["monthlyResource"],
        message:
          "El recurso debe corresponder al mismo plano y periodo meteorológico durante los doce meses.",
      });
    if (!value.monthlyResource.some((m) => m.dailyPlaneOfArrayKwhM2 > 0))
      ctx.addIssue({
        code: "custom",
        path: ["monthlyResource"],
        message:
          "El recurso anual debe producir energía positiva; no es posible dimensionar con cero irradiación.",
      });
  });
export type PreliminarySizingInput = z.infer<typeof preliminarySizingSchema>;
export type PreliminarySizingResult = {
  version: "ENNCO-PRELIMINARY-SIZING-1";
  status: "PRELIMINARY";
  annualDemandKwh: number;
  targetCoveragePct: number;
  targetEnergyKwh: number;
  annualSpecificYieldKwhPerKwp: number;
  minimumCapacityKw: number;
  moduleCount: number;
  capacityKw: number;
  estimatedAnnualEnergyKwh: number;
  estimatedCoveragePct: number;
  monthlyGeneration: { month: string; generationKwh: number }[];
  assumptions: string[];
  sourceRefs: string[];
  warnings: string[];
};

export function estimatePreliminarySizing(
  rawInput: PreliminarySizingInput,
): PreliminarySizingResult {
  const input = preliminarySizingSchema.parse(rawInput);
  const annualSpecificYieldKwhPerKwp = input.monthlyResource.reduce(
    (sum, m) =>
      sum +
      m.dailyPlaneOfArrayKwhM2 * monthDays(m.month) * input.performanceRatio,
    0,
  );
  const targetEnergyKwh = (input.annualDemandKwh * input.coveragePct) / 100;
  const minimumCapacityKw = targetEnergyKwh / annualSpecificYieldKwhPerKwp;
  const moduleCount = Math.ceil(
    (minimumCapacityKw * 1000) / input.modulePowerW,
  );
  if (
    !Number.isSafeInteger(moduleCount) ||
    moduleCount < 1 ||
    moduleCount > 100000
  )
    throw new Error("PRELIMINARY_SIZING_OUT_OF_RANGE");
  const capacityKw = (moduleCount * input.modulePowerW) / 1000;
  const monthlyGeneration = input.monthlyResource.map((m) => ({
    month: m.month,
    generationKwh:
      capacityKw *
      m.dailyPlaneOfArrayKwhM2 *
      monthDays(m.month) *
      input.performanceRatio,
  }));
  const estimatedAnnualEnergyKwh = monthlyGeneration.reduce(
    (sum, m) => sum + m.generationKwh,
    0,
  );
  const result: PreliminarySizingResult = {
    version: "ENNCO-PRELIMINARY-SIZING-1",
    status: "PRELIMINARY",
    annualDemandKwh: input.annualDemandKwh,
    targetCoveragePct: input.coveragePct,
    targetEnergyKwh,
    annualSpecificYieldKwhPerKwp,
    minimumCapacityKw,
    moduleCount,
    capacityKw,
    estimatedAnnualEnergyKwh,
    estimatedCoveragePct:
      (estimatedAnnualEnergyKwh / input.annualDemandKwh) * 100,
    monthlyGeneration,
    assumptions: [
      "Demanda anual y cobertura objetivo declaradas por el responsable, con fuente; no se extrapolan meses faltantes.",
      "Energía proyectada con HSP del plano y PR uniforme. El número de módulos se redondea hacia arriba; no se reduce automáticamente para ajustarlo al consumo.",
    ],
    sourceRefs: [
      ...new Set([
        "nrel-performance-ratio",
        "pvgis-resource",
        input.sourceRef,
        ...input.monthlyResource.map((m) => m.sourceRef),
      ]),
    ],
    warnings: [
      "La cobertura compara energías anuales: no equivale a autoconsumo, ahorro de factura ni liquidación de excedentes.",
      "Se requiere revisar espacio, estructura, sombras, inversores, MPPT, circuitos y condiciones de interconexión antes de seleccionar equipos.",
      "La sugerencia es preliminar y no constituye una aprobación técnica.",
    ],
  };
  if (
    Object.values(result).some(
      (v) => typeof v === "number" && !Number.isFinite(v),
    )
  )
    throw new Error("PRELIMINARY_SIZING_OUT_OF_RANGE");
  return result;
}

export interface ProposalEconomicsResult extends JsonRecord {
  version: "ENNCO-SIMPLE-PAYBACK-1";
  status: "ESTIMATE" | "UNAVAILABLE";
  method: "SIMPLE_BEFORE_VAT";
  calculationId: string | null;
  calculationInputHash: string | null;
  investmentMxn: number | null;
  annualEnergySavingsMxn: number | null;
  annualOperatingCostMxn: number | null;
  netAnnualSavingsMxn: number | null;
  simplePaybackYears: number | null;
  periodFrom: string | null;
  periodTo: string | null;
  missingData: string[];
  missingReason: string | null;
  limitations: string[];
  sourceRefs: string[];
}
const consumptionInputSchema = z.object({
  months: z
    .array(z.object({ month, kWh: nonnegative, confirmed: z.literal(true) }))
    .length(12),
});
const consumptionResultSchema = z.object({
  confirmedMonths: z.literal(12),
  annualKwh: nonnegative,
  energySavingsMxn: nonnegative,
  monthlyBilling: z
    .array(
      z.object({
        month,
        beforeMxn: nonnegative,
        afterMxn: nonnegative,
        savingsMxn: nonnegative,
      }),
    )
    .length(12),
});
const recordObject = (value: unknown): JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
const finiteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Conventional simple payback, before VAT. Never substitutes missing operating cost with zero. */
export function proposalEconomics(
  proposal: JsonRecord,
  calculation?: ProjectRecord,
): ProposalEconomicsResult {
  const investment = finiteNumber(proposal.subtotalMxn),
    operating = finiteNumber(proposal.annualOperatingCostMxn);
  const value: ProposalEconomicsResult = {
    version: "ENNCO-SIMPLE-PAYBACK-1",
    status: "UNAVAILABLE",
    method: "SIMPLE_BEFORE_VAT",
    calculationId: calculation?.id ?? null,
    calculationInputHash:
      typeof calculation?.data.inputHash === "string"
        ? calculation.data.inputHash
        : null,
    investmentMxn: investment,
    annualEnergySavingsMxn: null,
    annualOperatingCostMxn: operating,
    netAnnualSavingsMxn: null,
    simplePaybackYears: null,
    periodFrom: null,
    periodTo: null,
    missingData: [],
    missingReason: null,
    limitations: [
      "Retorno simple antes de IVA: inversión de venta sin IVA / (ahorro energético anual sin IVA - costo anual de operación del sistema sin IVA).",
      "Escenario uniforme de energía; no calcula tarifa horaria completa, reducción de demanda, subsidios, impuestos, créditos o remuneración de excedentes.",
      "No incluye valor del dinero en el tiempo, degradación, inflación, reposiciones, financiamiento ni cambios futuros de tarifa. No es TIR ni VAN.",
      "El costo anual de operación corresponde al sistema del cliente, no a costos internos ni margen de ENNCO. Las cifras son una estimación que requiere revisión.",
    ],
    sourceRefs: ["ennco-simple-payback-arithmetic", "cfe-tariff-components"],
  };
  const fail = (reason: string) => {
    value.missingData.push(reason);
  };
  if (investment === null || investment <= 0)
    fail("Falta una inversión de venta positiva antes de IVA.");
  if (operating === null || operating < 0)
    fail(
      "Capturar explícitamente el costo anual de operación del sistema antes de IVA; no se supone cero.",
    );
  if (
    !calculation ||
    calculation.kind !== "calculation" ||
    proposal.calculationId !== calculation.id
  )
    fail("Vincular la revisión exacta de cálculo de esta propuesta.");
  else {
    const input = recordObject(calculation.data.input),
      output = recordObject(calculation.data.result);
    const consumption = consumptionInputSchema.safeParse(input.consumption),
      computed = consumptionResultSchema.safeParse(output.consumption);
    if (!consumption.success || !computed.success)
      fail(
        "Se requieren doce meses de consumo confirmados, doce escenarios de facturación y ahorro anual de la revisión seleccionada.",
      );
    else {
      const periods = consumption.data.months.map((m) => m.month).sort(),
        billingPeriods = computed.data.monthlyBilling
          .map((m) => m.month)
          .sort();
      const demandSum = consumption.data.months.reduce(
        (sum, m) => sum + m.kWh,
        0,
      );
      const savingsSum = computed.data.monthlyBilling.reduce(
        (sum, m) => sum + m.savingsMxn,
        0,
      );
      if (
        !consecutiveYear(periods) ||
        !consecutiveYear(billingPeriods) ||
        periods.join(",") !== billingPeriods.join(",")
      )
        fail(
          "Los doce meses de consumo y facturación deben ser consecutivos y corresponder al mismo periodo anual.",
        );
      if (
        Math.abs(demandSum - computed.data.annualKwh) >
          Math.max(0.000001, demandSum * 1e-10) ||
        Math.abs(savingsSum - computed.data.energySavingsMxn) > 0.01 ||
        computed.data.monthlyBilling.some(
          (m) => Math.abs(m.beforeMxn - m.afterMxn - m.savingsMxn) > 0.01,
        )
      )
        fail(
          "Los totales anuales no concilian con los meses de la revisión; recalcular antes de estimar retorno.",
        );
      if (
        Array.isArray(output.warnings) &&
        output.warnings.some((w) => recordObject(w).severity === "BLOCKER")
      )
        fail(
          "La revisión tiene incompatibilidades bloqueantes que requieren corrección antes de estimar retorno.",
        );
      value.periodFrom = periods[0] ?? null;
      value.periodTo = periods.at(-1) ?? null;
      value.annualEnergySavingsMxn = computed.data.energySavingsMxn;
      if (operating !== null && operating >= 0) {
        value.netAnnualSavingsMxn = computed.data.energySavingsMxn - operating;
        if (value.netAnnualSavingsMxn <= 0)
          fail(
            "El ahorro energético anual no supera el costo de operación; no existe retorno simple positivo en este escenario.",
          );
      }
      value.sourceRefs.push(
        ...(Array.isArray(output.sourceRefs)
          ? output.sourceRefs.filter((v): v is string => typeof v === "string")
          : []),
      );
    }
  }
  if (
    !value.missingData.length &&
    investment !== null &&
    value.netAnnualSavingsMxn !== null
  ) {
    const years = investment / value.netAnnualSavingsMxn;
    if (!Number.isFinite(years) || years <= 0)
      fail("El retorno no es finito o positivo; revisar los importes.");
    else {
      value.simplePaybackYears = years;
      value.status = "ESTIMATE";
    }
  }
  value.sourceRefs = [...new Set(value.sourceRefs)];
  value.missingReason = value.missingData.length
    ? value.missingData.join(" ")
    : null;
  return value;
}
