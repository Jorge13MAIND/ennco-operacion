import { describe, expect, it } from "vitest";

import { isContractualLead, isQualifiedOpportunity } from "@/lib/domain/qualification";

describe("qualification", () => {
  it("requires all contractual criteria", () => {
    expect(
      isContractualLead({
        industrialOver100Kwp: true,
        outsideAnnexA: true,
        verifiedTargetRole: true,
        explicitInterest: true,
        monthlySpendMxn: null,
        evidenceRecordIds: ["evidence-1"],
      }),
    ).toBe(true);
  });

  it("fails closed when Annex A is ambiguous", () => {
    expect(
      isContractualLead({
        industrialOver100Kwp: true,
        outsideAnnexA: false,
        verifiedTargetRole: true,
        explicitInterest: true,
        monthlySpendMxn: 200_000,
        evidenceRecordIds: ["evidence-1"],
      }),
    ).toBe(false);
  });

  it("does not create pipeline with six of seven forecast fields", () => {
    expect(
      isQualifiedOpportunity({
        economicBuyer: true,
        activePain: true,
        businessImpact: true,
        timingUnder90Days: true,
        valueMxn: 1_000_000,
        nextAction: "Visita técnica",
        nextActionDate: null,
      }),
    ).toBe(false);
  });
});
