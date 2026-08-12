import type { NextResponse } from "next/server";

import { getMutationContext } from "@/lib/operations/route";
import { researchUuidSchema, verifyContactCandidateRpcSchema } from "@/lib/research/contracts";
import {
  parseResearchMutationInput,
  researchRpcRejected,
  researchRpcResponse,
  verifyContactCandidateRpcResultSchema,
} from "@/lib/research/http";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const candidateId = researchUuidSchema.safeParse((await params).id);
  if (!candidateId.success) return researchRpcRejected("RESEARCH_INPUT_INVALID", 400);
  const parsed = await parseResearchMutationInput({
    request,
    schema: verifyContactCandidateRpcSchema,
    trustedValues: { organizationId: context.organizationId, candidateId: candidateId.data },
    protectedBodyKeys: ["candidateId", "candidate_id"],
  });
  if (!parsed.ok) return parsed.response;

  const { data, error } = await context.client.rpc("verify_contact_candidate", {
    target_organization_id: context.organizationId,
    target_candidate_id: candidateId.data,
    target_role_evidence_id: parsed.data.roleEvidenceId,
    target_email_evidence_id: parsed.data.emailEvidenceId,
    target_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return researchRpcRejected("RESEARCH_CONTACT_VERIFICATION_REJECTED");
  return researchRpcResponse(verifyContactCandidateRpcResultSchema, data);
}
