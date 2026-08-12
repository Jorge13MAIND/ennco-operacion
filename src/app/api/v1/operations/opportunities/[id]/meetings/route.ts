import { NextResponse } from "next/server";

import { meetingScheduleSchema, uuidSchema } from "@/lib/operations/mutations";
import { getMutationContext, mutationResponse, mutationUnavailable } from "@/lib/operations/route";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const opportunityId = uuidSchema.safeParse(id);
  const payload = meetingScheduleSchema.safeParse(await request.json().catch(() => null));
  if (!opportunityId.success || !payload.success) {
    return NextResponse.json({ error: "MEETING_SCHEDULE_INPUT_INVALID" }, { status: 400 });
  }
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const { data, error } = await context.client.rpc("schedule_meeting", {
    target_organization_id: context.organizationId,
    target_opportunity_id: opportunityId.data,
    target_scheduled_at: payload.data.scheduledAt,
    target_idempotency_key: `meeting:${opportunityId.data}:${payload.data.scheduledAt}`,
  });
  if (error) return mutationUnavailable("MEETING_SCHEDULE_REJECTED");
  return mutationResponse(data);
}
