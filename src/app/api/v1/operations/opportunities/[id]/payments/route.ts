import { NextResponse } from "next/server";

import { paymentEvidenceLedgerChecksum } from "@/lib/operations/evidence";
import { firstPaymentSchema, uuidSchema } from "@/lib/operations/mutations";
import { getMutationContext, mutationResponse, mutationUnavailable } from "@/lib/operations/route";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const { id } = await params;
  const opportunityId = uuidSchema.safeParse(id);
  const payload = firstPaymentSchema.safeParse(await request.json().catch(() => null));
  if (!opportunityId.success || !payload.success) {
    return NextResponse.json({ error: "FIRST_PAYMENT_INPUT_INVALID" }, { status: 400 });
  }
  const sourceUrl = new URL(payload.data.sourceUrl).toString();
  const observedAt = new Date(payload.data.observedAt).toISOString();
  const paidAt = new Date(payload.data.paidAt).toISOString();
  const checksum = paymentEvidenceLedgerChecksum({
    organizationId: context.organizationId,
    opportunityId: opportunityId.data,
    amountMxn: payload.data.amountMxn,
    paidAt,
    sourceUrl,
    sourceName: payload.data.sourceName,
    observedAt,
    confidence: payload.data.confidence,
  });
  const payment = await context.client.rpc("record_first_payment_with_evidence", {
    target_organization_id: context.organizationId,
    target_opportunity_id: opportunityId.data,
    target_amount_mxn: payload.data.amountMxn,
    target_paid_at: paidAt,
    target_source_url: sourceUrl,
    target_source_name: payload.data.sourceName,
    target_observed_at: observedAt,
    target_confidence: payload.data.confidence,
    target_checksum: checksum,
    target_idempotency_key: `first-payment:${opportunityId.data}`,
  });
  if (payment.error) return mutationUnavailable("FIRST_PAYMENT_REJECTED");
  return mutationResponse({ result: payment.data, checksum });
}
