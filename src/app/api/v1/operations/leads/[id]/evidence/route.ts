import { NextResponse } from "next/server";

import { commercialEvidenceLedgerChecksum } from "@/lib/operations/evidence";
import { commercialEvidenceSchema, uuidSchema } from "@/lib/operations/mutations";
import { getMutationContext, mutationResponse, mutationUnavailable } from "@/lib/operations/route";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const leadId = uuidSchema.safeParse(id);
  const payload = commercialEvidenceSchema.safeParse(await request.json().catch(() => null));
  if (!leadId.success || !payload.success) {
    return NextResponse.json({ error: "COMMERCIAL_EVIDENCE_INPUT_INVALID" }, { status: 400 });
  }
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const sourceUrl = new URL(payload.data.sourceUrl).toString();
  const observedAt = new Date(payload.data.observedAt).toISOString();
  const checksum = commercialEvidenceLedgerChecksum({
    organizationId: context.organizationId,
    leadId: leadId.data,
    criterion: payload.data.criterion,
    value: payload.data.value,
    sourceUrl,
    sourceName: payload.data.sourceName,
    observedAt,
    confidence: payload.data.confidence,
  });
  const { data, error } = await context.client.rpc("record_source_evidence", {
    target_organization_id: context.organizationId,
    target_subject_type: "lead",
    target_subject_id: leadId.data,
    target_field_name: payload.data.criterion,
    target_source_url: sourceUrl,
    target_source_name: payload.data.sourceName,
    target_observed_at: observedAt,
    target_confidence: payload.data.confidence,
    target_value_json: payload.data.value,
    target_checksum: checksum,
  });
  if (error || typeof data !== "string") return mutationUnavailable("COMMERCIAL_EVIDENCE_REJECTED");
  return mutationResponse({ evidence_record_id: data, criterion: payload.data.criterion, checksum });
}
