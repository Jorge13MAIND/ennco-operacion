import { z } from "zod";

const uuidSchema = z.uuid();
const blockerSchema = z.string().regex(/^[A-Z0-9_:-]{1,100}$/u);

const researchCandidateSchema = z.object({
  id: uuidSchema,
  account_id: uuidSchema,
  role_category: z.enum(["CEO", "PLANT_DIRECTOR", "MAINTENANCE", "PROCUREMENT", "OTHER"]),
  research_status: z.enum(["DISCOVERED", "IN_REVIEW", "VERIFIED", "QUARANTINED", "PROMOTED", "REJECTED"]),
  promoted_contact_id: uuidSchema.nullable(),
}).strict().superRefine((value, context) => {
  if ((value.research_status === "PROMOTED") !== (value.promoted_contact_id !== null)) {
    context.addIssue({ code: "custom", path: ["promoted_contact_id"], message: "PROMOTED_CONTACT_BINDING_INVALID" });
  }
});

const researchAccountSchema = z.object({
  id: uuidSchema,
  research_status: z.enum(["SEED", "IN_REVIEW", "VERIFIED", "QUARANTINED", "MERGED", "REJECTED"]),
  priority_market: z.enum(["GTO_QRO_FIRST", "EXPANSION_HOLD"]),
  research_state: z.enum(["GUANAJUATO", "QUERETARO", "OTHER", "UNKNOWN"]),
  research_coverage_exception_approved: z.boolean(),
}).strict();

const researchDedupeSchema = z.object({
  id: uuidSchema,
  subject_type: z.enum(["ACCOUNT", "CONTACT_CANDIDATE"]),
  source_record_id: uuidSchema.nullable(),
  candidate_account_id: uuidSchema.nullable(),
  matched_account_id: uuidSchema.nullable(),
  candidate_contact_id: uuidSchema.nullable(),
  matched_candidate_id: uuidSchema.nullable(),
  status: z.enum(["OPEN", "RESOLVED", "HOLD"]),
}).strict();

const researchPassCommercialBlockers = new Set([
  "RESEARCH_MODULE_CANNOT_AUTHORIZE_COMMERCIAL_ACTION",
  "ANNEX_A_UNKNOWN",
  "ANNEX_A_MISSING",
  "ANNEX_A_STALE",
  "ANNEX_A_RECONCILIATION_PENDING",
  "ANNEX_A_DATABASE_BINDING_PENDING",
  "SUPPRESSION_MISSING",
  "SUPPRESSION_UNKNOWN",
  "EXPLICIT_RELEASE_APPROVAL_REQUIRED",
]);

const researchAssessmentSchema = z.object({
  status: z.literal("ASSESSED"),
  decision: z.enum(["PASS", "EXTEND", "KILL"]),
  verified_accounts: z.number().int().nonnegative(),
  verified_contacts: z.number().int().nonnegative(),
  target_accounts: z.literal(75),
  target_contacts: z.literal(150),
  outreach_state: z.literal("RESEARCH_ONLY_HOLD"),
  outreach_eligible_records: z.literal(0),
  blockers: z.array(blockerSchema).max(100),
  assessment_checksum: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict().superRefine((value, context) => {
  if (value.decision === "PASS" && value.blockers.some((blocker) => !researchPassCommercialBlockers.has(blocker))) {
    context.addIssue({ code: "custom", path: ["decision"], message: "RESEARCH_PASS_HAS_RESEARCH_BLOCKER" });
  }
  if (value.decision === "PASS"
    && (value.verified_accounts < value.target_accounts || value.verified_contacts < value.target_contacts)) {
    context.addIssue({ code: "custom", path: ["decision"], message: "RESEARCH_PASS_TARGETS_NOT_MET" });
  }
});

export type ResearchPortalCandidate = z.infer<typeof researchCandidateSchema>;
export type ResearchPortalAccount = z.infer<typeof researchAccountSchema>;
export type ResearchPortalDedupeCase = z.infer<typeof researchDedupeSchema>;
export type ResearchPortalAssessment = z.infer<typeof researchAssessmentSchema>;

export type ResearchPortalReadModel = {
  inventoryReady: boolean;
  accounts: ResearchPortalAccount[];
  candidates: ResearchPortalCandidate[];
  dedupeCases: ResearchPortalDedupeCase[];
  assessment: ResearchPortalAssessment | null;
  reasonCode: string | null;
};

function hasUniqueIds(rows: readonly { id: string }[]): boolean {
  return new Set(rows.map((row) => row.id)).size === rows.length;
}

export function parseResearchPortalReadModel(input: {
  accountsAvailable: boolean;
  accountsData: unknown;
  accountsCount: number | null;
  candidatesAvailable: boolean;
  candidatesData: unknown;
  candidatesCount: number | null;
  dedupeAvailable: boolean;
  dedupeData: unknown;
  dedupeCount: number | null;
  assessmentAvailable: boolean;
  assessmentData: unknown;
}): ResearchPortalReadModel {
  if (!input.accountsAvailable || !input.candidatesAvailable || !input.dedupeAvailable || !input.assessmentAvailable) {
    return {
      inventoryReady: false,
      accounts: [],
      candidates: [],
      dedupeCases: [],
      assessment: null,
      reasonCode: "RESEARCH_READ_MODEL_UNAVAILABLE",
    };
  }
  const accounts = z.array(researchAccountSchema).safeParse(input.accountsData);
  const candidates = z.array(researchCandidateSchema).safeParse(input.candidatesData);
  const dedupeCases = z.array(researchDedupeSchema).safeParse(input.dedupeData);
  const assessment = researchAssessmentSchema.safeParse(input.assessmentData);
  if (!accounts.success || !candidates.success || !dedupeCases.success || !assessment.success
    || !hasUniqueIds(accounts.data) || !hasUniqueIds(candidates.data) || !hasUniqueIds(dedupeCases.data)
    || input.accountsCount !== accounts.data.length
    || input.candidatesCount !== candidates.data.length
    || input.dedupeCount !== dedupeCases.data.length) {
    return {
      inventoryReady: false,
      accounts: [],
      candidates: [],
      dedupeCases: [],
      assessment: null,
      reasonCode: "RESEARCH_READ_MODEL_INVALID",
    };
  }
  const accountIds = new Set(accounts.data.map((account) => account.id));
  const blockedAccountIds = new Set(dedupeCases.data.filter((item) =>
    item.subject_type === "ACCOUNT" && (item.status === "OPEN" || item.status === "HOLD"))
    .flatMap((item) => [item.candidate_account_id, item.matched_account_id].filter((id): id is string => id !== null)));
  const verifiedAccountIds = new Set(accounts.data.filter((account) =>
    account.research_status === "VERIFIED"
    && account.priority_market === "GTO_QRO_FIRST"
    && (account.research_state === "GUANAJUATO" || account.research_state === "QUERETARO")
    && !blockedAccountIds.has(account.id))
    .map((account) => account.id));
  const blockedCandidateIds = new Set(dedupeCases.data.filter((item) =>
    item.subject_type === "CONTACT_CANDIDATE" && (item.status === "OPEN" || item.status === "HOLD"))
    .flatMap((item) => [item.candidate_contact_id, item.matched_candidate_id].filter((id): id is string => id !== null)));
  const verifiedAccountCount = verifiedAccountIds.size;
  const promotedContactCount = candidates.data.filter((candidate) =>
    candidate.research_status === "PROMOTED"
    && candidate.role_category !== "OTHER"
    && verifiedAccountIds.has(candidate.account_id)
    && !blockedCandidateIds.has(candidate.id)).length;
  if (candidates.data.some((candidate) => !accountIds.has(candidate.account_id))
    || assessment.data.verified_accounts !== verifiedAccountCount
    || assessment.data.verified_contacts !== promotedContactCount) {
    return {
      inventoryReady: false,
      accounts: [],
      candidates: [],
      dedupeCases: [],
      assessment: null,
      reasonCode: "RESEARCH_READ_MODEL_INCONSISTENT",
    };
  }
  return {
    inventoryReady: true,
    accounts: accounts.data,
    candidates: candidates.data,
    dedupeCases: dedupeCases.data,
    assessment: assessment.data,
    reasonCode: null,
  };
}
