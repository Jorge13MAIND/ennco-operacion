import type { ForecastQualification, QualificationEvidence } from "@/lib/domain/types";

export function isContractualLead(evidence: QualificationEvidence): boolean {
  const hasInterestOrSpend = evidence.explicitInterest || (evidence.monthlySpendMxn ?? 0) > 20_000;
  return (
    evidence.industrialOver100Kwp &&
    evidence.outsideAnnexA &&
    evidence.verifiedTargetRole &&
    hasInterestOrSpend &&
    evidence.evidenceRecordIds.length > 0
  );
}

export function isQualifiedOpportunity(qualification: ForecastQualification): boolean {
  return (
    qualification.economicBuyer &&
    qualification.activePain &&
    qualification.businessImpact &&
    qualification.timingUnder90Days &&
    (qualification.valueMxn ?? 0) > 0 &&
    Boolean(qualification.nextAction?.trim()) &&
    Boolean(qualification.nextActionDate)
  );
}
