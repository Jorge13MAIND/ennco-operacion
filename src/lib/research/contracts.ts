import { z } from "zod";

import {
  canNormalizeDomain,
  canNormalizeEmail,
  canNormalizeLegalName,
  legalNameMatchKey,
  normalizeDomain,
  normalizeEmail,
  normalizeLegalName,
} from "@/lib/research/normalization";
import { classifyRoleTitle, RESEARCH_ROLE_CATEGORIES } from "@/lib/research/roles";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,199}$/u;

export const researchUuidSchema = z.uuid();
export const researchSha256Schema = z.string().regex(SHA256_PATTERN);
export const researchIdempotencyKeySchema = researchSha256Schema;
export const researchRoleCategorySchema = z.enum(RESEARCH_ROLE_CATEGORIES);
export const researchStateSchema = z.enum(["GUANAJUATO", "QUERETARO", "OTHER", "UNKNOWN"]);

const organizationShape = {
  organizationId: researchUuidSchema,
} as const;

const legalNameSchema = z.string().refine(canNormalizeLegalName, "LEGAL_NAME_INVALID").transform(normalizeLegalName);
const domainSchema = z.string().refine(canNormalizeDomain, "DOMAIN_INVALID").transform(normalizeDomain);
const emailSchema = z.string().refine(canNormalizeEmail, "EMAIL_INVALID").transform(normalizeEmail);
const normalizedTextSchema = z.string().trim().min(1).max(500)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), "TEXT_CONTROL_CHARACTER_FORBIDDEN")
  .transform((value) => value.normalize("NFKC").replace(/\s+/gu, " ").trim());
const sourceNameSchema = z.string().trim().min(2).max(200)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), "SOURCE_NAME_CONTROL_CHARACTER_FORBIDDEN");
const sourceUrlSchema = z.url().superRefine((value, context) => {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    context.addIssue({ code: "custom", message: "SOURCE_URL_INVALID" });
  }
});
const observedAtSchema = z.iso.datetime({ offset: true }).refine(
  (value) => Date.parse(value) <= Date.now() + 5 * 60 * 1_000,
  "OBSERVED_AT_IN_FUTURE",
);
const evidenceIdsSchema = z.array(researchUuidSchema).max(50).refine(
  (values) => new Set(values).size === values.length,
  "EVIDENCE_IDS_MUST_BE_UNIQUE",
);

export const researchImportRowSchema = z.object({
  externalRecordId: z.string().regex(IDENTIFIER_PATTERN),
  sourceRow: z.number().int().positive(),
  rawFingerprint: researchSha256Schema,
  legalName: legalNameSchema,
  primaryDomain: domainSchema.nullable().default(null),
  city: normalizedTextSchema.nullable().default(null),
  state: researchStateSchema,
  industrialPark: normalizedTextSchema.nullable().default(null),
  sector: normalizedTextSchema.nullable().default(null),
  sourceUrl: sourceUrlSchema.nullable().default(null),
}).strict().transform((value) => ({
  ...value,
  legalNameKey: legalNameMatchKey(value.legalName),
}));

export const ingestResearchBatchRpcSchema = z.object({
  ...organizationShape,
  sourceName: sourceNameSchema,
  sourceSha256: researchSha256Schema,
  manifestSha256: researchSha256Schema,
  rows: z.array(researchImportRowSchema).min(1).max(500),
  idempotencyKey: researchIdempotencyKeySchema,
}).strict().superRefine((value, context) => {
  const externalIds = value.rows.map((row) => row.externalRecordId);
  if (new Set(externalIds).size !== externalIds.length) {
    context.addIssue({ code: "custom", path: ["rows"], message: "DUPLICATE_EXTERNAL_RECORD_ID" });
  }
  const sourceRows = value.rows.map((row) => row.sourceRow);
  if (new Set(sourceRows).size !== sourceRows.length) {
    context.addIssue({ code: "custom", path: ["rows"], message: "DUPLICATE_SOURCE_ROW" });
  }
});

export const upsertResearchAccountRpcSchema = z.object({
  ...organizationShape,
  sourceRecordId: researchUuidSchema,
  legalName: legalNameSchema,
  primaryDomain: domainSchema.nullable().default(null),
  city: normalizedTextSchema.nullable().default(null),
  state: researchStateSchema,
  industrialPark: normalizedTextSchema.nullable().default(null),
  sector: normalizedTextSchema.nullable().default(null),
  idempotencyKey: researchIdempotencyKeySchema,
}).strict().transform((value) => ({
  ...value,
  legalNameKey: legalNameMatchKey(value.legalName),
}));

const evidenceBaseShape = {
  ...organizationShape,
  subjectType: z.enum(["ACCOUNT", "CONTACT_CANDIDATE"]),
  subjectId: researchUuidSchema,
  sourceUrl: sourceUrlSchema,
  sourceName: sourceNameSchema,
  observedAt: observedAtSchema,
  confidence: z.enum(["UNVERIFIED", "LOW", "MEDIUM", "HIGH", "VERIFIED"]),
  checksum: researchSha256Schema,
  idempotencyKey: researchIdempotencyKeySchema,
} as const;

const researchTextEvidenceFields = [
  "city",
  "industrial_park",
  "sector",
  "full_name",
  "role_title",
] as const;

export const recordResearchEvidenceRpcSchema = z.discriminatedUnion("fieldName", [
  z.object({
    ...evidenceBaseShape,
    fieldName: z.enum(researchTextEvidenceFields),
    valueJson: normalizedTextSchema,
  }).strict(),
  z.object({
    ...evidenceBaseShape,
    fieldName: z.literal("legal_name"),
    valueJson: legalNameSchema,
  }).strict(),
  z.object({
    ...evidenceBaseShape,
    fieldName: z.literal("primary_domain"),
    valueJson: domainSchema,
  }).strict(),
  z.object({
    ...evidenceBaseShape,
    fieldName: z.literal("normalized_email"),
    valueJson: emailSchema,
  }).strict(),
  z.object({
    ...evidenceBaseShape,
    fieldName: z.literal("state"),
    valueJson: researchStateSchema,
  }).strict(),
  z.object({
    ...evidenceBaseShape,
    fieldName: z.literal("industrial_plant"),
    valueJson: z.literal(true),
  }).strict(),
  z.object({
    ...evidenceBaseShape,
    fieldName: z.literal("role_category"),
    valueJson: researchRoleCategorySchema,
  }).strict(),
  z.object({
    ...evidenceBaseShape,
    fieldName: z.literal("email_verification"),
    valueJson: z.literal(true),
  }).strict(),
]).superRefine((value, context) => {
  const accountFields = new Set([
    "legal_name", "primary_domain", "industrial_plant", "city", "state", "industrial_park", "sector",
  ]);
  const candidateFields = new Set([
    "full_name", "role_title", "role_category", "normalized_email", "email_verification",
  ]);
  const permitted = value.subjectType === "ACCOUNT" ? accountFields : candidateFields;
  if (!permitted.has(value.fieldName)) {
    context.addIssue({ code: "custom", path: ["fieldName"], message: "EVIDENCE_FIELD_SUBJECT_MISMATCH" });
  }
});

export const submitResearchReviewRpcSchema = z.object({
  ...organizationShape,
  subjectType: z.enum(["ACCOUNT", "CONTACT_CANDIDATE"]),
  subjectId: researchUuidSchema,
  decision: z.enum(["VERIFIED", "QUARANTINED", "REJECTED"]),
  evidenceIds: evidenceIdsSchema.min(1),
  reviewNotes: z.string().trim().min(3).max(5_000),
  idempotencyKey: researchIdempotencyKeySchema,
}).strict().superRefine((value, context) => {
  if (value.decision === "VERIFIED" && value.evidenceIds.length < 2) {
    context.addIssue({ code: "custom", path: ["evidenceIds"], message: "VERIFICATION_REQUIRES_MULTIPLE_EVIDENCE_RECORDS" });
  }
});

export const upsertContactCandidateRpcSchema = z.object({
  ...organizationShape,
  accountId: researchUuidSchema,
  fullName: normalizedTextSchema,
  roleTitle: normalizedTextSchema,
  normalizedEmail: emailSchema.nullable().default(null),
  evidenceIds: evidenceIdsSchema.default([]),
  idempotencyKey: researchIdempotencyKeySchema,
}).strict().transform((value) => ({
  ...value,
  roleCategory: classifyRoleTitle(value.roleTitle),
}));

export const verifyContactCandidateRpcSchema = z.object({
  ...organizationShape,
  candidateId: researchUuidSchema,
  roleEvidenceId: researchUuidSchema,
  emailEvidenceId: researchUuidSchema,
  idempotencyKey: researchIdempotencyKeySchema,
}).strict().refine(
  (value) => value.roleEvidenceId !== value.emailEvidenceId,
  { path: ["emailEvidenceId"], message: "ROLE_AND_EMAIL_EVIDENCE_MUST_DIFFER" },
);

export const resolveResearchDedupeRpcSchema = z.object({
  ...organizationShape,
  caseId: researchUuidSchema,
  decision: z.enum(["SAME_ENTITY", "DISTINCT", "ALIAS"]),
  canonicalAccountId: researchUuidSchema.nullable().default(null),
  rationale: z.string().trim().min(3).max(5_000),
  idempotencyKey: researchIdempotencyKeySchema,
}).strict().superRefine((value, context) => {
  const requiresCanonical = value.decision === "SAME_ENTITY" || value.decision === "ALIAS";
  if (requiresCanonical && value.canonicalAccountId === null) {
    context.addIssue({ code: "custom", path: ["canonicalAccountId"], message: "CANONICAL_ACCOUNT_REQUIRED" });
  }
  if (!requiresCanonical && value.canonicalAccountId !== null) {
    context.addIssue({ code: "custom", path: ["canonicalAccountId"], message: "CANONICAL_ACCOUNT_FORBIDDEN" });
  }
});

export const assessResearchInventoryRpcSchema = z.object({
  ...organizationShape,
}).strict();

export const freezeResearchInventorySnapshotRpcSchema = z.object({
  ...organizationShape,
  assessmentChecksum: researchSha256Schema,
  idempotencyKey: researchIdempotencyKeySchema,
}).strict();

export const getResearchSuppressionStatusRpcSchema = z.object({
  ...organizationShape,
  subjectType: z.enum(["ACCOUNT", "CONTACT_CANDIDATE", "CONTACT"]),
  subjectId: researchUuidSchema,
}).strict();

export type IngestResearchBatchRpcInput = z.input<typeof ingestResearchBatchRpcSchema>;
export type IngestResearchBatchRpcValue = z.output<typeof ingestResearchBatchRpcSchema>;
export type UpsertResearchAccountRpcInput = z.input<typeof upsertResearchAccountRpcSchema>;
export type RecordResearchEvidenceRpcInput = z.input<typeof recordResearchEvidenceRpcSchema>;
export type SubmitResearchReviewRpcInput = z.input<typeof submitResearchReviewRpcSchema>;
export type UpsertContactCandidateRpcInput = z.input<typeof upsertContactCandidateRpcSchema>;
export type VerifyContactCandidateRpcInput = z.input<typeof verifyContactCandidateRpcSchema>;
export type ResolveResearchDedupeRpcInput = z.input<typeof resolveResearchDedupeRpcSchema>;
