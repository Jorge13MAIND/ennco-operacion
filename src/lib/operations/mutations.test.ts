import { describe, expect, it } from "vitest";

import {
  commercialEvidenceSchema,
  firstPaymentSchema,
  meetingOutcomeSchema,
  meetingScheduleSchema,
  opportunityTransitionSchema,
  strictLeadQualificationSchema,
} from "@/lib/operations/mutations";

describe("operation mutation contracts", () => {
  it("rejects a strict lead without all evidence", () => {
    expect(strictLeadQualificationSchema.safeParse({
      industrialOver100Kwp: true,
      outsideAnnexA: true,
      verifiedTargetRole: true,
      explicitInterest: false,
      monthlySpendMxn: 20_000,
      evidenceRecordIds: [],
    }).success).toBe(false);
  });

  it("requires attendance and notes for a held meeting", () => {
    expect(meetingOutcomeSchema.safeParse({
      heldAt: "2026-08-11T20:00:00.000Z",
      attendanceVerified: false,
      outcomeNotes: "Held",
    }).success).toBe(false);
  });

  it("accepts only typed verifiable commercial evidence", () => {
    expect(commercialEvidenceSchema.safeParse({
      criterion: "monthly_spend_mxn",
      value: 25_001,
      sourceUrl: "https://example.invalid/receipt",
      sourceName: "Recibo verificado",
      observedAt: "2026-08-12T12:00:00.000Z",
      confidence: "VERIFIED",
    }).success).toBe(true);
    expect(commercialEvidenceSchema.safeParse({
      criterion: "outside_annex_a",
      value: false,
      sourceUrl: "file:///tmp/annex.pdf",
      sourceName: "Anexo",
      observedAt: "2026-08-12T12:00:00.000Z",
      confidence: "LOW",
    }).success).toBe(false);
  });

  it("accepts a bounded opportunity transition payload", () => {
    expect(opportunityTransitionSchema.safeParse({
      stage: "TECHNICAL_VISIT",
      economicBuyer: true,
      activePain: true,
      businessImpact: true,
      timingUnder90Days: true,
      valueMxn: 1_000_000,
      nextAction: "Programar visita técnica",
      nextActionAt: "2026-08-13T16:00:00.000Z",
    }).success).toBe(true);
  });

  it("requires a typed meeting schedule", () => {
    expect(meetingScheduleSchema.safeParse({ scheduledAt: "2026-08-13T16:00:00.000Z" }).success).toBe(true);
    expect(meetingScheduleSchema.safeParse({ scheduledAt: "tomorrow" }).success).toBe(false);
  });

  it("requires payment evidence observed at or after the payment", () => {
    expect(firstPaymentSchema.safeParse({
      amountMxn: 100_000,
      paidAt: "2026-08-12T12:00:00.000Z",
      observedAt: "2026-08-12T12:05:00.000Z",
      sourceUrl: "https://example.invalid/payment",
      sourceName: "Comprobante bancario",
      confidence: "VERIFIED",
    }).success).toBe(true);
    expect(firstPaymentSchema.safeParse({
      amountMxn: 100_000,
      paidAt: "2026-08-12T12:00:00.000Z",
      observedAt: "2026-08-12T11:59:00.000Z",
      sourceUrl: "https://example.invalid/payment",
      sourceName: "Comprobante bancario",
      confidence: "VERIFIED",
    }).success).toBe(false);
  });
});
