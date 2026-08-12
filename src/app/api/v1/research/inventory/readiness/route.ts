import type { NextResponse } from "next/server";

import {
  assessResearchInventoryRpcResultSchema,
  getResearchReadContext,
  researchRpcRejected,
  researchRpcResponse,
} from "@/lib/research/http";

export async function GET(): Promise<NextResponse> {
  const authorized = await getResearchReadContext();
  if (!authorized.ok) return authorized.response;
  const { data, error } = await authorized.context.client.rpc("assess_research_inventory", {
    target_organization_id: authorized.context.organizationId,
  });
  if (error) return researchRpcRejected("RESEARCH_INVENTORY_ASSESSMENT_REJECTED");
  return researchRpcResponse(assessResearchInventoryRpcResultSchema, data);
}
