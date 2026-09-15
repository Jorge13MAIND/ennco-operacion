import { z } from "zod";

import type { QuoteInput } from "@/lib/solar/types";

/** Validación de las entradas de una cotización (misma forma que QuoteInput). */
const number = z.coerce.number().finite();
const nonNeg = number.min(0);

export const orientationSchema = z.object({ modules: nonNeg.max(100000), azimuth: number.min(-360).max(360), inclination: nonNeg.max(90).multipleOf(5, "La inclinación va de 5 en 5 grados (Factor K del libro)") });

export const quoteInputSchema = z.object({
  segment: z.enum(["RESIDENTIAL", "COMMERCIAL", "INDUSTRIAL"]),
  customer: z.object({ name: z.string().max(200), subtitle: z.string().max(200).nullable().optional(), supplier: z.string().max(200).nullable().optional() }),
  city: z.string().min(1).max(120),
  period: z.enum(["Mensual", "Bimestral"]),
  summerTariff: z.boolean(),
  currentTariff: z.string().min(1).max(20),
  baseTariff: z.string().max(20).nullable().optional(),
  contractedDemandKw: nonNeg.nullable().optional(),
  periodStartSerial: number.nullable().optional(),
  periodEndSerial: number.nullable().optional(),
  billedMonth: z.coerce.number().int().min(1).max(12),
  meterType: z.string().max(60).nullable().optional(), phases: number.nullable().optional(), voltage: number.nullable().optional(), electricalConfig: z.string().max(120).nullable().optional(),
  annualIncrease: number.min(0).max(1),
  consumptionKwh: z.array(nonNeg).length(12),
  demandKw: z.array(nonNeg).length(12).nullable().optional(),
  kwhBase: nonNeg.optional(), kwhIntermediate: nonNeg.optional(), kwhPeak: nonNeg.optional(), kwhSemiPeak: nonNeg.optional(),
  kwBase: nonNeg.optional(), kwIntermediate: nonNeg.optional(), kwPeak: nonNeg.optional(), kwSemiPeak: nonNeg.optional(),
  kvarh: nonNeg.optional(), targetPowerFactor: number.min(0.5).max(1).nullable().optional(),
  moduleModel: z.string().min(1).max(160),
  orientationCount: number.optional(),
  orientations: z.array(orientationSchema).min(1).max(4),
  mountingSystem: z.string().max(160).nullable().optional(),
  degradation: number.min(0).max(0.2),
  inverters: z.array(z.object({ model: z.string().max(160), quantity: nonNeg.max(1000) })).max(5),
  services: z.array(z.object({ enabled: z.boolean(), concept: z.string().max(160), costMxn: nonNeg })).max(7),
  currency: z.string().max(10).nullable().optional(),
  exchangeRate: number.positive(),
  pricePerWatt: nonNeg,
  utilityFactor: number.min(0).max(5),
  discount: number.min(-5).max(1),
  addIva: z.boolean(),
  taxDeduction: z.boolean(),
  advances: z.array(number.min(0).max(1)).length(4),
  financingBase: nonNeg,
  financing: z.array(z.object({ share: number.min(0).max(1), months: nonNeg.max(600) })).length(3),
  language: z.string().max(20).nullable().optional(),
  structureWarrantyYears: nonNeg.nullable().optional(),
  startTime: z.string().max(80).nullable().optional(), deliveryTime: z.string().max(80).nullable().optional(), validityDays: nonNeg.nullable().optional(),
  generation: z.object({ performanceRatio: number.min(0).max(1).optional(), safetyMargin: number.min(0).max(1).optional(), loss1: number.min(0).max(1).optional(), loss2: number.min(0).max(1).optional() }).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.segment !== "RESIDENTIAL") {
    if (value.periodStartSerial == null || value.periodEndSerial == null || value.periodEndSerial <= value.periodStartSerial) {
      ctx.addIssue({ code: "custom", path: ["periodEndSerial"], message: "Captura inicio y fin del último periodo (el fin debe ser posterior al inicio)." });
    }
  }
  if (value.segment === "INDUSTRIAL" && value.period !== "Mensual") ctx.addIssue({ code: "custom", path: ["period"], message: "El recibo industrial es mensual." });
  if (value.segment === "RESIDENTIAL" && value.currentTariff.toUpperCase() === "DAC" && !value.baseTariff) ctx.addIssue({ code: "custom", path: ["baseTariff"], message: "Con DAC indica la tarifa base (1 a 1F)." });
  value.inverters.forEach((inv, i) => { if (inv.model && inv.quantity < 1) ctx.addIssue({ code: "custom", path: ["inverters", i, "quantity"], message: "La cantidad de inversores debe ser al menos 1." }); });
});

/** El tipo inferido debe poder usarse como QuoteInput (verificación en compilación). */
export type QuoteInputParsed = z.infer<typeof quoteInputSchema>;
const quoteInputCheck = (value: QuoteInputParsed): QuoteInput => value;
void quoteInputCheck;

export const quoteSaveSchema = z.object({
  id: z.uuid().nullable().optional(),
  projectId: z.uuid().nullable().optional(),
  name: z.string().min(1).max(200),
  status: z.enum(["DRAFT", "SENT", "ACCEPTED", "ARCHIVED"]).optional(),
  expectedVersion: z.number().int().positive().nullable().optional(),
  input: quoteInputSchema,
});
export type QuoteSaveInput = z.infer<typeof quoteSaveSchema>;
