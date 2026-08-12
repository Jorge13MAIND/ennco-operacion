import { describe, expect, it } from "vitest";

import { buildContractualMonthlyReport, selectRecoveryAction, validateRecoveryExperiment } from "@/lib/reporting/monthly";

function julyDays(evidenceClass: "live" | "synthetic_demo" = "live") {
  return Array.from({ length: 31 }, (_, index) => ({
    observedOn: `2026-07-${String(index + 1).padStart(2, "0")}`,
    evidenceClass,
    status: "OPERATING" as const,
  }));
}

const counts = {
  deliveredMessages: 200,
  substantiveReplies: 30,
  positiveReplies: 18,
  emailStrictLeads: 8,
  prequoteStrictLeads: 3,
  heldMeetings: 7,
  qualifiedOpportunities: 5,
  deliveredProposals: 3,
  closedWon: 2,
  firstPaymentsMxn: 500_000,
  clientSlaBreaches: 1,
};

describe("contractual monthly report", () => {
  it("builds a full live calendar month with explicit denominators", () => {
    const report = buildContractualMonthlyReport({
      periodStart: "2026-07-01",
      periodEndExclusive: "2026-08-01",
      generatedAt: "2026-08-03T09:00:00-06:00",
      operationDays: julyDays(),
      counts,
    });
    expect(report.operationalDays).toBe(31);
    expect(report.totalStrictLeads).toBe(11);
    expect(report.targetMet).toBe(true);
    expect(report.replyRatePerDelivered).toBe(0.15);
    expect(report.emailStrictLeadRatePerDelivered).toBe(0.04);
  });

  it("rejects incomplete, synthetic or not-yet-finished periods", () => {
    const base = {
      periodStart: "2026-07-01",
      periodEndExclusive: "2026-08-01",
      generatedAt: "2026-08-03T09:00:00-06:00",
      counts,
    };
    expect(() => buildContractualMonthlyReport({ ...base, operationDays: julyDays().slice(0, 30) })).toThrow("MONTHLY_REPORT_OPERATION_DAYS_INCOMPLETE");
    expect(() => buildContractualMonthlyReport({ ...base, operationDays: julyDays("synthetic_demo") })).toThrow("MONTHLY_REPORT_OPERATION_DAY_NOT_LIVE_PASS");
    expect(() => buildContractualMonthlyReport({ ...base, generatedAt: "2026-07-31T23:59:59Z", operationDays: julyDays() })).toThrow("MONTHLY_REPORT_PERIOD_NOT_COMPLETE");
  });

  it("keeps prequote leads separate from the email reply denominator", () => {
    const report = buildContractualMonthlyReport({
      periodStart: "2026-07-01",
      periodEndExclusive: "2026-08-01",
      generatedAt: "2026-08-01T00:00:00Z",
      operationDays: julyDays(),
      counts: { ...counts, emailStrictLeads: 2, prequoteStrictLeads: 9, positiveReplies: 2 },
    });
    expect(report.totalStrictLeads).toBe(11);
    expect(report.emailStrictLeadRatePerDelivered).toBe(0.01);
  });
});

describe("commercial recovery", () => {
  it("diagnoses in the approved order", () => {
    expect(selectRecoveryAction({
      targetMet: false,
      denominatorsVerified: true,
      deliverabilityVerified: true,
      contactQualityVerified: false,
      clientResponseSlaVerified: false,
      bestSegmentIdentified: false,
      activeExperiment: false,
    })).toBe("FIX_CONTACT_QUALITY");
  });

  it("permits an experiment only after the preceding truths", () => {
    expect(selectRecoveryAction({
      targetMet: false,
      denominatorsVerified: true,
      deliverabilityVerified: true,
      contactQualityVerified: true,
      clientResponseSlaVerified: true,
      bestSegmentIdentified: true,
      activeExperiment: false,
    })).toBe("READY_FOR_ONE_VARIABLE_EXPERIMENT");
  });

  it("validates a bounded single-variable experiment contract", () => {
    expect(() => validateRecoveryExperiment({
      variable: "MESSAGE",
      sampleSize: 25,
      baselineEvidenceSha256: "a".repeat(64),
      hypothesisCode: "SHORTER_CTA_TEST",
    })).not.toThrow();
    expect(() => validateRecoveryExperiment({
      variable: "MESSAGE",
      sampleSize: 101,
      baselineEvidenceSha256: "a".repeat(64),
      hypothesisCode: "SHORTER_CTA_TEST",
    })).toThrow("RECOVERY_EXPERIMENT_SAMPLE_INVALID");
  });
});
