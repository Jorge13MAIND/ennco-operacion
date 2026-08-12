import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMutationContext: vi.fn(),
  requireOperationsAccess: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/operations/route", () => ({
  getMutationContext: mocks.getMutationContext,
}));
vi.mock("@/lib/auth/authorization", () => ({
  requireOperationsAccess: mocks.requireOperationsAccess,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

import { POST as createAccount } from "@/app/api/v1/research/accounts/route";
import { POST as addCandidate } from "@/app/api/v1/research/accounts/[id]/contact-candidates/route";
import { POST as recordEvidence } from "@/app/api/v1/research/accounts/[id]/evidence/route";
import { POST as reviewAccount } from "@/app/api/v1/research/accounts/[id]/review/route";
import { POST as verifyCandidate } from "@/app/api/v1/research/contact-candidates/[id]/verify/route";
import { POST as resolveDedupe } from "@/app/api/v1/research/dedupe/[id]/resolve/route";
import { POST as importBatch } from "@/app/api/v1/research/imports/route";
import { GET as assessInventory } from "@/app/api/v1/research/inventory/readiness/route";
import { POST as freezeSnapshot } from "@/app/api/v1/research/inventory/snapshots/route";

const organizationId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const candidateId = "33333333-3333-4333-8333-333333333333";
const evidenceA = "44444444-4444-4444-8444-444444444441";
const evidenceB = "44444444-4444-4444-8444-444444444442";
const sourceRecordId = "55555555-5555-4555-8555-555555555555";
const reviewId = "66666666-6666-4666-8666-666666666666";
const batchId = "77777777-7777-4777-8777-777777777777";
const snapshotId = "88888888-8888-4888-8888-888888888888";
const caseId = "99999999-9999-4999-8999-999999999999";
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const mutationHeaders = {
  "Content-Type": "application/json",
  "Idempotency-Key": hashA,
  Origin: "https://operacion.invalid",
};

function request(path: string, body: Record<string, unknown>): Request {
  return new Request(`https://operacion.invalid${path}`, {
    method: "POST",
    headers: mutationHeaders,
    body: JSON.stringify(body),
  });
}

describe("research route contracts", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.getMutationContext.mockReset();
    mocks.requireOperationsAccess.mockReset();
    mocks.createSupabaseServerClient.mockReset();
    mocks.getMutationContext.mockResolvedValue({
      ok: true,
      organizationId,
      client: { rpc: mocks.rpc },
    });
    mocks.requireOperationsAccess.mockResolvedValue({
      evidenceClass: "live",
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      organizationId,
      role: "teckel_operator",
    });
    mocks.createSupabaseServerClient.mockResolvedValue({ rpc: mocks.rpc });
  });

  it("authorizes before reading an invalid mutation body", async () => {
    mocks.getMutationContext.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: "ORIGIN_MISMATCH" }, { status: 403 }),
    });
    const denied = new Request("https://operacion.invalid/api/v1/research/imports", {
      method: "POST",
      headers: mutationHeaders,
      body: "not-json",
    });
    const text = vi.spyOn(denied, "text");
    const response = await importBatch(denied);
    expect(response.status).toBe(403);
    expect(text).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("ingests a strict batch with organization and idempotency bound outside the body", async () => {
    mocks.rpc.mockResolvedValue({
      data: { status: "CREATED", batch_id: batchId, created: 1, matched: 0, quarantined: 0, duplicate_cases: 0 },
      error: null,
    });
    const response = await importBatch(request("/api/v1/research/imports", {
      sourceName: "Synthetic directory",
      sourceSha256: hashA,
      manifestSha256: hashB,
      rows: [{
        externalRecordId: "synthetic-row-1",
        sourceRow: 2,
        rawFingerprint: hashA,
        legalName: "Synthetic Plant",
        primaryDomain: "synthetic.invalid",
        city: "León",
        state: "GUANAJUATO",
        industrialPark: null,
        sector: "Industrial",
        sourceUrl: "https://evidence.invalid/company",
      }],
    }));
    expect(response.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("ingest_research_batch", expect.objectContaining({
      target_organization_id: organizationId,
      target_idempotency_key: hashA,
    }));
  });

  it("rejects organization spoofing in an otherwise valid account request", async () => {
    const response = await createAccount(request("/api/v1/research/accounts", {
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sourceRecordId,
      legalName: "Synthetic Plant",
      primaryDomain: null,
      city: null,
      state: "QUERETARO",
      industrialPark: null,
      sector: null,
    }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("RESEARCH_TRUSTED_FIELD_IN_BODY");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps account, evidence, review and candidate mutations to fixed RPCs", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { status: "CREATED", account_id: accountId, dedupe_case_id: null }, error: null })
      .mockResolvedValueOnce({ data: { status: "CREATED", evidence_id: evidenceA }, error: null })
      .mockResolvedValueOnce({ data: { status: "VERIFIED", review_id: reviewId, subject_id: accountId, research_status: "VERIFIED" }, error: null })
      .mockResolvedValueOnce({ data: { status: "CREATED", candidate_id: candidateId, duplicate_candidate_id: null, role_category: "PROCUREMENT" }, error: null });

    const accountResponse = await createAccount(request("/api/v1/research/accounts", {
      sourceRecordId,
      legalName: "Synthetic Plant",
      primaryDomain: "synthetic.invalid",
      city: "Querétaro",
      state: "QUERETARO",
      industrialPark: null,
      sector: "Industrial",
    }));
    const evidenceResponse = await recordEvidence(request(`/api/v1/research/accounts/${accountId}/evidence`, {
      fieldName: "industrial_plant",
      valueJson: true,
      sourceUrl: "https://evidence.invalid/source",
      sourceName: "Synthetic source",
      observedAt: new Date(Date.now() - 60_000).toISOString(),
      confidence: "HIGH",
      checksum: hashA,
    }), { params: Promise.resolve({ id: accountId }) });
    const reviewResponse = await reviewAccount(request(`/api/v1/research/accounts/${accountId}/review`, {
      decision: "VERIFIED",
      evidenceIds: [evidenceA, evidenceB],
      reviewNotes: "Synthetic review complete",
    }), { params: Promise.resolve({ id: accountId }) });
    const candidateResponse = await addCandidate(request(`/api/v1/research/accounts/${accountId}/contact-candidates`, {
      fullName: "Persona Sintética",
      roleTitle: "Gerencia de Compras",
      normalizedEmail: null,
      evidenceIds: [evidenceA],
    }), { params: Promise.resolve({ id: accountId }) });

    expect([accountResponse.status, evidenceResponse.status, reviewResponse.status, candidateResponse.status])
      .toEqual([200, 201, 200, 200]);
    expect(mocks.rpc.mock.calls.map((call) => call[0])).toEqual([
      "upsert_research_account",
      "record_research_evidence",
      "submit_research_review",
      "upsert_contact_candidate",
    ]);
    expect(mocks.rpc.mock.calls[3]?.[1]).toMatchObject({
      target_organization_id: organizationId,
      target_account_id: accountId,
      target_role_category: "PROCUREMENT",
    });
  });

  it("maps verification and dedupe while using the path identifier as trusted authority", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { status: "PROMOTED", contact_id: evidenceA, blockers: [] }, error: null })
      .mockResolvedValueOnce({ data: { status: "RESOLVED", canonical_account_id: accountId, aliases_created: 1 }, error: null });
    const verifyResponse = await verifyCandidate(request(`/api/v1/research/contact-candidates/${candidateId}/verify`, {
      roleEvidenceId: evidenceA,
      emailEvidenceId: evidenceB,
    }), { params: Promise.resolve({ id: candidateId }) });
    const dedupeResponse = await resolveDedupe(request(`/api/v1/research/dedupe/${caseId}/resolve`, {
      decision: "ALIAS",
      canonicalAccountId: accountId,
      rationale: "Synthetic alias review",
    }), { params: Promise.resolve({ id: caseId }) });
    expect([verifyResponse.status, dedupeResponse.status]).toEqual([200, 200]);
    expect(mocks.rpc.mock.calls[0]?.[1]).toMatchObject({ target_candidate_id: candidateId });
    expect(mocks.rpc.mock.calls[1]?.[1]).toMatchObject({ target_case_id: caseId });
  });

  it("returns readiness and freezes only a research-only HOLD snapshot", async () => {
    const readiness = {
      status: "ASSESSED",
      decision: "PASS",
      verified_accounts: 75,
      verified_contacts: 150,
      target_accounts: 75,
      target_contacts: 150,
      outreach_state: "RESEARCH_ONLY_HOLD",
      outreach_eligible_records: 0,
      blockers: ["EXPLICIT_RELEASE_APPROVAL_REQUIRED"],
      assessment_checksum: hashA,
    } as const;
    mocks.rpc
      .mockResolvedValueOnce({ data: readiness, error: null })
      .mockResolvedValueOnce({
        data: {
          status: "CREATED",
          snapshot_id: snapshotId,
          decision: "PASS",
          snapshot_sha256: hashB,
          outreach_state: "RESEARCH_ONLY_HOLD",
          outreach_eligible_records: 0,
        },
        error: null,
      });
    const readinessResponse = await assessInventory();
    const snapshotResponse = await freezeSnapshot(request("/api/v1/research/inventory/snapshots", {
      assessmentChecksum: hashA,
    }));
    expect(readinessResponse.status).toBe(200);
    expect(snapshotResponse.status).toBe(201);
    expect(await readinessResponse.json()).toMatchObject({
      decision: "PASS",
      outreach_state: "RESEARCH_ONLY_HOLD",
      outreach_eligible_records: 0,
    });
    expect(mocks.rpc.mock.calls.map((call) => call[0])).toEqual([
      "assess_research_inventory",
      "freeze_research_inventory_snapshot",
    ]);
  });

  it("fails closed for an unknown RPC response and never exposes a database error", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { status: "CREATED", account_id: accountId, unexpected: "secret" }, error: null });
    const unknown = await createAccount(request("/api/v1/research/accounts", {
      sourceRecordId,
      legalName: "Synthetic Plant",
      primaryDomain: null,
      city: null,
      state: "GUANAJUATO",
      industrialPark: null,
      sector: null,
    }));
    expect(unknown.status).toBe(502);
    expect(JSON.stringify(await unknown.json())).not.toContain("secret");

    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "SENSITIVE_DATABASE_DETAIL" } });
    const rejected = await freezeSnapshot(request("/api/v1/research/inventory/snapshots", {
      assessmentChecksum: hashA,
    }));
    expect(rejected.status).toBe(409);
    expect(JSON.stringify(await rejected.json())).not.toContain("SENSITIVE_DATABASE_DETAIL");
  });
});
