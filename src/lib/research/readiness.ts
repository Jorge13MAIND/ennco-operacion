import {
  REQUIRED_ROLE_CATEGORIES,
  calculateAccountRoleCoverage,
  isTargetRoleCategory,
  type AccountRoleCoverage,
  type ResearchRoleCategory,
  type TargetResearchRoleCategory,
} from "@/lib/research/roles";

export const RESEARCH_ACCOUNT_TARGET = 75;
export const RESEARCH_CONTACT_TARGET = 150;

export type ResearchAccountReadinessRecord = {
  id: string;
  status: "SEED" | "IN_REVIEW" | "VERIFIED" | "QUARANTINED" | "MERGED" | "REJECTED";
  state: "GUANAJUATO" | "QUERETARO" | "OTHER" | "UNKNOWN";
  priorityMarket: "GTO_QRO_FIRST" | "EXPANSION_HOLD";
  evidenceStatus: "COMPLETE" | "INCOMPLETE" | "UNKNOWN";
  dedupeStatus: "CLEAR" | "UNRESOLVED";
  coverageExceptionApproved: boolean;
};

export type ResearchContactReadinessRecord = {
  id: string;
  accountId: string;
  status: "DISCOVERED" | "IN_REVIEW" | "VERIFIED" | "QUARANTINED" | "PROMOTED" | "REJECTED";
  roleCategory: ResearchRoleCategory;
  roleEvidenceStatus: "COMPLETE" | "INCOMPLETE" | "UNKNOWN";
  emailEvidenceStatus: "COMPLETE" | "INCOMPLETE" | "UNKNOWN";
  dedupeStatus: "CLEAR" | "UNRESOLVED";
};

export type ResearchReadinessInput = {
  accounts: readonly ResearchAccountReadinessRecord[];
  contacts: readonly ResearchContactReadinessRecord[];
  annexAState: "RECONCILED" | "MISSING" | "STALE" | "UNKNOWN";
  suppressionState: "READY" | "MISSING" | "UNKNOWN";
};

export type ResearchReadinessResult = {
  decision: "PASS" | "EXTEND" | "KILL";
  commercialAuthorization: "HOLD";
  outreachEligibleRecords: 0;
  verifiedAccounts: number;
  verifiedContacts: number;
  targets: { accounts: 75; contacts: 150 };
  geography: { guanajuato: number; queretaro: number; other: number; unknown: number };
  roleCategoryCounts: Record<TargetResearchRoleCategory, number>;
  roleCoverage: AccountRoleCoverage[];
  accountCoverageGaps: string[];
  reasons: string[];
  commercialBlockers: string[];
};

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

export function evaluateResearchReadiness(input: ResearchReadinessInput): ResearchReadinessResult {
  const killReasons: string[] = [];
  const extendReasons: string[] = [];
  if (duplicateValues(input.accounts.map((account) => account.id)).length > 0) {
    killReasons.push("DUPLICATE_ACCOUNT_ID");
  }
  if (duplicateValues(input.contacts.map((contact) => contact.id)).length > 0) {
    killReasons.push("DUPLICATE_CONTACT_ID");
  }

  const accountIds = new Set(input.accounts.map((account) => account.id));
  if (input.contacts.some((contact) => !accountIds.has(contact.accountId))) {
    killReasons.push("CONTACT_ACCOUNT_NOT_IN_INVENTORY");
  }

  const verifiedAccountCandidates = input.accounts.filter((account) =>
    account.status === "VERIFIED"
    && account.priorityMarket === "GTO_QRO_FIRST"
    && (account.state === "GUANAJUATO" || account.state === "QUERETARO")
    && account.evidenceStatus === "COMPLETE"
    && account.dedupeStatus === "CLEAR"
  );
  const verifiedAccounts = [...new Map(
    verifiedAccountCandidates.map((account) => [account.id, account]),
  ).values()];
  const verifiedAccountIds = new Set(verifiedAccounts.map((account) => account.id));
  const verifiedContacts = input.contacts.filter((contact) =>
    contact.status === "PROMOTED"
    && verifiedAccountIds.has(contact.accountId)
    && isTargetRoleCategory(contact.roleCategory)
    && contact.roleEvidenceStatus === "COMPLETE"
    && contact.emailEvidenceStatus === "COMPLETE"
    && contact.dedupeStatus === "CLEAR"
  );

  const roleCoverage = calculateAccountRoleCoverage(
    verifiedAccounts.map((account) => account.id),
    verifiedContacts.map((contact) => ({
      accountId: contact.accountId,
      category: contact.roleCategory,
      verified: true,
    })),
  );
  const accountById = new Map(verifiedAccounts.map((account) => [account.id, account]));
  const accountCoverageGaps = roleCoverage
    .filter((coverage) => (coverage.verifiedTargetContacts < 2 || coverage.presentCategories.length < 2)
      && accountById.get(coverage.accountId)?.coverageExceptionApproved !== true)
    .map((coverage) => coverage.accountId)
    .sort();

  if (verifiedAccounts.length < RESEARCH_ACCOUNT_TARGET) extendReasons.push("RESEARCH_ACCOUNT_TARGET_NOT_MET");
  if (verifiedContacts.length < RESEARCH_CONTACT_TARGET) extendReasons.push("RESEARCH_CONTACT_TARGET_NOT_MET");
  if (accountCoverageGaps.length > 0) extendReasons.push("ACCOUNT_CONTACT_COVERAGE_INCOMPLETE");
  // El acumulador se deriva de RESEARCH_ROLE_CATEGORIES en vez de enumerarlas a
  // mano: cuando se agrego SAFETY, esta linea era uno de los tres sitios que
  // habia que recordar. Ahora agregar una categoria no exige tocar este archivo.
  const roleCategoryCounts = verifiedContacts.reduce(
    (totals, contact) => {
      // SAFETY suma como contacto valido pero no tiene renglon propio aqui:
      // su ausencia no bloquea (REQUIRED_ROLE_CATEGORIES).
      if (contact.roleCategory in totals) totals[contact.roleCategory as TargetResearchRoleCategory] += 1;
      return totals;
    },
    Object.fromEntries(
      REQUIRED_ROLE_CATEGORIES.map((category) => [category, 0]),
    ) as Record<TargetResearchRoleCategory, number>,
  );
  for (const [category, count] of Object.entries(roleCategoryCounts)) {
    if (count === 0) extendReasons.push(`TARGET_ROLE_CATEGORY_MISSING:${category}`);
  }
  if (input.accounts.some((account) => account.dedupeStatus === "UNRESOLVED")) {
    extendReasons.push("UNRESOLVED_ACCOUNT_DEDUPE");
  }
  if (input.contacts.some((contact) => contact.dedupeStatus === "UNRESOLVED")) {
    extendReasons.push("UNRESOLVED_CONTACT_DEDUPE");
  }
  if (input.accounts.some((account) => account.status === "QUARANTINED")) {
    extendReasons.push("QUARANTINED_ACCOUNT_PRESENT");
  }
  if (input.contacts.some((contact) => contact.status === "QUARANTINED")) {
    extendReasons.push("QUARANTINED_CONTACT_PRESENT");
  }

  const geography = verifiedAccounts.reduce((totals, account) => {
    if (account.state === "GUANAJUATO") totals.guanajuato += 1;
    else if (account.state === "QUERETARO") totals.queretaro += 1;
    else if (account.state === "OTHER") totals.other += 1;
    else totals.unknown += 1;
    return totals;
  }, { guanajuato: 0, queretaro: 0, other: 0, unknown: 0 });

  const commercialBlockers = ["RESEARCH_MODULE_CANNOT_AUTHORIZE_COMMERCIAL_ACTION"];
  if (input.annexAState !== "RECONCILED") commercialBlockers.push(`ANNEX_A_${input.annexAState}`);
  if (input.suppressionState !== "READY") commercialBlockers.push(`SUPPRESSION_${input.suppressionState}`);
  commercialBlockers.push("EXPLICIT_RELEASE_APPROVAL_REQUIRED");

  return {
    decision: killReasons.length > 0 ? "KILL" : extendReasons.length > 0 ? "EXTEND" : "PASS",
    commercialAuthorization: "HOLD",
    outreachEligibleRecords: 0,
    verifiedAccounts: verifiedAccounts.length,
    verifiedContacts: verifiedContacts.length,
    targets: { accounts: RESEARCH_ACCOUNT_TARGET, contacts: RESEARCH_CONTACT_TARGET },
    geography,
    roleCategoryCounts,
    roleCoverage,
    accountCoverageGaps,
    reasons: killReasons.length > 0 ? killReasons : extendReasons,
    commercialBlockers,
  };
}
