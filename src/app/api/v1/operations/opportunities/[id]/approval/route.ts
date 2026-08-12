import type { NextResponse } from "next/server";

import { operationsRpcRejected, operationsRpcResponse, parseOperationsMutationInput } from "@/lib/operations/http";
import { uuidSchema } from "@/lib/operations/mutations";
import { getMutationContext } from "@/lib/operations/route";
import { approvalRequestCommandSchema, approvalRequestResultSchema } from "@/lib/operations/sla";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const opportunityId = uuidSchema.safeParse((await params).id);
  if (!opportunityId.success) return operationsRpcRejected("OPPORTUNITY_ID_INVALID", 400);
  const parsed = await parseOperationsMutationInput({
    request,
    schema: approvalRequestCommandSchema,
    trustedValues: { organizationId: context.organizationId, opportunityId: opportunityId.data },
    protectedBodyKeys: ["opportunityId", "opportunity_id"],
  });
  if (!parsed.ok) return parsed.response;
  const { data, error } = await context.client.rpc("request_closed_won_approval", {
    target_organization_id: context.organizationId,
    target_opportunity_id: opportunityId.data,
    target_request_reason: parsed.data.requestReason,
    target_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return operationsRpcRejected("APPROVAL_REQUEST_REJECTED");
  return operationsRpcResponse(approvalRequestResultSchema, data);
}
