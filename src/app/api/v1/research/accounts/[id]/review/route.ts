import type { NextResponse } from "next/server";

import { getMutationContext } from "@/lib/operations/route";
import { researchUuidSchema, submitResearchReviewRpcSchema } from "@/lib/research/contracts";
import {
  parseResearchMutationInput,
  researchRpcRejected,
  researchRpcResponse,
  submitResearchReviewRpcResultSchema,
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
    schema: submitResearchReviewRpcSchema,
    trustedValues: {
      organizationId: context.organizationId,
      subjectType: "ACCOUNT",
      subjectId: accountId.data,
    },
    protectedBodyKeys: ["subjectType", "subject_type", "subjectId", "subject_id"],
  });
  if (!parsed.ok) return parsed.response;

  const { data, error } = await context.client.rpc("submit_research_review", {
    target_organization_id: context.organizationId,
    target_subject_type: parsed.data.subjectType,
    target_subject_id: parsed.data.subjectId,
    target_decision: parsed.data.decision,
    target_evidence_ids: parsed.data.evidenceIds,
    target_review_notes: parsed.data.reviewNotes,
    target_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return researchRpcRejected("RESEARCH_REVIEW_REJECTED");
  return researchRpcResponse(submitResearchReviewRpcResultSchema, data);
}
