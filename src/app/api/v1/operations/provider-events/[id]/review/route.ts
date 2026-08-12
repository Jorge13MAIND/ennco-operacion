import { NextResponse } from "next/server";

import { replyReviewSchema, uuidSchema } from "@/lib/operations/mutations";
import { getMutationContext, mutationResponse, mutationUnavailable } from "@/lib/operations/route";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const providerEventId = uuidSchema.safeParse(id);
  const payload = replyReviewSchema.safeParse(await request.json().catch(() => null));
  if (!providerEventId.success || !payload.success) {
    return NextResponse.json({ error: "REPLY_REVIEW_INPUT_INVALID" }, { status: 400 });
  }
  const context = await getMutationContext();
  if (!context.ok) return context.response;
  const { data, error } = await context.client.rpc("review_reply_event", {
    target_organization_id: context.organizationId,
    target_provider_event_id: providerEventId.data,
    target_classification: payload.data.classification,
  });
  if (error) return mutationUnavailable("REPLY_REVIEW_REJECTED");
  return mutationResponse(data);
}
