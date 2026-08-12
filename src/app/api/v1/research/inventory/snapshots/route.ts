import type { NextResponse } from "next/server";

import { getMutationContext } from "@/lib/operations/route";
import { freezeResearchInventorySnapshotRpcSchema } from "@/lib/research/contracts";
import {
  freezeResearchInventorySnapshotRpcResultSchema,
  parseResearchMutationInput,
  researchRpcRejected,
  researchRpcResponse,
} from "@/lib/research/http";

export async function POST(request: Request): Promise<NextResponse> {
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const parsed = await parseResearchMutationInput({
    request,
    schema: freezeResearchInventorySnapshotRpcSchema,
    trustedValues: { organizationId: context.organizationId },
  });
  if (!parsed.ok) return parsed.response;

  const { data, error } = await context.client.rpc("freeze_research_inventory_snapshot", {
    target_organization_id: context.organizationId,
    target_assessment_checksum: parsed.data.assessmentChecksum,
    target_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return researchRpcRejected("RESEARCH_INVENTORY_SNAPSHOT_REJECTED");
  return researchRpcResponse(freezeResearchInventorySnapshotRpcResultSchema, data, 201);
}
