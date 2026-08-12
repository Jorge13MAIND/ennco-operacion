import type { NextResponse } from "next/server";

import { getMutationContext } from "@/lib/operations/route";
import { researchUuidSchema, resolveResearchDedupeRpcSchema } from "@/lib/research/contracts";
import {
  parseResearchMutationInput,
  researchRpcRejected,
  researchRpcResponse,
  resolveResearchDedupeRpcResultSchema,
} from "@/lib/research/http";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const caseId = researchUuidSchema.safeParse((await params).id);
  if (!caseId.success) return researchRpcRejected("RESEARCH_INPUT_INVALID", 400);
  const parsed = await parseResearchMutationInput({
    request,
    schema: resolveResearchDedupeRpcSchema,
    trustedValues: { organizationId: context.organizationId, caseId: caseId.data },
    protectedBodyKeys: ["caseId", "case_id"],
  });
  if (!parsed.ok) return parsed.response;

  const { data, error } = await context.client.rpc("resolve_research_dedupe", {
    target_organization_id: context.organizationId,
    target_case_id: caseId.data,
    target_decision: parsed.data.decision,
    target_canonical_account_id: parsed.data.canonicalAccountId,
    target_rationale: parsed.data.rationale,
    target_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return researchRpcRejected("RESEARCH_DEDUPE_RESOLUTION_REJECTED");
  return researchRpcResponse(resolveResearchDedupeRpcResultSchema, data);
}
