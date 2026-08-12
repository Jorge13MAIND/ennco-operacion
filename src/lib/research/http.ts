import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOperationsAccess } from "@/lib/auth/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const MAX_RESEARCH_BODY_CHARACTERS = 2_000_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" } as const;

const uuidSchema = z.uuid();
const sha256Schema = z.string().regex(SHA256_PATTERN);
const nonNegativeCountSchema = z.number().int().nonnegative();

export const ingestResearchBatchRpcResultSchema = z.object({
  status: z.enum(["CREATED", "DUPLICATE"]),
  batch_id: uuidSchema,
  created: nonNegativeCountSchema,
  matched: nonNegativeCountSchema,
  quarantined: nonNegativeCountSchema,
  duplicate_cases: nonNegativeCountSchema,
}).strict();

export const upsertResearchAccountRpcResultSchema = z.object({
  status: z.enum(["CREATED", "UPDATED", "DUPLICATE", "DUPLICATE_CANDIDATE"]),
  account_id: uuidSchema.nullable(),
  dedupe_case_id: uuidSchema.nullable(),
}).strict();

export const recordResearchEvidenceRpcResultSchema = z.object({
  status: z.enum(["CREATED", "DUPLICATE"]),
  evidence_id: uuidSchema,
}).strict();

export const submitResearchReviewRpcResultSchema = z.object({
  status: z.enum(["VERIFIED", "QUARANTINED", "REJECTED", "DUPLICATE"]),
  review_id: uuidSchema,
  subject_id: uuidSchema,
  research_status: z.enum(["SEED", "IN_REVIEW", "VERIFIED", "QUARANTINED", "MERGED", "REJECTED"]),
}).strict();

export const upsertContactCandidateRpcResultSchema = z.object({
  status: z.enum(["CREATED", "UPDATED", "DUPLICATE", "DUPLICATE_CANDIDATE"]),
  candidate_id: uuidSchema.nullable(),
  duplicate_candidate_id: uuidSchema.nullable(),
  role_category: z.enum(["CEO", "PLANT_DIRECTOR", "MAINTENANCE", "PROCUREMENT", "OTHER"]),
}).strict();

export const verifyContactCandidateRpcResultSchema = z.object({
  status: z.enum(["PROMOTED", "DUPLICATE", "HOLD"]),
  contact_id: uuidSchema.nullable(),
  blockers: z.array(z.string().regex(/^[A-Z0-9_:-]{1,100}$/u)).max(50),
}).strict();

export const resolveResearchDedupeRpcResultSchema = z.object({
  status: z.enum(["RESOLVED", "DUPLICATE"]),
  canonical_account_id: uuidSchema.nullable(),
  aliases_created: nonNegativeCountSchema,
}).strict();

export const assessResearchInventoryRpcResultSchema = z.object({
  status: z.literal("ASSESSED"),
  decision: z.enum(["PASS", "EXTEND", "KILL"]),
  verified_accounts: nonNegativeCountSchema,
  verified_contacts: nonNegativeCountSchema,
  target_accounts: z.literal(75),
  target_contacts: z.literal(150),
  outreach_state: z.literal("RESEARCH_ONLY_HOLD"),
  outreach_eligible_records: z.literal(0),
  blockers: z.array(z.string().regex(/^[A-Z0-9_:-]{1,100}$/u)).max(100),
  assessment_checksum: sha256Schema,
}).strict();

export const freezeResearchInventorySnapshotRpcResultSchema = z.object({
  status: z.enum(["CREATED", "DUPLICATE"]),
  snapshot_id: uuidSchema,
  decision: z.enum(["PASS", "EXTEND", "KILL"]),
  snapshot_sha256: sha256Schema,
  outreach_state: z.literal("RESEARCH_ONLY_HOLD"),
  outreach_eligible_records: z.literal(0),
}).strict();

export type ResearchReadContext = {
  organizationId: string;
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>;
};

export type ParsedResearchInput<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse };

function errorResponse(code: string, status: number): NextResponse {
  return NextResponse.json(
    { error: code, correlation_id: crypto.randomUUID() },
    { status, headers: PRIVATE_HEADERS },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function getResearchReadContext(): Promise<
  | { ok: true; context: ResearchReadContext }
  | { ok: false; response: NextResponse }
> {
  try {
    const access = await requireOperationsAccess();
    if (access.evidenceClass !== "live" || !access.organizationId) {
      return { ok: false, response: errorResponse("SYNTHETIC_RESEARCH_READ_DISABLED", 409) };
    }
    return {
      ok: true,
      context: {
        organizationId: access.organizationId,
        client: await createSupabaseServerClient(),
      },
    };
  } catch {
    return { ok: false, response: errorResponse("RESEARCH_AUTHORIZATION_REQUIRED", 401) };
  }
}

export async function parseResearchMutationInput<T>(input: {
  request: Request;
  schema: z.ZodType<T>;
  trustedValues: Readonly<Record<string, unknown>>;
  protectedBodyKeys?: readonly string[];
}): Promise<ParsedResearchInput<T>> {
  const idempotencyKey = input.request.headers.get("Idempotency-Key") ?? "";
  if (!SHA256_PATTERN.test(idempotencyKey)) {
    return { ok: false, response: errorResponse("RESEARCH_IDEMPOTENCY_KEY_INVALID", 400) };
  }

  const declaredLength = input.request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > MAX_RESEARCH_BODY_CHARACTERS) {
      return { ok: false, response: errorResponse("RESEARCH_BODY_INVALID", 400) };
    }
  }

  let text: string;
  try {
    text = await input.request.text();
  } catch {
    return { ok: false, response: errorResponse("RESEARCH_BODY_INVALID", 400) };
  }
  if (!text || text.length > MAX_RESEARCH_BODY_CHARACTERS) {
    return { ok: false, response: errorResponse("RESEARCH_BODY_INVALID", 400) };
  }

  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, response: errorResponse("RESEARCH_BODY_INVALID", 400) };
  }
  if (!isRecord(body)) return { ok: false, response: errorResponse("RESEARCH_BODY_INVALID", 400) };

  const protectedKeys = new Set([
    "organizationId",
    "organization_id",
    "idempotencyKey",
    "idempotency_key",
    ...(input.protectedBodyKeys ?? []),
  ]);
  if (Object.keys(body).some((key) => protectedKeys.has(key))) {
    return { ok: false, response: errorResponse("RESEARCH_TRUSTED_FIELD_IN_BODY", 400) };
  }

  const parsed = input.schema.safeParse({
    ...body,
    ...input.trustedValues,
    idempotencyKey,
  });
  if (!parsed.success) return { ok: false, response: errorResponse("RESEARCH_INPUT_INVALID", 400) };
  return { ok: true, data: parsed.data };
}

export function researchRpcResponse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  status = 200,
): NextResponse {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return errorResponse("RESEARCH_RPC_RESPONSE_INVALID", 502);
  return NextResponse.json(parsed.data, { status, headers: PRIVATE_HEADERS });
}

export function researchRpcRejected(code: string, status = 409): NextResponse {
  return errorResponse(code, status);
}
