import { describe, expect, it } from "vitest";

import { reconcileApolloExactPausedEnrollment } from "@/lib/providers/apollo/reconciliation";

const evaluatedAt = "2026-08-20T18:05:00Z";
const contact = {
  contact_id: "contact-1",
  normalized_email: "buyer@example.com",
  lifecycle_status: "PAUSED" as const,
  observed_at: "2026-08-20T18:04:00Z",
  evidence_sha256: "a".repeat(64),
};
const enrollment = {
  enrollment_id: "enrollment-1",
  sequence_id: "sequence-1",
  contact_id: "contact-1",
  normalized_email: "buyer@example.com",
  status: "PAUSED" as const,
  observed_at: "2026-08-20T18:04:30Z",
  evidence_sha256: "b".repeat(64),
};
const base = {
  expected_email: "Buyer@Example.com",
  expected_sequence_id: "sequence-1",
  contacts: [contact],
  enrollments: [enrollment],
  aggregate_campaign_contact_count: 0,
  evaluated_at: evaluatedAt,
  maximum_observation_age_seconds: 300,
};

describe("Apollo exact paused enrollment reconciliation", () => {
  it("trusts exact individual readback and explicitly ignores aggregate counters", () => {
    expect(reconcileApolloExactPausedEnrollment(base)).toEqual({
      status: "VERIFIED_PAUSED",
      exactEmail: "buyer@example.com",
      contactId: "contact-1",
      enrollmentId: "enrollment-1",
      providerStatus: "PAUSED",
      aggregateCountersTrusted: false,
      blockers: [],
    });
  });

  it("holds duplicate contacts, mismatched sequence and active enrollment", () => {
    expect(reconcileApolloExactPausedEnrollment({ ...base, contacts: [contact, { ...contact }] }).status).toBe("HOLD");
    expect(reconcileApolloExactPausedEnrollment({
      ...base, enrollments: [{ ...enrollment, sequence_id: "other" }],
    }).blockers).toContain("APOLLO_EXACT_ENROLLMENT_CARDINALITY_INVALID");
    expect(reconcileApolloExactPausedEnrollment({
      ...base, enrollments: [{ ...enrollment, status: "ACTIVE" }],
    }).blockers).toContain("APOLLO_ENROLLMENT_NOT_PAUSED");
  });

  it("holds stale or malformed provider evidence", () => {
    expect(reconcileApolloExactPausedEnrollment({
      ...base, contacts: [{ ...contact, observed_at: "2026-08-20T17:00:00Z" }],
    }).blockers).toContain("APOLLO_INDIVIDUAL_READBACK_STALE");
    expect(reconcileApolloExactPausedEnrollment({ ...base, contacts: [] }).status).toBe("HOLD");
  });
});
