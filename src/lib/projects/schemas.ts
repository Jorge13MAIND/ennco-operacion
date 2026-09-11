import { z } from "zod";
import {
  COST_CATEGORIES,
  DOCUMENT_SECTIONS,
  PROJECT_SEGMENTS,
  PROJECT_STAGES,
  RECORD_KINDS,
  type JsonRecord,
  type RecordKind,
} from "./types";

const text = z.string().trim().min(1).max(5000);
const short = z.string().trim().min(1).max(250);
const optionalText = z.string().trim().max(5000).optional();
const id = z.uuid();
export const moneySchema = z
  .number()
  .finite()
  .nonnegative()
  .max(1e11)
  .refine(
    (v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.001,
    "Usa como máximo dos decimales.",
  );
const money = moneySchema;
const signedMoney = z
  .number()
  .finite()
  .min(-1e11)
  .max(1e11)
  .refine(
    (v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.001,
    "Usa como máximo dos decimales.",
  );
const date = z.iso.date();
const number = z.number().finite().nonnegative().max(1e9);
const positive = number.positive();
const evidence = z.string().trim().min(3).max(3000);
const category = z.enum(COST_CATEGORIES);
const checks = z
  .record(z.string().min(1).max(100), z.boolean())
  .refine((v) => Object.keys(v).length <= 50);
const line = z
  .object({
    category,
    description: short,
    quantity: positive,
    unitCostMxn: money,
  })
  .strict();
const amounts = { subtotalMxn: money, vatMxn: money, totalMxn: money };
const amountCheck = (v: {
  subtotalMxn: number;
  vatMxn: number;
  totalMxn: number;
}) =>
  Math.round(v.subtotalMxn * 100) + Math.round(v.vatMxn * 100) ===
  Math.round(v.totalMxn * 100);
const metadata = z
  .object({
    accountId: id.nullable().optional(),
    opportunityId: id.nullable().optional(),
    ownerName: z.string().max(200).optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    dueDate: date.nullable().optional(),
  })
  .strict();
export const createProjectSchema = z
  .object({
    name: short,
    segment: z.enum(PROJECT_SEGMENTS),
    customerName: short,
    contactName: z.string().max(200).optional(),
    email: z.union([z.email(), z.literal("")]).optional(),
    phone: z.string().max(60).optional(),
    location: z.string().max(1000).optional(),
    scope: optionalText,
    data: metadata.optional(),
  })
  .strict();
export const updateProjectSchema = createProjectSchema
  .omit({ segment: true })
  .partial()
  .extend({
    stage: z.enum(PROJECT_STAGES).optional(),
    lifecycle: z.enum(["ACTIVE", "PAUSED", "CANCELLED", "LOST"]).optional(),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export const appendRecordSchema = z
  .object({
    kind: z.enum(RECORD_KINDS),
    expectedVersion: z.number().int().positive(),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();
export const catalogSchema = z
  .object({
    id: id.optional(),
    category: short,
    name: short,
    version: z.number().int().positive(),
    data: z.record(z.string(), z.unknown()),
    sourceUrl: z.url().max(2000),
    sourceDate: date,
    status: z.enum(["DRAFT", "APPROVED", "RETIRED"]),
  })
  .strict();

const schemas: Partial<Record<RecordKind, z.ZodType>> = {
  receipt: z
    .object({
      documentId: id.optional(),
      periodStart: date,
      periodEnd: date,
      kWh: number,
      amountMxn: money.optional(),
      demandKw: number.optional(),
      reactiveKvarh: number.optional(),
      tariff: short,
      confirmed: z.boolean(),
      source: z.enum(["MANUAL", "PDF", "OCR"]),
      notes: optionalText,
    })
    .strict()
    .refine((v) => v.periodStart <= v.periodEnd, "El periodo está invertido."),
  survey: z
    .object({
      scheduledDate: date.optional(),
      completedDate: date.optional(),
      responsible: short,
      voltage: positive,
      phases: z.number().int().min(1).max(3),
      transformerKva: positive.optional(),
      roofType: short,
      availableAreaM2: positive.optional(),
      acLengthM: number.optional(),
      dcLengthM: number.optional(),
      checks,
      notes: z.string().max(10000),
      evidenceIds: z.array(id).max(100),
    })
    .strict(),
  technical_review: z
    .object({
      calculationId: id,
      decision: z.enum(["APPROVED", "REJECTED"]),
      notes: text,
      evidence,
      reviewedSections: z.array(short).min(1).max(30),
    })
    .strict(),
  proposal: z
    .object({
      name: short,
      calculationId: id.optional(),
      pricingMethod: z.enum(["USD_PER_WATT", "COST_PLUS_MARGIN"]),
      capacityWp: positive,
      usdPerWatt: positive.optional(),
      exchangeRate: positive.optional(),
      exchangeRateSource: z
        .object({
          catalogId: id,
          version: z.number().int().positive(),
          sourceUrl: z.url().max(2000),
          sourceDate: date,
        })
        .strict()
        .optional(),
      marginPct: z.number().min(0).max(99).optional(),
      discountPct: z.number().min(0).max(100),
      vatPct: z.number().min(0).max(100),
      annualOperatingCostMxn: money.optional(),
      costLines: z.array(line).min(1).max(500),
      validUntil: date,
      conditions: text,
      notes: optionalText,
    })
    .strict()
    .superRefine((v, c) => {
      if (
        v.pricingMethod === "USD_PER_WATT" &&
        (!v.usdPerWatt || !v.exchangeRate)
      )
        c.addIssue({
          code: "custom",
          message: "Precio USD/W y tipo de cambio obligatorios.",
        });
      if (v.pricingMethod === "COST_PLUS_MARGIN" && v.marginPct === undefined)
        c.addIssue({
          code: "custom",
          message: "Define el margen sobre venta.",
        });
    }),
  proposal_acceptance: z
    .object({ proposalId: id, acceptedAt: date, customerEvidence: evidence })
    .strict(),
  budget: z
    .object({
      name: short,
      proposalId: id.optional(),
      lines: z
        .array(
          z.object({ category, description: short, amountMxn: money }).strict(),
        )
        .min(1)
        .max(500),
      reason: text,
      approved: z.boolean(),
      includedChangeOrderIds: z.array(id).max(100).default([]),
    })
    .strict(),
  contract: z
    .object({
      proposalId: id,
      acceptanceId: id.optional(),
      documentId: id.optional(),
      evidence,
      scope: text,
      legalDetails: z
        .object({
          legalNameEnnco: optionalText,
          enncoRfc: optionalText,
          enncoAddress: optionalText,
          enncoRepresentative: optionalText,
          customerLegalName: optionalText,
          customerRfc: optionalText,
          customerAddress: optionalText,
          customerRepresentative: optionalText,
          jurisdiction: optionalText,
          workmanshipWarranty: optionalText,
          equipmentWarranty: optionalText,
          scopeExclusions: optionalText,
        })
        .strict()
        .optional(),
      ...amounts,
      advanceAmountMxn: money,
      startDate: date.optional(),
      durationDays: z.number().int().positive().max(10000).optional(),
      schedule: z
        .array(
          z
            .object({
              id: short,
              label: short,
              amountMxn: money.positive(),
              dueDate: date,
              condition: optionalText,
            })
            .strict(),
        )
        .min(1)
        .max(100),
      terms: text,
      warranties: text,
    })
    .strict()
    .refine(amountCheck, "Subtotal + IVA debe coincidir con el total.")
    .refine(
      (v) => v.advanceAmountMxn <= v.totalMxn,
      "El anticipo no puede superar el contrato.",
    )
    .refine(
      (v) =>
        v.schedule.reduce((s, x) => s + Math.round(x.amountMxn * 100), 0) ===
        Math.round(v.totalMxn * 100),
      "Las parcialidades deben sumar el total.",
    )
    .refine(
      (v) => new Set(v.schedule.map((x) => x.id)).size === v.schedule.length,
      "Las parcialidades deben ser únicas.",
    ),
  payment_schedule: z
    .object({
      contractId: id,
      schedule: z
        .array(
          z
            .object({
              id: short,
              label: short,
              amountMxn: money.positive(),
              dueDate: date,
              condition: optionalText,
            })
            .strict(),
        )
        .min(1)
        .max(100),
      reason: text,
      evidence,
    })
    .strict()
    .refine(
      (v) => new Set(v.schedule.map((a) => a.id)).size === v.schedule.length,
      "Las parcialidades deben ser únicas.",
    ),
  customer_payment_allocation: z
    .object({
      paymentId: id,
      allocations: z
        .array(
          z.object({ scheduleId: short, amountMxn: money.positive() }).strict(),
        )
        .min(1)
        .max(100),
      reason: text,
      evidence,
    })
    .strict()
    .refine(
      (v) =>
        new Set(v.allocations.map((a) => a.scheduleId)).size ===
        v.allocations.length,
      "Las parcialidades deben ser únicas.",
    ),
  customer_invoice: z
    .object({ contractId: id, number: short, date, ...amounts, evidence })
    .strict()
    .refine(amountCheck, "Subtotal + IVA debe coincidir con el total."),
  customer_payment: z
    .object({
      contractId: id,
      invoiceId: id.optional(),
      scheduleId: short.optional(),
      amountMxn: money.positive(),
      paidAt: date,
      method: short,
      reference: short,
      evidence,
      confirmed: z.boolean(),
    })
    .strict(),
  supplier_quote: z
    .object({
      supplier: short,
      description: short,
      category,
      quantity: positive,
      unit: short,
      unitCostMxn: money,
      vatPct: z.number().min(0).max(100),
      totalMxn: money.optional(),
      validUntil: date,
      deliveryDate: date.optional(),
      warranty: optionalText,
      evidence,
    })
    .strict(),
  purchase_order: z
    .object({
      supplier: short,
      reference: short,
      quoteId: id.optional(),
      major: z.boolean(),
      deliveryDate: date,
      lines: z
        .array(line.extend({ id: short, unit: short }))
        .min(1)
        .max(500),
      ...amounts,
      evidence,
      notes: optionalText,
    })
    .strict()
    .refine(amountCheck, "Subtotal + IVA debe coincidir con el total.")
    .refine(
      (v) =>
        v.lines.reduce(
          (s, x) => s + Math.round(x.quantity * x.unitCostMxn * 100),
          0,
        ) === Math.round(v.subtotalMxn * 100),
      "Las partidas deben sumar el subtotal.",
    )
    .refine(
      (v) => new Set(v.lines.map((x) => x.id)).size === v.lines.length,
      "Las partidas deben ser únicas.",
    ),
  material_receipt: z
    .object({
      purchaseOrderId: id,
      receivedAt: date,
      lines: z
        .array(z.object({ lineId: short, quantity: positive }).strict())
        .min(1)
        .max(500),
      evidence,
      notes: optionalText,
    })
    .strict()
    .refine(
      (v) => new Set(v.lines.map((x) => x.lineId)).size === v.lines.length,
      "Las partidas deben ser únicas.",
    ),
  expense: z
    .object({
      purchaseOrderId: id.optional(),
      supplier: short,
      invoiceNumber: short,
      date,
      category,
      description: text,
      ...amounts,
      costBasisMxn: money,
      dueDate: date.optional(),
      evidence,
    })
    .strict()
    .refine(amountCheck, "Subtotal + IVA debe coincidir con el total.")
    .refine(
      (v) => v.costBasisMxn >= v.subtotalMxn && v.costBasisMxn <= v.totalMxn,
      "El costo reconocido debe estar entre subtotal y total.",
    ),
  supplier_payment: z
    .object({
      expenseId: id,
      amountMxn: money.positive(),
      paidAt: date,
      method: short,
      reference: short,
      evidence,
    })
    .strict(),
  purchase_exception: z.object({ reason: text, evidence }).strict(),
  progress: z
    .object({
      date,
      responsible: short,
      percent: z.number().min(0).max(100),
      description: text,
      evidence,
      incidents: optionalText,
    })
    .strict(),
  change_order: z
    .object({
      description: text,
      reason: text,
      saleDeltaMxn: signedMoney,
      saleVatDeltaMxn: signedMoney.default(0),
      costDeltaMxn: signedMoney,
      timeDeltaDays: z.number().int().min(-10000).max(10000),
      evidence,
    })
    .strict(),
  change_approval: z
    .object({
      changeOrderId: id,
      decision: z.enum(["APPROVED", "REJECTED"]),
      evidence,
      notes: text,
    })
    .strict(),
  document: z
    .object({
      name: short,
      section: z.enum(DOCUMENT_SECTIONS),
      mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
      size: z
        .number()
        .int()
        .positive()
        .max(10 * 1024 * 1024),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      driveFileId: short.optional(),
      driveUrl: z.url().optional(),
      status: z.enum(["PENDING", "SYNCED", "ERROR"]),
      revisionId: id.optional(),
      visibility: z.enum(["TEAM", "ADMIN", "PURCHASES"]),
      error: optionalText,
      storagePath: z.string().max(1000).optional(),
      supersedes: id.optional(),
    })
    .strict(),
  technical_closure: z
    .object({ checks, evidence, notes: text })
    .strict()
    .refine(
      (v) =>
        Object.keys(v.checks).length >= 3 &&
        Object.values(v.checks).every(Boolean),
      "Completa todas las verificaciones técnicas.",
    ),
  financial_closure: z
    .object({ evidence, notes: text, exceptionReason: optionalText })
    .strict(),
  reversal: z.object({ recordId: id, reason: text, evidence }).strict(),
  note: z.object({ text }).strict(),
  source_review: z
    .object({
      sourceId: short,
      version: short,
      decision: z.enum(["APPROVED", "REJECTED"]),
      notes: text,
      evidence,
    })
    .strict(),
};
export function parseRecordData(
  kind: RecordKind,
  data: JsonRecord,
): JsonRecord {
  const schema = schemas[kind];
  if (!schema) throw new Error("USE_CALCULATION_ENDPOINT");
  return schema.parse(data) as JsonRecord;
}
