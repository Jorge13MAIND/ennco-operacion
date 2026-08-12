import { NextResponse } from "next/server";

import { strictLeadQualificationSchema, uuidSchema } from "@/lib/operations/mutations";
import { getMutationContext, mutationResponse, mutationUnavailable } from "@/lib/operations/route";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const leadId = uuidSchema.safeParse(id);
  const payload = strictLeadQualificationSchema.safeParse(await request.json().catch(() => null));
  if (!leadId.success || !payload.success) {
    return NextResponse.json({ error: "STRICT_LEAD_INPUT_INVALID" }, { status: 400 });
  }
  const context = await getMutationContext();
  if (!context.ok) return context.response;
  const { data, error } = await context.client.rpc("qualify_lead_strict", {
    target_organization_id: context.organizationId,
    target_lead_id: leadId.data,
    target_industrial_over_100_kwp: payload.data.industrialOver100Kwp,
    target_outside_annex_a: payload.data.outsideAnnexA,
    target_verified_target_role: payload.data.verifiedTargetRole,
    target_explicit_interest: payload.data.explicitInterest,
    target_monthly_spend_mxn: payload.data.monthlySpendMxn,
    target_evidence_record_ids: payload.data.evidenceRecordIds,
  });
  if (error) return mutationUnavailable("STRICT_LEAD_QUALIFICATION_REJECTED");
  return mutationResponse(data);
}
