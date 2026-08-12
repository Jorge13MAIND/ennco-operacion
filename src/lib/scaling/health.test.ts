import { describe, expect, it } from "vitest";

import { calculateT0, evaluateScalingHealth, requiredDeliveredContacts } from "@/lib/scaling/health";

const cleanLive = {
  evidenceClass: "live" as const,
  deliveredCount: 5,
  hardBounceCount: 0,
  spamComplaintCount: 0,
  unsubscribeCount: 0,
  duplicateDeliveryCount: 0,
  suppressionViolationCount: 0,
  unknownCount: 0,
  openP0: 0,
  openP1: 0,
  replySyncP95Seconds: 120,
  observationHours: 24,
  plannedNextVolume: 10,
};

describe("controlled scaling health", () => {
  it("passes a clean live 24-hour observation and caps the next wave", () => {
    expect(evaluateScalingHealth(cleanLive)).toEqual({
      decision: "PASS",
      nextMaximumVolume: 10,
      reasons: [],
    });
  });

  it("never promotes synthetic evidence", () => {
    expect(evaluateScalingHealth({ ...cleanLive, evidenceClass: "synthetic_demo" }).decision).toBe("EXTEND");
  });

  it("kills on complaint, duplicate, suppression violation or P0", () => {
    const result = evaluateScalingHealth({
      ...cleanLive,
      spamComplaintCount: 1,
      duplicateDeliveryCount: 1,
      suppressionViolationCount: 1,
      openP0: 1,
    });
    expect(result.decision).toBe("KILL");
    expect(result.reasons).toHaveLength(4);
  });

  it("extends for insufficient observation, bounce, unknown, P1, lag or excess volume", () => {
    const result = evaluateScalingHealth({
      ...cleanLive,
      observationHours: 23.99,
      hardBounceCount: 1,
      unknownCount: 1,
      openP1: 1,
      replySyncP95Seconds: 301,
      plannedNextVolume: 11,
    });
    expect(result.decision).toBe("EXTEND");
    expect(result.reasons).toContain("NEXT_VOLUME_EXCEEDS_RAMP_LIMIT");
  });
});

describe("T0 commercial baseline", () => {
  it("refuses fewer than 100 valid first deliveries", () => {
    expect(() => calculateT0({
      validFirstDeliveries: 99,
      substantiveReplies: 5,
      positiveReplies: 3,
      strictLeads: 2,
      heldMeetings: 1,
      qualifiedOpportunities: 1,
    })).toThrow("T0_REQUIRES_100_VALID_FIRST_DELIVERIES");
  });

  it("calculates rates with explicit denominators", () => {
    const result = calculateT0({
      validFirstDeliveries: 100,
      substantiveReplies: 10,
      positiveReplies: 6,
      strictLeads: 4,
      heldMeetings: 3,
      qualifiedOpportunities: 2,
    });
    expect(result.replyRate).toBe(0.1);
    expect(result.positiveReplyRate).toBe(0.06);
    expect(result.strictLeadRate).toBe(0.04);
    expect(result.heldMeetingPerLeadRate).toBe(0.75);
    expect(result.opportunityPerMeetingRate).toBeCloseTo(2 / 3);
    expect(requiredDeliveredContacts(10, result.strictLeadRate)).toBe(250);
  });

  it("does not invent a contact requirement when the observed strict lead rate is zero", () => {
    expect(requiredDeliveredContacts(10, 0)).toBeNull();
  });
});
