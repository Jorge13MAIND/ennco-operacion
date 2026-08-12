import { describe, expect, it } from "vitest";

import { meetingOutcomeSchema, opportunityTransitionSchema, strictLeadQualificationSchema } from "@/lib/operations/mutations";

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

  it("accepts a bounded opportunity transition payload", () => {
    expect(opportunityTransitionSchema.safeParse({
      stage: "TECHNICAL_VISIT",
      valueMxn: 1_000_000,
      nextAction: "Programar visita técnica",
      nextActionAt: "2026-08-13T16:00:00.000Z",
    }).success).toBe(true);
  });
});
