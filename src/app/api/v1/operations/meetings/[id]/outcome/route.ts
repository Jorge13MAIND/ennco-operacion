import { NextResponse } from "next/server";

import { operationsRpcRejected, operationsRpcResponse, parseOperationsMutationInput } from "@/lib/operations/http";
import { uuidSchema } from "@/lib/operations/mutations";
import { getMutationContext } from "@/lib/operations/route";
import { meetingOutcomeCommandSchema, meetingOutcomeResultSchema } from "@/lib/operations/sla";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const { id } = await params;
  const meetingId = uuidSchema.safeParse(id);
  if (!meetingId.success) return operationsRpcRejected("MEETING_OUTCOME_INPUT_INVALID", 400);
  const parsed = await parseOperationsMutationInput({
    request,
    schema: meetingOutcomeCommandSchema,
    trustedValues: { organizationId: context.organizationId, meetingId: meetingId.data },
    protectedBodyKeys: ["meetingId", "meeting_id"],
  });
  if (!parsed.ok) return parsed.response;
  const { data, error } = await context.client.rpc("record_meeting_outcome_v2", {
    target_organization_id: context.organizationId,
    target_meeting_id: meetingId.data,
    target_outcome_status: parsed.data.outcomeStatus,
    target_occurred_at: parsed.data.occurredAt,
    target_outcome_notes: parsed.data.outcomeNotes,
    target_evidence_sha256: parsed.data.evidenceSha256,
    target_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return operationsRpcRejected("MEETING_OUTCOME_REJECTED");
  return operationsRpcResponse(meetingOutcomeResultSchema, data);
}
