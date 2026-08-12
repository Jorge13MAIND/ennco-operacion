import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { capacityScheduleResultSchema, mapCapacityRpcError, scheduleResultMatchesRequest } from "@/lib/operations/capacity";
import { capacityScheduleSchema, uuidSchema } from "@/lib/operations/mutations";
import { getMutationContext, mutationResponse } from "@/lib/operations/route";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const { id } = await params;
  const opportunityId = uuidSchema.safeParse(id);
  const payload = capacityScheduleSchema.safeParse(await request.json().catch(() => null));
  if (!opportunityId.success || !payload.success) {
    return NextResponse.json({ error: "CAPACITY_SCHEDULE_INPUT_INVALID" }, { status: 400 });
  }
  const idempotencyKey = createHash("sha256")
    .update([
      "capacity-v1",
      context.organizationId,
      opportunityId.data,
      payload.data.commandId,
      payload.data.executionDate,
      payload.data.changeReason,
    ].join(":"))
    .digest("hex");
  const { data, error } = await context.client.rpc("schedule_closed_won_capacity", {
    target_organization_id: context.organizationId,
    target_opportunity_id: opportunityId.data,
    target_execution_date: payload.data.executionDate,
    target_change_reason: payload.data.changeReason,
    target_idempotency_key: idempotencyKey,
  });
  if (error) {
    const mapped = mapCapacityRpcError(error);
    return NextResponse.json({ error: mapped.code }, { status: mapped.status, headers: { "Cache-Control": "private, no-store" } });
  }
  const result = capacityScheduleResultSchema.safeParse(data);
  if (!result.success || !scheduleResultMatchesRequest(result.data, {
    organizationId: context.organizationId,
    opportunityId: opportunityId.data,
    executionDate: payload.data.executionDate,
  })) {
    return NextResponse.json({ error: "CAPACITY_RESPONSE_INVALID" }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
  }
  return mutationResponse(result.data);
}
