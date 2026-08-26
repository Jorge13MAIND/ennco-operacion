import { z } from "zod";

const timestampSchema = z.iso.datetime({ offset: true });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const normalizedEmailSchema = z.email().transform((value) => value.trim().toLowerCase());

export const apolloExactContactSchema = z.object({
  contact_id: z.string().trim().min(1).max(160),
  normalized_email: normalizedEmailSchema,
  lifecycle_status: z.enum(["NEW", "VERIFIED", "ENROLLED", "PAUSED", "REPLIED", "BOUNCED", "UNSUBSCRIBED"]),
  observed_at: timestampSchema,
  evidence_sha256: sha256Schema,
}).strict();

export const apolloEnrollmentReadbackSchema = z.object({
  enrollment_id: z.string().trim().min(1).max(160),
  sequence_id: z.string().trim().min(1).max(160),
  contact_id: z.string().trim().min(1).max(160),
  normalized_email: normalizedEmailSchema,
  status: z.enum(["PAUSED", "ACTIVE", "FINISHED", "FAILED", "REMOVED"]),
  observed_at: timestampSchema,
  evidence_sha256: sha256Schema,
}).strict();

export const apolloExactReconciliationInputSchema = z.object({
  expected_email: normalizedEmailSchema,
  expected_sequence_id: z.string().trim().min(1).max(160),
  contacts: z.array(apolloExactContactSchema).max(3),
  enrollments: z.array(apolloEnrollmentReadbackSchema).max(3),
  aggregate_campaign_contact_count: z.number().int().min(0).nullable(),
  evaluated_at: timestampSchema,
  maximum_observation_age_seconds: z.number().int().min(30).max(900).default(300),
}).strict();

export type ApolloExactReconciliationInput = z.input<typeof apolloExactReconciliationInputSchema>;

export type ApolloExactReconciliation = {
  status: "VERIFIED_PAUSED" | "HOLD";
  exactEmail: string;
  contactId: string | null;
  enrollmentId: string | null;
  providerStatus: "PAUSED" | null;
  aggregateCountersTrusted: false;
  blockers: string[];
};

export function reconcileApolloExactPausedEnrollment(rawInput: ApolloExactReconciliationInput): ApolloExactReconciliation {
  const parsed = apolloExactReconciliationInputSchema.safeParse(rawInput);
  const fallbackEmail = typeof rawInput.expected_email === "string" ? rawInput.expected_email.trim().toLowerCase() : "invalid@invalid.local";
  if (!parsed.success) {
    return {
      status: "HOLD", exactEmail: fallbackEmail, contactId: null, enrollmentId: null,
      providerStatus: null, aggregateCountersTrusted: false, blockers: ["APOLLO_RESPONSE_SCHEMA_INVALID"],
    };
  }
  const input = parsed.data;
  const blockers: string[] = [];
  const exactContacts = input.contacts.filter((contact) => contact.normalized_email === input.expected_email);
  if (exactContacts.length !== 1) blockers.push("APOLLO_EXACT_CONTACT_CARDINALITY_INVALID");
  const contact = exactContacts.length === 1 ? (exactContacts.at(0) ?? null) : null;
  const exactEnrollments = contact === null ? [] : input.enrollments.filter((enrollment) => (
    enrollment.normalized_email === input.expected_email
    && enrollment.contact_id === contact.contact_id
    && enrollment.sequence_id === input.expected_sequence_id
  ));
  if (contact !== null && exactEnrollments.length !== 1) blockers.push("APOLLO_EXACT_ENROLLMENT_CARDINALITY_INVALID");
  const enrollment = exactEnrollments.length === 1 ? (exactEnrollments.at(0) ?? null) : null;
  if (enrollment !== null && enrollment.status !== "PAUSED") blockers.push("APOLLO_ENROLLMENT_NOT_PAUSED");

  const evaluatedAt = Date.parse(input.evaluated_at);
  for (const observation of [contact, enrollment]) {
    if (observation === null) continue;
    const ageMs = evaluatedAt - Date.parse(observation.observed_at);
    if (ageMs < -30_000 || ageMs > input.maximum_observation_age_seconds * 1_000) {
      blockers.push("APOLLO_INDIVIDUAL_READBACK_STALE");
      break;
    }
  }
  return {
    status: blockers.length === 0 ? "VERIFIED_PAUSED" : "HOLD",
    exactEmail: input.expected_email,
    contactId: contact?.contact_id ?? null,
    enrollmentId: enrollment?.enrollment_id ?? null,
    providerStatus: enrollment?.status === "PAUSED" ? "PAUSED" : null,
    aggregateCountersTrusted: false,
    blockers: [...new Set(blockers)],
  };
}
