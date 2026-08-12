import { NextResponse } from "next/server";

import { meetingOutcomeSchema, uuidSchema } from "@/lib/operations/mutations";
import { getMutationContext, mutationResponse, mutationUnavailable } from "@/lib/operations/route";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const meetingId = uuidSchema.safeParse(id);
  const payload = meetingOutcomeSchema.safeParse(await request.json().catch(() => null));
  if (!meetingId.success || !payload.success) {
    return NextResponse.json({ error: "MEETING_OUTCOME_INPUT_INVALID" }, { status: 400 });
  }
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const { data, error } = await context.client.rpc("record_meeting_outcome", {
    target_organization_id: context.organizationId,
    target_meeting_id: meetingId.data,
    target_held_at: payload.data.heldAt,
    target_attendance_verified: payload.data.attendanceVerified,
    target_outcome_notes: payload.data.outcomeNotes,
  });
  if (error) return mutationUnavailable("MEETING_OUTCOME_REJECTED");
  return mutationResponse(data);
}
