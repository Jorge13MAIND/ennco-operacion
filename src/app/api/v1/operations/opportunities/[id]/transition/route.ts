import { NextResponse } from "next/server";

import { opportunityTransitionSchema, uuidSchema } from "@/lib/operations/mutations";
import { getMutationContext, mutationResponse, mutationUnavailable } from "@/lib/operations/route";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const opportunityId = uuidSchema.safeParse(id);
  const payload = opportunityTransitionSchema.safeParse(await request.json().catch(() => null));
  if (!opportunityId.success || !payload.success) {
    return NextResponse.json({ error: "OPPORTUNITY_TRANSITION_INPUT_INVALID" }, { status: 400 });
  }
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const { data, error } = await context.client.rpc("transition_opportunity", {
    target_organization_id: context.organizationId,
    target_opportunity_id: opportunityId.data,
    target_stage: payload.data.stage,
    target_economic_buyer: payload.data.economicBuyer,
    target_active_pain: payload.data.activePain,
    target_business_impact: payload.data.businessImpact,
    target_timing_under_90_days: payload.data.timingUnder90Days,
    target_value_mxn: payload.data.valueMxn,
    target_next_action: payload.data.nextAction,
    target_next_action_at: payload.data.nextActionAt,
  });
  if (error) return mutationUnavailable("OPPORTUNITY_TRANSITION_REJECTED");
  return mutationResponse(data);
}
