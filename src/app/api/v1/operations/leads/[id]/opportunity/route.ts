import { NextResponse } from "next/server";

import { uuidSchema } from "@/lib/operations/mutations";
import { getMutationContext, mutationResponse, mutationUnavailable } from "@/lib/operations/route";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const leadId = uuidSchema.safeParse(id);
  if (!leadId.success) {
    return NextResponse.json({ error: "OPPORTUNITY_CREATE_INPUT_INVALID" }, { status: 400 });
  }
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const { data, error } = await context.client.rpc("create_opportunity_from_strict_lead", {
    target_organization_id: context.organizationId,
    target_lead_id: leadId.data,
    target_initial_stage: "PROSPECTING",
    target_idempotency_key: `strict-lead:${leadId.data}`,
  });
  if (error) return mutationUnavailable("OPPORTUNITY_CREATE_REJECTED");
  return mutationResponse(data);
}
