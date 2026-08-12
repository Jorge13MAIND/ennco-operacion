import type { NextResponse } from "next/server";

import { operationsRpcRejected, operationsRpcResponse, parseOperationsMutationInput } from "@/lib/operations/http";
import { uuidSchema } from "@/lib/operations/mutations";
import { getMutationContext } from "@/lib/operations/route";
import { incidentTransitionCommandSchema, incidentTransitionResultSchema } from "@/lib/operations/sla";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const incidentId = uuidSchema.safeParse((await params).id);
  if (!incidentId.success) return operationsRpcRejected("INCIDENT_ID_INVALID", 400);
  const parsed = await parseOperationsMutationInput({
    request,
    schema: incidentTransitionCommandSchema,
    trustedValues: { organizationId: context.organizationId, incidentId: incidentId.data },
    protectedBodyKeys: ["incidentId", "incident_id"],
  });
  if (!parsed.ok) return parsed.response;
  const { data, error } = await context.client.rpc("transition_operational_incident", {
    target_organization_id: context.organizationId,
    target_incident_id: incidentId.data,
    target_action: parsed.data.action,
    target_evidence_sha256: parsed.data.evidenceSha256,
    target_detail: parsed.data.detail,
    target_recovery_test_passed: parsed.data.recoveryTestPassed,
    target_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return operationsRpcRejected("INCIDENT_TRANSITION_REJECTED");
  return operationsRpcResponse(incidentTransitionResultSchema, data);
}
