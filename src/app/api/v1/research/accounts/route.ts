import type { NextResponse } from "next/server";

import { getMutationContext } from "@/lib/operations/route";
import { upsertResearchAccountRpcSchema } from "@/lib/research/contracts";
import {
  parseResearchMutationInput,
  researchRpcRejected,
  researchRpcResponse,
  upsertResearchAccountRpcResultSchema,
} from "@/lib/research/http";

export async function POST(request: Request): Promise<NextResponse> {
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const parsed = await parseResearchMutationInput({
    request,
    schema: upsertResearchAccountRpcSchema,
    trustedValues: { organizationId: context.organizationId },
  });
  if (!parsed.ok) return parsed.response;

  const { data, error } = await context.client.rpc("upsert_research_account", {
    target_organization_id: context.organizationId,
    target_source_record_id: parsed.data.sourceRecordId,
    target_legal_name: parsed.data.legalName,
    target_primary_domain: parsed.data.primaryDomain,
    target_city: parsed.data.city,
    target_state: parsed.data.state,
    target_industrial_park: parsed.data.industrialPark,
    target_sector: parsed.data.sector,
    target_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return researchRpcRejected("RESEARCH_ACCOUNT_REJECTED");
  return researchRpcResponse(upsertResearchAccountRpcResultSchema, data);
}
