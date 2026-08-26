import type { NextResponse } from "next/server";

import { operationsRpcRejected, operationsRpcResponse, parseOperationsMutationInput } from "@/lib/operations/http";
import { uuidSchema } from "@/lib/operations/mutations";
import { getMutationContext } from "@/lib/operations/route";
import { taskAssignmentCommandSchema, taskAssignmentResultSchema } from "@/lib/operations/sla";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const taskId = uuidSchema.safeParse((await params).id);
  if (!taskId.success) return operationsRpcRejected("TASK_ID_INVALID", 400);
  const parsed = await parseOperationsMutationInput({
    request,
    schema: taskAssignmentCommandSchema,
    trustedValues: { organizationId: context.organizationId, taskId: taskId.data },
    protectedBodyKeys: ["taskId", "task_id"],
  });
  if (!parsed.ok) return parsed.response;
  const { data, error } = await context.client.rpc("assign_operational_task", {
    target_organization_id: context.organizationId,
    target_task_id: taskId.data,
    target_owner_user_id: parsed.data.ownerUserId,
    target_backup_user_id: parsed.data.backupUserId ?? null,
    target_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return operationsRpcRejected("TASK_ASSIGNMENT_REJECTED");
  return operationsRpcResponse(taskAssignmentResultSchema, data);
}
