import { describe, expect, it } from "vitest";

import { parseResearchPortalReadModel } from "@/lib/research/portal";

const accountId = "11111111-1111-4111-8111-111111111111";
const candidateId = "22222222-2222-4222-8222-222222222222";
const dedupeId = "33333333-3333-4333-8333-333333333333";
const accounts = [{
  id: accountId,
  research_status: "VERIFIED",
  priority_market: "GTO_QRO_FIRST",
  research_state: "GUANAJUATO",
  research_coverage_exception_approved: false,
}];

function assessment(overrides: Record<string, unknown> = {}) {
  return {
    status: "ASSESSED",
    decision: "EXTEND",
    verified_accounts: 1,
    verified_contacts: 0,
    target_accounts: 75,
    target_contacts: 150,
    outreach_state: "RESEARCH_ONLY_HOLD",
    outreach_eligible_records: 0,
    blockers: ["RESEARCH_ACCOUNT_TARGET_NOT_MET"],
    assessment_checksum: "a".repeat(64),
    ...overrides,
  };
}

const candidates = [{
  id: candidateId,
  account_id: accountId,
  role_category: "CEO",
  research_status: "VERIFIED",
  promoted_contact_id: null,
}];
const dedupeCases = [{
  id: dedupeId,
  subject_type: "ACCOUNT",
  source_record_id: null,
  candidate_account_id: accountId,
  matched_account_id: null,
  candidate_contact_id: null,
  matched_candidate_id: null,
  status: "RESOLVED",
}];

describe("research portal read model", () => {
  it("accepts a strict HOLD assessment", () => {
    const result = parseResearchPortalReadModel({
      accountsAvailable: true,
      accountsData: accounts,
      accountsCount: accounts.length,
      candidatesAvailable: true,
      candidatesData: candidates,
      candidatesCount: candidates.length,
      dedupeAvailable: true,
      dedupeData: dedupeCases,
      dedupeCount: dedupeCases.length,
      assessmentAvailable: true,
      assessmentData: assessment(),
    });
    expect(result.inventoryReady).toBe(true);
    expect(result.assessment?.outreach_eligible_records).toBe(0);
  });

  it("degrades the whole research module when one dependency is unavailable", () => {
    const result = parseResearchPortalReadModel({
      accountsAvailable: false,
      accountsData: accounts,
      accountsCount: accounts.length,
      candidatesAvailable: false,
      candidatesData: candidates,
      candidatesCount: candidates.length,
      dedupeAvailable: true,
      dedupeData: dedupeCases,
      dedupeCount: dedupeCases.length,
      assessmentAvailable: true,
      assessmentData: assessment(),
    });
    expect(result).toMatchObject({
      inventoryReady: false,
      assessment: null,
      reasonCode: "RESEARCH_READ_MODEL_UNAVAILABLE",
    });
  });

  it("rejects drift that could make research look commercially eligible", () => {
    for (const drift of [
      { outreach_state: "READY" },
      { outreach_eligible_records: 1 },
      { target_accounts: 74 },
      { unknown_field: true },
    ]) {
      const result = parseResearchPortalReadModel({
        accountsAvailable: true,
        accountsData: accounts,
        accountsCount: accounts.length,
        candidatesAvailable: true,
        candidatesData: candidates,
        candidatesCount: candidates.length,
        dedupeAvailable: true,
        dedupeData: dedupeCases,
        dedupeCount: dedupeCases.length,
        assessmentAvailable: true,
        assessmentData: assessment(drift),
      });
      expect(result.inventoryReady).toBe(false);
    }
  });

  it("rejects a false PASS below target or with blockers", () => {
    const result = parseResearchPortalReadModel({
      accountsAvailable: true,
      accountsData: accounts,
      accountsCount: accounts.length,
      candidatesAvailable: true,
      candidatesData: candidates,
      candidatesCount: candidates.length,
      dedupeAvailable: true,
      dedupeData: dedupeCases,
      dedupeCount: dedupeCases.length,
      assessmentAvailable: true,
      assessmentData: assessment({ decision: "PASS" }),
    });
    expect(result.inventoryReady).toBe(false);
    expect(result.reasonCode).toBe("RESEARCH_READ_MODEL_INVALID");
  });

  it("rejects duplicate row identities", () => {
    const result = parseResearchPortalReadModel({
      accountsAvailable: true,
      accountsData: accounts,
      accountsCount: accounts.length,
      candidatesAvailable: true,
      candidatesData: [...candidates, ...candidates],
      candidatesCount: candidates.length * 2,
      dedupeAvailable: true,
      dedupeData: dedupeCases,
      dedupeCount: dedupeCases.length,
      assessmentAvailable: true,
      assessmentData: assessment(),
    });
    expect(result.inventoryReady).toBe(false);
  });

  it("rejects a truncated candidate or dedupe inventory", () => {
    const result = parseResearchPortalReadModel({
      accountsAvailable: true,
      accountsData: accounts,
      accountsCount: accounts.length,
      candidatesAvailable: true,
      candidatesData: candidates,
      candidatesCount: candidates.length + 1,
      dedupeAvailable: true,
      dedupeData: dedupeCases,
      dedupeCount: dedupeCases.length,
      assessmentAvailable: true,
      assessmentData: assessment(),
    });
    expect(result.inventoryReady).toBe(false);
    expect(result.reasonCode).toBe("RESEARCH_READ_MODEL_INVALID");
  });

  it("rejects a false PASS assessment that is not bound to the validated inventory", () => {
    const promoted = [{
      ...candidates[0]!,
      research_status: "PROMOTED",
      promoted_contact_id: "44444444-4444-4444-8444-444444444444",
    }];
    const result = parseResearchPortalReadModel({
      accountsAvailable: true,
      accountsData: accounts,
      accountsCount: accounts.length,
      candidatesAvailable: true,
      candidatesData: promoted,
      candidatesCount: promoted.length,
      dedupeAvailable: true,
      dedupeData: dedupeCases,
      dedupeCount: dedupeCases.length,
      assessmentAvailable: true,
      assessmentData: assessment({
        decision: "PASS",
        verified_accounts: 75,
        verified_contacts: 150,
        blockers: [],
      }),
    });
    expect(result.inventoryReady).toBe(false);
    expect(result.reasonCode).toBe("RESEARCH_READ_MODEL_INCONSISTENT");
  });

  it("allows research PASS with only commercial blockers while keeping outreach HOLD", () => {
    const passAccounts = Array.from({ length: 75 }, (_, index) => ({
      ...accounts[0]!,
      id: `00000001-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    }));
    const passCandidates = passAccounts.flatMap((account, index) => [0, 1].map((offset) => ({
      ...candidates[0]!,
      id: `00000002-0000-4000-8000-${String(index * 2 + offset + 1).padStart(12, "0")}`,
      account_id: account.id,
      research_status: "PROMOTED",
      promoted_contact_id: `00000003-0000-4000-8000-${String(index * 2 + offset + 1).padStart(12, "0")}`,
    })));
    const result = parseResearchPortalReadModel({
      accountsAvailable: true,
      accountsData: passAccounts,
      accountsCount: passAccounts.length,
      candidatesAvailable: true,
      candidatesData: passCandidates,
      candidatesCount: passCandidates.length,
      dedupeAvailable: true,
      dedupeData: [],
      dedupeCount: 0,
      assessmentAvailable: true,
      assessmentData: assessment({
        decision: "PASS",
        verified_accounts: 75,
        verified_contacts: 150,
        target_accounts: 75,
        target_contacts: 150,
        blockers: ["ANNEX_A_UNKNOWN", "EXPLICIT_RELEASE_APPROVAL_REQUIRED"],
      }),
    });
    expect(result.inventoryReady).toBe(true);
    expect(result.assessment).toMatchObject({
      decision: "PASS",
      outreach_state: "RESEARCH_ONLY_HOLD",
      outreach_eligible_records: 0,
    });
  });

  it("rejects orphan candidates and invalid promoted bindings", () => {
    for (const drift of [
      { ...candidates[0]!, account_id: "55555555-5555-4555-8555-555555555555" },
      { ...candidates[0]!, research_status: "PROMOTED", promoted_contact_id: null },
    ]) {
      const result = parseResearchPortalReadModel({
        accountsAvailable: true,
        accountsData: accounts,
        accountsCount: accounts.length,
        candidatesAvailable: true,
        candidatesData: [drift],
        candidatesCount: 1,
        dedupeAvailable: true,
        dedupeData: dedupeCases,
        dedupeCount: dedupeCases.length,
        assessmentAvailable: true,
        assessmentData: assessment(),
      });
      expect(result.inventoryReady).toBe(false);
    }
  });

  it("does not treat verified expansion accounts as part of the GTO and QRO target", () => {
    const expansionAccount = {
      ...accounts[0]!,
      id: "66666666-6666-4666-8666-666666666666",
      priority_market: "EXPANSION_HOLD",
      research_state: "OTHER",
    };
    const result = parseResearchPortalReadModel({
      accountsAvailable: true,
      accountsData: [...accounts, expansionAccount],
      accountsCount: 2,
      candidatesAvailable: true,
      candidatesData: candidates,
      candidatesCount: candidates.length,
      dedupeAvailable: true,
      dedupeData: dedupeCases,
      dedupeCount: dedupeCases.length,
      assessmentAvailable: true,
      assessmentData: assessment(),
    });
    expect(result.inventoryReady).toBe(true);
    expect(result.assessment?.verified_accounts).toBe(1);
  });
});
