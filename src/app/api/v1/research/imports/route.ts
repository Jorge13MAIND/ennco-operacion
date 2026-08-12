import type { NextResponse } from "next/server";

import { ingestResearchBatchRpcSchema } from "@/lib/research/contracts";
import {
  ingestResearchBatchRpcResultSchema,
  parseResearchMutationInput,
  researchRpcRejected,
  researchRpcResponse,
} from "@/lib/research/http";
import { getMutationContext } from "@/lib/operations/route";

export async function POST(request: Request): Promise<NextResponse> {
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const parsed = await parseResearchMutationInput({
    request,
    schema: ingestResearchBatchRpcSchema,
    trustedValues: { organizationId: context.organizationId },
  });
  if (!parsed.ok) return parsed.response;

  const { data, error } = await context.client.rpc("ingest_research_batch", {
    target_organization_id: context.organizationId,
    target_source_name: parsed.data.sourceName,
    target_source_sha256: parsed.data.sourceSha256,
    target_manifest_sha256: parsed.data.manifestSha256,
    target_rows_jsonb: parsed.data.rows,
    target_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) return researchRpcRejected("RESEARCH_IMPORT_REJECTED");
  return researchRpcResponse(ingestResearchBatchRpcResultSchema, data, 201);
}
