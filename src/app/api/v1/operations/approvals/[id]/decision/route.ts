import type { NextResponse } from "next/server";

import { operationsRpcRejected, operationsRpcResponse, parseOperationsMutationInput } from "@/lib/operations/http";
import { uuidSchema } from "@/lib/operations/mutations";
import { getMutationContext } from "@/lib/operations/route";
import { approvalDecisionCommandSchema, approvalDecisionResultSchema } from "@/lib/operations/sla";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const requestId = uuidSchema.safeParse((await params).id);
  if (!requestId.success) return operationsRpcRejected("APPROVAL_REQUEST_ID_INVALID", 400);
  const parsed = await parseOperationsMutationInput({
    request,
    schema: approvalDecisionCommandSchema,
    trustedValues: { organizationId: context.organizationId, requestId: requestId.data },
    protectedBodyKeys: ["requestId", "request_id"],
  });
  if (!parsed.ok) return parsed.response;
  const { data, error } = await context.client.rpc("decide_operational_approval", {
    target_organization_id: context.organizationId,
    target_request_id: requestId.data,
    target_subject_sha256: parsed.data.subjectSha256,
    target_decision: parsed.data.decision,
    target_rationale: parsed.data.rationale,
    target_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return operationsRpcRejected("APPROVAL_DECISION_REJECTED");
  const result = approvalDecisionResultSchema.safeParse(data);
  if (!result.success) return operationsRpcResponse(approvalDecisionResultSchema, data);
  if (result.data.status === "EXPIRED") return operationsRpcRejected("APPROVAL_REQUEST_EXPIRED");
  return operationsRpcResponse(approvalDecisionResultSchema, result.data);
}
