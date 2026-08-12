import { describe, expect, it } from "vitest";

import {
  evaluateResearchReadiness,
  type ResearchAccountReadinessRecord,
  type ResearchContactReadinessRecord,
} from "@/lib/research/readiness";

function syntheticId(prefix: "a" | "c", index: number): string {
  return `${prefix}-${String(index).padStart(4, "0")}`;
}

function validAccounts(count = 75): ResearchAccountReadinessRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: syntheticId("a", index),
    status: "VERIFIED",
    state: index % 2 === 0 ? "GUANAJUATO" : "QUERETARO",
    priorityMarket: "GTO_QRO_FIRST",
    evidenceStatus: "COMPLETE",
    dedupeStatus: "CLEAR",
    coverageExceptionApproved: false,
  }));
}

function validContacts(accounts: readonly ResearchAccountReadinessRecord[]): ResearchContactReadinessRecord[] {
  const secondaryRoles = ["PLANT_DIRECTOR", "MAINTENANCE", "PROCUREMENT"] as const;
  return accounts.flatMap((account, index) => [
    {
      id: syntheticId("c", index * 2),
      accountId: account.id,
      status: "PROMOTED" as const,
      roleCategory: "CEO" as const,
      roleEvidenceStatus: "COMPLETE" as const,
      emailEvidenceStatus: "COMPLETE" as const,
      dedupeStatus: "CLEAR" as const,
    },
    {
      id: syntheticId("c", index * 2 + 1),
      accountId: account.id,
      status: "PROMOTED" as const,
      roleCategory: secondaryRoles[index % secondaryRoles.length]!,
      roleEvidenceStatus: "COMPLETE" as const,
      emailEvidenceStatus: "COMPLETE" as const,
      dedupeStatus: "CLEAR" as const,
    },
  ]);
}

describe("75/150 research readiness", () => {
  it("returns research PASS but always keeps commercial authorization on HOLD", () => {
    const accounts = validAccounts();
    const result = evaluateResearchReadiness({
      accounts,
      contacts: validContacts(accounts),
      annexAState: "RECONCILED",
      suppressionState: "READY",
    });
    expect(result).toMatchObject({
      decision: "PASS",
      commercialAuthorization: "HOLD",
      outreachEligibleRecords: 0,
      verifiedAccounts: 75,
      verifiedContacts: 150,
      reasons: [],
    });
    expect(result.commercialBlockers).toContain("RESEARCH_MODULE_CANNOT_AUTHORIZE_COMMERCIAL_ACTION");
    expect(result.commercialBlockers).toContain("EXPLICIT_RELEASE_APPROVAL_REQUIRED");
  });

  it("does not turn missing Annex A or suppression into authorization", () => {
    const accounts = validAccounts();
    const result = evaluateResearchReadiness({
      accounts,
      contacts: validContacts(accounts),
      annexAState: "MISSING",
      suppressionState: "UNKNOWN",
    });
    expect(result.decision).toBe("PASS");
    expect(result.commercialAuthorization).toBe("HOLD");
    expect(result.commercialBlockers).toEqual(expect.arrayContaining(["ANNEX_A_MISSING", "SUPPRESSION_UNKNOWN"]));
  });

  it("extends at 74 companies even when 150 contacts exist", () => {
    const accounts = validAccounts(74);
    const contacts = validContacts(accounts);
    contacts.push({ ...contacts[0]!, id: "c-extra-0001" }, { ...contacts[1]!, id: "c-extra-0002" });
    const result = evaluateResearchReadiness({ accounts, contacts, annexAState: "MISSING", suppressionState: "UNKNOWN" });
    expect(result.verifiedAccounts).toBe(74);
    expect(result.verifiedContacts).toBe(150);
    expect(result.decision).toBe("EXTEND");
    expect(result.reasons).toContain("RESEARCH_ACCOUNT_TARGET_NOT_MET");
  });

  it("extends at 149 contacts and exposes the uncovered account", () => {
    const accounts = validAccounts();
    const contacts = validContacts(accounts).slice(0, 149);
    const result = evaluateResearchReadiness({ accounts, contacts, annexAState: "RECONCILED", suppressionState: "READY" });
    expect(result.verifiedContacts).toBe(149);
    expect(result.decision).toBe("EXTEND");
    expect(result.reasons).toEqual(expect.arrayContaining([
      "RESEARCH_CONTACT_TARGET_NOT_MET",
      "ACCOUNT_CONTACT_COVERAGE_INCOMPLETE",
    ]));
    expect(result.accountCoverageGaps).toHaveLength(1);
  });

  it("does not count expansion, unknown evidence or OTHER roles", () => {
    const accounts = validAccounts();
    accounts[0] = { ...accounts[0]!, priorityMarket: "EXPANSION_HOLD", state: "OTHER" };
    const contacts = validContacts(accounts);
    contacts[2] = { ...contacts[2]!, roleCategory: "OTHER" };
    const result = evaluateResearchReadiness({ accounts, contacts, annexAState: "RECONCILED", suppressionState: "READY" });
    expect(result.verifiedAccounts).toBe(74);
    expect(result.verifiedContacts).toBe(147);
    expect(result.decision).toBe("EXTEND");
  });

  it("requires two distinct target role categories per account unless an exception is approved", () => {
    const accounts = validAccounts();
    const contacts = validContacts(accounts);
    contacts[1] = { ...contacts[1]!, roleCategory: "CEO" };
    let result = evaluateResearchReadiness({ accounts, contacts, annexAState: "RECONCILED", suppressionState: "READY" });
    expect(result.decision).toBe("EXTEND");
    expect(result.accountCoverageGaps).toEqual([accounts[0]!.id]);

    accounts[0] = { ...accounts[0]!, coverageExceptionApproved: true };
    result = evaluateResearchReadiness({ accounts, contacts, annexAState: "RECONCILED", suppressionState: "READY" });
    expect(result.decision).toBe("PASS");
  });

  it("kills structurally ambiguous duplicate IDs and orphan contacts", () => {
    const accounts = validAccounts();
    const contacts = validContacts(accounts);
    const duplicatedAccounts = [...accounts, accounts[0]!];
    contacts.push({ ...contacts[0]!, id: "c-orphan-0001", accountId: "account-not-present" });
    const result = evaluateResearchReadiness({
      accounts: duplicatedAccounts,
      contacts,
      annexAState: "UNKNOWN",
      suppressionState: "UNKNOWN",
    });
    expect(result.decision).toBe("KILL");
    expect(result.reasons).toEqual(expect.arrayContaining(["DUPLICATE_ACCOUNT_ID", "CONTACT_ACCOUNT_NOT_IN_INVENTORY"]));
    expect(result.commercialAuthorization).toBe("HOLD");
  });

  it("extends for unresolved dedupe or quarantined records", () => {
    const accounts = validAccounts();
    accounts[0] = { ...accounts[0]!, dedupeStatus: "UNRESOLVED" };
    accounts[1] = { ...accounts[1]!, status: "QUARANTINED" };
    const contacts = validContacts(accounts);
    contacts[0] = { ...contacts[0]!, status: "QUARANTINED" };
    contacts[1] = { ...contacts[1]!, dedupeStatus: "UNRESOLVED" };
    const result = evaluateResearchReadiness({ accounts, contacts, annexAState: "RECONCILED", suppressionState: "READY" });
    expect(result.decision).toBe("EXTEND");
    expect(result.reasons).toEqual(expect.arrayContaining([
      "UNRESOLVED_ACCOUNT_DEDUPE",
      "UNRESOLVED_CONTACT_DEDUPE",
      "QUARANTINED_ACCOUNT_PRESENT",
      "QUARANTINED_CONTACT_PRESENT",
    ]));
  });
});
