import { describe, expect, it } from "vitest";

import { evaluateReleaseGate, OUTREACH_TOUCH_DAYS } from "@/lib/domain/outreach";

describe("outreach release gate", () => {
  it("freezes the approved eight-touch cadence", () => {
    expect(OUTREACH_TOUCH_DAYS).toEqual([0, 3, 7, 14, 28, 42, 60, 75]);
  });

  it("holds external sending by default", () => {
    const result = evaluateReleaseGate({
      externalSendAllowed: false,
      globalKillSwitch: true,
      manifestApproved: false,
      manifestHashMatches: false,
      suppressionSnapshotCurrent: false,
      mailboxHealthy: false,
      domainReadyDays: 0,
      shadowCanaryDecision: null,
    });
    expect(result.decision).toBe("HOLD");
    expect(result.reasons).toContain("GLOBAL_KILL_SWITCH_ACTIVE");
  });

  it("allows sending only when every gate passes", () => {
    const result = evaluateReleaseGate({
      externalSendAllowed: true,
      globalKillSwitch: false,
      manifestApproved: true,
      manifestHashMatches: true,
      suppressionSnapshotCurrent: true,
      mailboxHealthy: true,
      domainReadyDays: 35,
      shadowCanaryDecision: "PASS",
    });
    expect(result).toEqual({ decision: "SEND_ALLOWED", reasons: [] });
  });
});
