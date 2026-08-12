import { describe, expect, it } from "vitest";

import {
  freezeResearchInventorySnapshotRpcSchema,
  ingestResearchBatchRpcSchema,
  recordResearchEvidenceRpcSchema,
  resolveResearchDedupeRpcSchema,
  submitResearchReviewRpcSchema,
  upsertContactCandidateRpcSchema,
  upsertResearchAccountRpcSchema,
  verifyContactCandidateRpcSchema,
} from "@/lib/research/contracts";

const organizationId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const candidateId = "33333333-3333-4333-8333-333333333333";
const evidenceA = "44444444-4444-4444-8444-444444444441";
const evidenceB = "44444444-4444-4444-8444-444444444442";
const sourceRecordId = "55555555-5555-4555-8555-555555555555";
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const observedAt = new Date(Date.now() - 60_000).toISOString();

describe("research RPC input contracts", () => {
  it("normalizes a strict import batch without allowing unknown keys", () => {
    const input = {
      organizationId,
      sourceName: "Synthetic directory",
      sourceSha256: hashA,
      manifestSha256: hashB,
      rows: [{
        externalRecordId: "synthetic-row-1",
        sourceRow: 2,
        rawFingerprint: hashA,
        legalName: "  Planta Sintética, S.A. de C.V. ",
        primaryDomain: "WWW.Synthetic.Invalid",
        city: " León ",
        state: "GUANAJUATO" as const,
        industrialPark: null,
        sector: " Manufactura ",
        sourceUrl: "https://evidence.invalid/company",
      }],
      idempotencyKey: hashA,
    };
    const parsed = ingestResearchBatchRpcSchema.parse(input);
    expect(parsed.rows[0]).toMatchObject({
      legalName: "Planta Sintética, S.A. de C.V.",
      legalNameKey: "planta-sintetica",
      primaryDomain: "synthetic.invalid",
      city: "León",
    });
    expect(ingestResearchBatchRpcSchema.safeParse({ ...input, unauthorized: true }).success).toBe(false);
  });

  it("rejects duplicate source identities inside one batch", () => {
    const row = {
      externalRecordId: "synthetic-row-1",
      sourceRow: 2,
      rawFingerprint: hashA,
      legalName: "Synthetic Plant",
      primaryDomain: null,
      city: null,
      state: "QUERETARO" as const,
      industrialPark: null,
      sector: null,
      sourceUrl: null,
    };
    expect(ingestResearchBatchRpcSchema.safeParse({
      organizationId,
      sourceName: "Synthetic directory",
      sourceSha256: hashA,
      manifestSha256: hashB,
      rows: [row, { ...row, sourceRow: 3 }],
      idempotencyKey: hashA,
    }).success).toBe(false);
  });

  it("normalizes account identity and rejects path-bearing domains", () => {
    const base = {
      organizationId,
      sourceRecordId,
      legalName: "Synthetic Industrial LLC",
      primaryDomain: "https://www.synthetic.invalid",
      city: "Querétaro",
      state: "QUERETARO" as const,
      industrialPark: null,
      sector: "Industrial",
      idempotencyKey: hashA,
    };
    expect(upsertResearchAccountRpcSchema.parse(base)).toMatchObject({
      legalNameKey: "synthetic-industrial",
      primaryDomain: "synthetic.invalid",
    });
    expect(upsertResearchAccountRpcSchema.safeParse({
      ...base,
      primaryDomain: "synthetic.invalid/company",
    }).success).toBe(false);
  });

  it("accepts allowlisted evidence and rejects unsupported or malformed facts", () => {
    const base = {
      organizationId,
      subjectType: "ACCOUNT" as const,
      subjectId: accountId,
      sourceUrl: "https://evidence.invalid/source",
      sourceName: "Synthetic official source",
      observedAt,
      confidence: "HIGH" as const,
      checksum: hashA,
      idempotencyKey: hashB,
    };
    expect(recordResearchEvidenceRpcSchema.safeParse({
      ...base,
      fieldName: "primary_domain",
      valueJson: "WWW.Synthetic.Invalid",
    }).success).toBe(true);
    expect(recordResearchEvidenceRpcSchema.safeParse({
      ...base,
      fieldName: "commercial_intent",
      valueJson: true,
    }).success).toBe(false);
    expect(recordResearchEvidenceRpcSchema.safeParse({
      ...base,
      fieldName: "normalized_email",
      valueJson: "not-an-email",
    }).success).toBe(false);
    expect(recordResearchEvidenceRpcSchema.safeParse({
      ...base,
      sourceUrl: "ftp://evidence.invalid/source",
      fieldName: "industrial_plant",
      valueJson: true,
    }).success).toBe(false);
    expect(recordResearchEvidenceRpcSchema.safeParse({
      ...base,
      fieldName: "role_title",
      valueJson: "Plant Manager",
    }).success).toBe(false);
  });

  it("rejects evidence observed beyond the clock-skew allowance", () => {
    expect(recordResearchEvidenceRpcSchema.safeParse({
      organizationId,
      subjectType: "ACCOUNT",
      subjectId: accountId,
      fieldName: "industrial_plant",
      valueJson: true,
      sourceUrl: "https://evidence.invalid/source",
      sourceName: "Synthetic source",
      observedAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      confidence: "VERIFIED",
      checksum: hashA,
      idempotencyKey: hashB,
    }).success).toBe(false);
  });

  it("requires multiple unique evidence records to mark a subject verified", () => {
    const base = {
      organizationId,
      subjectType: "ACCOUNT" as const,
      subjectId: accountId,
      decision: "VERIFIED" as const,
      reviewNotes: "Synthetic review passed",
      idempotencyKey: hashA,
    };
    expect(submitResearchReviewRpcSchema.safeParse({ ...base, evidenceIds: [evidenceA] }).success).toBe(false);
    expect(submitResearchReviewRpcSchema.safeParse({ ...base, evidenceIds: [evidenceA, evidenceB] }).success).toBe(true);
    expect(submitResearchReviewRpcSchema.safeParse({ ...base, evidenceIds: [evidenceA, evidenceA] }).success).toBe(false);
  });

  it("derives role category from the title and permits discovery before email is known", () => {
    const parsed = upsertContactCandidateRpcSchema.parse({
      organizationId,
      accountId,
      fullName: "Persona Sintética",
      roleTitle: "Gerencia de Compras",
      normalizedEmail: null,
      evidenceIds: [],
      idempotencyKey: hashA,
    });
    expect(parsed.roleCategory).toBe("PROCUREMENT");
    expect(parsed.normalizedEmail).toBeNull();
  });

  it("requires distinct role and email evidence for contact promotion", () => {
    const base = {
      organizationId,
      candidateId,
      roleEvidenceId: evidenceA,
      emailEvidenceId: evidenceB,
      idempotencyKey: hashA,
    };
    expect(verifyContactCandidateRpcSchema.safeParse(base).success).toBe(true);
    expect(verifyContactCandidateRpcSchema.safeParse({ ...base, emailEvidenceId: evidenceA }).success).toBe(false);
  });

  it("requires a canonical account only for merge and alias decisions", () => {
    const base = {
      organizationId,
      caseId: candidateId,
      rationale: "Synthetic human resolution",
      idempotencyKey: hashA,
    };
    expect(resolveResearchDedupeRpcSchema.safeParse({
      ...base,
      decision: "SAME_ENTITY",
      canonicalAccountId: accountId,
    }).success).toBe(true);
    expect(resolveResearchDedupeRpcSchema.safeParse({
      ...base,
      decision: "SAME_ENTITY",
      canonicalAccountId: null,
    }).success).toBe(false);
    expect(resolveResearchDedupeRpcSchema.safeParse({
      ...base,
      decision: "DISTINCT",
      canonicalAccountId: accountId,
    }).success).toBe(false);
  });

  it("requires both assessment checksum and idempotency for snapshot freezing", () => {
    expect(freezeResearchInventorySnapshotRpcSchema.safeParse({
      organizationId,
      assessmentChecksum: hashA,
      idempotencyKey: hashB,
    }).success).toBe(true);
    expect(freezeResearchInventorySnapshotRpcSchema.safeParse({
      organizationId,
      assessmentChecksum: "unknown",
      idempotencyKey: hashB,
    }).success).toBe(false);
  });
});
