export const RESEARCH_ROLE_CATEGORIES = [
  "CEO",
  "PLANT_DIRECTOR",
  "MAINTENANCE",
  "PROCUREMENT",
  "OTHER",
] as const;

export type ResearchRoleCategory = (typeof RESEARCH_ROLE_CATEGORIES)[number];
export type TargetResearchRoleCategory = Exclude<ResearchRoleCategory, "OTHER">;

const ROLE_PATTERNS: ReadonlyArray<{
  category: TargetResearchRoleCategory;
  patterns: readonly RegExp[];
}> = [
  {
    category: "CEO",
    patterns: [
      /\bceo\b/u,
      /\bchief executive officer\b/u,
      /\bdirector(?:a)? general\b/u,
      /\bgerente general\b/u,
      /\bpresident(?:e|a) ejecutiv(?:o|a)\b/u,
      /\bmanaging director\b/u,
      /\bfounder\b/u,
      /\bfundador(?:a)?\b/u,
      /\bowner\b/u,
      /\bpropietari(?:o|a)\b/u,
      /\bduen(?:o|a)\b/u,
    ],
  },
  {
    category: "PLANT_DIRECTOR",
    patterns: [
      /\bplant (?:director|manager|head)\b/u,
      /\bsite (?:director|manager|head)\b/u,
      /\bdirector(?:a)? de planta\b/u,
      /\bgerente de planta\b/u,
      /\bjef(?:e|a) de planta\b/u,
      /\bdirector(?:a)? de operaciones de planta\b/u,
      /\bgerente de operaciones de planta\b/u,
    ],
  },
  {
    category: "MAINTENANCE",
    patterns: [
      /\bmaintenance\b/u,
      /\bmantenimiento\b/u,
      /\bfacilities (?:director|manager|head)\b/u,
      /\bfacility (?:director|manager|head)\b/u,
      /\bgerente de instalaciones\b/u,
      /\bjef(?:e|a) de instalaciones\b/u,
    ],
  },
  {
    category: "PROCUREMENT",
    patterns: [
      /\bprocurement\b/u,
      /\bpurchasing\b/u,
      /\bcompras\b/u,
      /\badquisiciones\b/u,
      /\bstrategic sourcing\b/u,
      /\bsourcing manager\b/u,
      /\bbuyer\b/u,
      /\bcomprador(?:a)?\b/u,
      /\bsupply chain (?:director|manager|head)\b/u,
    ],
  },
];

export function normalizeRoleTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function classifyRoleTitle(value: string): ResearchRoleCategory {
  const normalized = normalizeRoleTitle(value);
  if (!normalized) return "OTHER";
  for (const definition of ROLE_PATTERNS) {
    if (definition.patterns.some((pattern) => pattern.test(normalized))) return definition.category;
  }
  return "OTHER";
}

export function isTargetRoleCategory(
  category: ResearchRoleCategory,
): category is TargetResearchRoleCategory {
  return category !== "OTHER";
}

export type AccountRoleCoverage = {
  accountId: string;
  verifiedTargetContacts: number;
  presentCategories: TargetResearchRoleCategory[];
  missingCategories: TargetResearchRoleCategory[];
};

export function calculateAccountRoleCoverage(
  accountIds: readonly string[],
  contacts: ReadonlyArray<{
    accountId: string;
    category: ResearchRoleCategory;
    verified: boolean;
  }>,
): AccountRoleCoverage[] {
  const uniqueAccountIds = new Set(accountIds);
  if (uniqueAccountIds.size !== accountIds.length) throw new Error("DUPLICATE_ACCOUNT_ID");

  const categoriesByAccount = new Map<string, Set<TargetResearchRoleCategory>>();
  const contactsByAccount = new Map<string, number>();
  for (const accountId of accountIds) categoriesByAccount.set(accountId, new Set());

  for (const contact of contacts) {
    if (!uniqueAccountIds.has(contact.accountId)) throw new Error("CONTACT_ACCOUNT_NOT_IN_INVENTORY");
    if (!contact.verified || !isTargetRoleCategory(contact.category)) continue;
    categoriesByAccount.get(contact.accountId)?.add(contact.category);
    contactsByAccount.set(contact.accountId, (contactsByAccount.get(contact.accountId) ?? 0) + 1);
  }

  const targetCategories = RESEARCH_ROLE_CATEGORIES.filter(isTargetRoleCategory);
  return accountIds.map((accountId) => {
    const present = categoriesByAccount.get(accountId) ?? new Set<TargetResearchRoleCategory>();
    return {
      accountId,
      verifiedTargetContacts: contactsByAccount.get(accountId) ?? 0,
      presentCategories: targetCategories.filter((category) => present.has(category)),
      missingCategories: targetCategories.filter((category) => !present.has(category)),
    };
  });
}
