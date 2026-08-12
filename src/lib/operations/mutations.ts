import { z } from "zod";

export const uuidSchema = z.uuid();

export const replyReviewSchema = z.object({
  classification: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]),
});

export const strictLeadQualificationSchema = z.object({
  industrialOver100Kwp: z.literal(true),
  outsideAnnexA: z.literal(true),
  verifiedTargetRole: z.literal(true),
  explicitInterest: z.boolean(),
  monthlySpendMxn: z.number().nonnegative().nullable(),
  evidenceRecordIds: z.array(z.uuid()).min(4).max(5),
}).refine((value) => value.explicitInterest || (value.monthlySpendMxn ?? 0) > 20_000, {
  message: "STRICT_INTEREST_OR_SPEND_REQUIRED",
});

export const commercialEvidenceSchema = z.discriminatedUnion("criterion", [
  z.object({
    criterion: z.enum(["industrial_over_100_kwp", "outside_annex_a", "verified_target_role", "explicit_interest"]),
    value: z.literal(true),
    sourceUrl: z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "SOURCE_URL_PROTOCOL_INVALID"),
    sourceName: z.string().trim().min(2).max(200),
    observedAt: z.iso.datetime({ offset: true }),
    confidence: z.enum(["HIGH", "VERIFIED"]),
  }),
  z.object({
    criterion: z.literal("monthly_spend_mxn"),
    value: z.number().gt(20_000).max(1_000_000_000),
    sourceUrl: z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "SOURCE_URL_PROTOCOL_INVALID"),
    sourceName: z.string().trim().min(2).max(200),
    observedAt: z.iso.datetime({ offset: true }),
    confidence: z.enum(["HIGH", "VERIFIED"]),
  }),
]);

export const meetingOutcomeSchema = z.object({
  heldAt: z.iso.datetime({ offset: true }),
  attendanceVerified: z.literal(true),
  outcomeNotes: z.string().trim().min(3).max(10_000),
});

export const opportunityTransitionSchema = z.object({
  stage: z.enum([
    "PROSPECTING", "CONVERSATION", "MEETING_CONFIRMED", "DISCOVERY_HELD", "QUALIFIED",
    "TECHNICAL_VISIT", "PROPOSAL", "DECISION", "CLOSED_WON", "CLOSED_LOST",
  ]),
  economicBuyer: z.boolean(),
  activePain: z.boolean(),
  businessImpact: z.boolean(),
  timingUnder90Days: z.boolean(),
  valueMxn: z.number().positive().nullable(),
  nextAction: z.string().trim().min(3).max(2_000).nullable(),
  nextActionAt: z.iso.datetime({ offset: true }).nullable(),
});

export const meetingScheduleSchema = z.object({
  scheduledAt: z.iso.datetime({ offset: true }),
});

export const firstPaymentSchema = z.object({
  amountMxn: z.number().positive().max(1_000_000_000),
  paidAt: z.iso.datetime({ offset: true }),
  observedAt: z.iso.datetime({ offset: true }),
  sourceUrl: z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "SOURCE_URL_PROTOCOL_INVALID"),
  sourceName: z.string().trim().min(2).max(200),
  confidence: z.enum(["HIGH", "VERIFIED"]),
}).refine((value) => new Date(value.observedAt).getTime() >= new Date(value.paidAt).getTime(), {
  message: "PAYMENT_EVIDENCE_MUST_FOLLOW_PAYMENT",
});

export const capacityScheduleSchema = z.object({
  commandId: z.uuid(),
  executionDate: z.iso.date(),
  changeReason: z.string().trim().min(3).max(500),
});

export const capacityConfigSchema = z.object({
  effectiveFromMonth: z.iso.date().refine((value) => value.endsWith("-01"), "CAPACITY_MONTH_START_REQUIRED"),
  sourceReference: z.string().trim().min(3).max(1_000),
});
