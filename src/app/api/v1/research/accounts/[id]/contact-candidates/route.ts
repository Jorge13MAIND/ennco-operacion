import type { NextResponse } from "next/server";

import { getMutationContext } from "@/lib/operations/route";
import { researchUuidSchema, upsertContactCandidateRpcSchema } from "@/lib/research/contracts";
import {
  parseResearchMutationInput,
  researchRpcRejected,
  researchRpcResponse,
  upsertContactCandidateRpcResultSchema,
} from "@/lib/research/http";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const accountId = researchUuidSchema.safeParse((await params).id);
  if (!accountId.success) return researchRpcRejected("RESEARCH_INPUT_INVALID", 400);
  const parsed = await parseResearchMutationInput({
    request,
    schema: upsertContactCandidateRpcSchema,
    trustedValues: { organizationId: context.organizationId, accountId: accountId.data },
    protectedBodyKeys: ["accountId", "account_id"],
  });
  if (!parsed.ok) return parsed.response;

  const { data, error } = await context.client.rpc("upsert_contact_candidate", {
    target_organization_id: context.organizationId,
    target_account_id: accountId.data,
    target_full_name: parsed.data.fullName,
    target_role_title: parsed.data.roleTitle,
    target_role_category: parsed.data.roleCategory,
    target_normalized_email: parsed.data.normalizedEmail,
    target_evidence_ids: parsed.data.evidenceIds,
    target_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return researchRpcRejected("RESEARCH_CONTACT_CANDIDATE_REJECTED");
  return researchRpcResponse(upsertContactCandidateRpcResultSchema, data);
}
