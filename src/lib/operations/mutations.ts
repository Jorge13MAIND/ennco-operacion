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
  evidenceRecordIds: z.array(z.uuid()).min(1).max(50),
}).refine((value) => value.explicitInterest || (value.monthlySpendMxn ?? 0) > 20_000, {
  message: "STRICT_INTEREST_OR_SPEND_REQUIRED",
});

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
  valueMxn: z.number().positive().nullable(),
  nextAction: z.string().trim().min(3).max(2_000).nullable(),
  nextActionAt: z.iso.datetime({ offset: true }).nullable(),
});
