import { NextResponse } from "next/server";

import { operationsRpcRejected, operationsRpcResponse, parseOperationsMutationInput } from "@/lib/operations/http";
import { uuidSchema } from "@/lib/operations/mutations";
import { getMutationContext } from "@/lib/operations/route";
import { replyReviewCommandSchema, replyReviewResultSchema } from "@/lib/operations/sla";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const { id } = await params;
  const providerEventId = uuidSchema.safeParse(id);
  if (!providerEventId.success) return operationsRpcRejected("REPLY_REVIEW_INPUT_INVALID", 400);
  const parsed = await parseOperationsMutationInput({
    request,
    schema: replyReviewCommandSchema,
    trustedValues: { organizationId: context.organizationId, providerEventId: providerEventId.data },
    protectedBodyKeys: ["providerEventId", "provider_event_id"],
  });
  if (!parsed.ok) return parsed.response;
  const { data, error } = await context.client.rpc("review_reply_and_route", {
    target_organization_id: context.organizationId,
    target_provider_event_id: providerEventId.data,
    target_classification: parsed.data.classification,
    target_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return operationsRpcRejected("REPLY_REVIEW_REJECTED");
  return operationsRpcResponse(replyReviewResultSchema, data);
}
