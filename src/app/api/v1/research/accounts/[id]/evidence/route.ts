import type { NextResponse } from "next/server";

import { getMutationContext } from "@/lib/operations/route";
import { recordResearchEvidenceRpcSchema, researchUuidSchema } from "@/lib/research/contracts";
import {
  parseResearchMutationInput,
  recordResearchEvidenceRpcResultSchema,
  researchRpcRejected,
  researchRpcResponse,
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
    schema: recordResearchEvidenceRpcSchema,
    trustedValues: {
      organizationId: context.organizationId,
      subjectType: "ACCOUNT",
      subjectId: accountId.data,
    },
    protectedBodyKeys: ["subjectType", "subject_type", "subjectId", "subject_id"],
  });
  if (!parsed.ok) return parsed.response;

  const { data, error } = await context.client.rpc("record_research_evidence", {
    target_organization_id: context.organizationId,
    target_subject_type: parsed.data.subjectType,
    target_subject_id: parsed.data.subjectId,
    target_field_name: parsed.data.fieldName,
    target_source_url: parsed.data.sourceUrl,
    target_source_name: parsed.data.sourceName,
    target_observed_at: parsed.data.observedAt,
    target_confidence: parsed.data.confidence,
    target_value_json: parsed.data.valueJson,
    target_checksum: parsed.data.checksum,
    target_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return researchRpcRejected("RESEARCH_EVIDENCE_REJECTED");
  return researchRpcResponse(recordResearchEvidenceRpcResultSchema, data, 201);
}
