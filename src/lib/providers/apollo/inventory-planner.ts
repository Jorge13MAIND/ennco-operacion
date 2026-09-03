import { createHash } from "node:crypto";
import { z } from "zod";

import {
  classifyRoleTitle,
  isTargetRoleCategory,
  type TargetResearchRoleCategory,
} from "@/lib/research/roles";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const domainSchema = z.string().trim().toLowerCase().min(3).max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u);
const normalizedEmailSchema = z.email().transform((value) => value.trim().toLowerCase());

const accountSchema = z.object({
  canonicalId: z.string().trim().min(1).max(200),
  legalName: z.string().trim().min(2).max(300),
  primaryDomain: domainSchema,
  state: z.enum(["GUANAJUATO", "QUERETARO"]),
  tier: z.enum(["TIER_1", "TIER_2"]),
  evidenceComplete: z.literal(true),
  dedupeClear: z.literal(true),
  sourceUrl: z.url(),
}).strict();

const personSchema = z.object({
  apolloPersonId: z.string().trim().min(1).max(200),
  accountCanonicalId: z.string().trim().min(1).max(200),
  fullName: z.string().trim().min(2).max(241),
  roleTitle: z.string().trim().min(2).max(300),
  email: normalizedEmailSchema.nullable().default(null),
  emailStatus: z.enum(["verified", "guessed", "unavailable", "unknown"]).default("unknown"),
}).strict();

const suppressionSchema = z.object({
  normalizedNames: z.array(z.string().trim().min(1).max(300)).max(100),
  domains: z.array(domainSchema).max(100),
  manifestSha256: z.string().regex(SHA256_PATTERN),
}).strict();

const inventoryInputSchema = z.object({
  accounts: z.array(accountSchema).max(500),
  people: z.array(personSchema).max(2_000),
  suppression: suppressionSchema,
  accountTarget: z.literal(150).default(150),
  contactTarget: z.literal(300).default(300),
  researchCreditCap: z.number().int().min(1).max(300).default(300),
  minimumCreditBuffer: z.number().int().min(110).max(1_000).default(110),
  observedAt: z.iso.datetime({ offset: true }),
}).strict();

export type ApolloInventoryPlanningInput = z.input<typeof inventoryInputSchema>;

export type ApolloInventoryPlan = {
  schema_version: "1.0.0";
  state: "RESEARCH_READY" | "EXTEND" | "KILL";
  commercial_authorization: "HOLD";
  external_send_allowed: false;
  outreach_eligible_records: 0;
  observed_at: string;
  suppression_manifest_sha256: string;
  accounts: Array<{
    canonical_id: string;
    legal_name: string;
    primary_domain: string;
    state: "GUANAJUATO" | "QUERETARO";
    tier: "TIER_1" | "TIER_2";
    source_url: string;
  }>;
  contacts: Array<{
    apollo_person_id: string;
    account_canonical_id: string;
    full_name: string;
    role_title: string;
    // Se deriva del clasificador en vez de repetir la lista: cuando entro SAFETY
    // como cuarta variante del copy, esta union era uno de los sitios que habia
    // que recordar a mano.
    role_category: TargetResearchRoleCategory;
    normalized_email: string | null;
    email_status: "verified" | "guessed" | "unavailable" | "unknown";
    requires_email_reveal: boolean;
  }>;
  budget: {
    research_credit_cap: number;
    minimum_credit_buffer: number;
    planned_email_reveals: number;
  };
  blockers: string[];
  rejected: {
    suppressed_accounts: number;
    duplicate_accounts: number;
    orphan_people: number;
    non_target_roles: number;
    duplicate_people: number;
  };
  snapshot_sha256: string;
};

function normalizeName(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

export function buildApolloInventoryPlan(rawInput: ApolloInventoryPlanningInput): ApolloInventoryPlan {
  const parsed = inventoryInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const empty = {
      schema_version: "1.0.0" as const,
      state: "KILL" as const,
      commercial_authorization: "HOLD" as const,
      external_send_allowed: false as const,
      outreach_eligible_records: 0 as const,
      observed_at: typeof rawInput.observedAt === "string" ? rawInput.observedAt : new Date(0).toISOString(),
      suppression_manifest_sha256: "0".repeat(64),
      accounts: [],
      contacts: [],
      budget: { research_credit_cap: 300, minimum_credit_buffer: 110, planned_email_reveals: 0 },
      blockers: ["APOLLO_INVENTORY_INPUT_INVALID"],
      rejected: { suppressed_accounts: 0, duplicate_accounts: 0, orphan_people: 0, non_target_roles: 0, duplicate_people: 0 },
    };
    return { ...empty, snapshot_sha256: sha256(empty) };
  }

  const input = parsed.data;
  const suppressedNames = new Set(input.suppression.normalizedNames.map(normalizeName));
  const suppressedDomains = new Set(input.suppression.domains);
  const accountIds = new Set<string>();
  const accountDomains = new Set<string>();
  let suppressedAccounts = 0;
  let duplicateAccounts = 0;
  const accounts = input.accounts
    .slice()
    .sort((left, right) => {
      const tier = left.tier.localeCompare(right.tier);
      if (tier !== 0) return tier;
      const market = left.state.localeCompare(right.state);
      return market !== 0 ? market : left.legalName.localeCompare(right.legalName);
    })
    .filter((account) => {
      if (suppressedNames.has(normalizeName(account.legalName)) || suppressedDomains.has(account.primaryDomain)) {
        suppressedAccounts += 1;
        return false;
      }
      if (accountIds.has(account.canonicalId) || accountDomains.has(account.primaryDomain)) {
        duplicateAccounts += 1;
        return false;
      }
      accountIds.add(account.canonicalId);
      accountDomains.add(account.primaryDomain);
      return true;
    })
    .slice(0, input.accountTarget)
    .map((account) => ({
      canonical_id: account.canonicalId,
      legal_name: account.legalName,
      primary_domain: account.primaryDomain,
      state: account.state,
      tier: account.tier,
      source_url: account.sourceUrl,
    }));

  const selectedAccountIds = new Set(accounts.map((account) => account.canonical_id));
  const selectedByAccount = new Map<string, Set<string>>();
  const seenPeople = new Set<string>();
  const seenEmails = new Set<string>();
  let orphanPeople = 0;
  let nonTargetRoles = 0;
  let duplicatePeople = 0;
  const contacts: ApolloInventoryPlan["contacts"] = [];

  for (const person of input.people) {
    if (!selectedAccountIds.has(person.accountCanonicalId)) {
      orphanPeople += 1;
      continue;
    }
    const roleCategory = classifyRoleTitle(person.roleTitle);
    if (!isTargetRoleCategory(roleCategory)) {
      nonTargetRoles += 1;
      continue;
    }
    const accountCategories = selectedByAccount.get(person.accountCanonicalId) ?? new Set<string>();
    if (accountCategories.size >= 2 || accountCategories.has(roleCategory)
      || seenPeople.has(person.apolloPersonId)
      || (person.email !== null && seenEmails.has(person.email))) {
      duplicatePeople += 1;
      continue;
    }
    seenPeople.add(person.apolloPersonId);
    if (person.email !== null) seenEmails.add(person.email);
    accountCategories.add(roleCategory);
    selectedByAccount.set(person.accountCanonicalId, accountCategories);
    contacts.push({
      apollo_person_id: person.apolloPersonId,
      account_canonical_id: person.accountCanonicalId,
      full_name: person.fullName,
      role_title: person.roleTitle,
      role_category: roleCategory,
      normalized_email: person.email,
      email_status: person.emailStatus,
      requires_email_reveal: person.email === null,
    });
    if (contacts.length >= input.contactTarget) break;
  }

  const plannedEmailReveals = contacts.filter((contact) => contact.requires_email_reveal).length;
  const blockers: string[] = [];
  if (accounts.length < input.accountTarget) blockers.push("VERIFIED_ACCOUNT_TARGET_NOT_MET");
  if (contacts.length < input.contactTarget) blockers.push("TARGET_CONTACT_CANDIDATE_COUNT_NOT_MET");
  if (plannedEmailReveals > input.researchCreditCap) blockers.push("RESEARCH_CREDIT_CAP_EXCEEDED");
  if (accounts.some((account) => (selectedByAccount.get(account.canonical_id)?.size ?? 0) < 2)) {
    blockers.push("TWO_DISTINCT_TARGET_ROLES_PER_ACCOUNT_NOT_MET");
  }
  if (contacts.some((contact) => contact.email_status !== "verified" && !contact.requires_email_reveal)) {
    blockers.push("UNVERIFIED_EMAIL_PRESENT");
  }

  const base = {
    schema_version: "1.0.0" as const,
    state: blockers.length === 0 ? "RESEARCH_READY" as const : "EXTEND" as const,
    commercial_authorization: "HOLD" as const,
    external_send_allowed: false as const,
    outreach_eligible_records: 0 as const,
    observed_at: input.observedAt,
    suppression_manifest_sha256: input.suppression.manifestSha256,
    accounts,
    contacts,
    budget: {
      research_credit_cap: input.researchCreditCap,
      minimum_credit_buffer: input.minimumCreditBuffer,
      planned_email_reveals: plannedEmailReveals,
    },
    blockers,
    rejected: {
      suppressed_accounts: suppressedAccounts,
      duplicate_accounts: duplicateAccounts,
      orphan_people: orphanPeople,
      non_target_roles: nonTargetRoles,
      duplicate_people: duplicatePeople,
    },
  };
  return { ...base, snapshot_sha256: sha256(base) };
}
