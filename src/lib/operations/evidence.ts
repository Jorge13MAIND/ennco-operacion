import { createHash } from "node:crypto";

export function commercialEvidenceLedgerChecksum(input: {
  organizationId: string;
  leadId: string;
  criterion: string;
  value: boolean | number;
  sourceUrl: string;
  sourceName: string;
  observedAt: string;
  confidence: "HIGH" | "VERIFIED";
}): string {
  const canonical = JSON.stringify([
    "ennco-commercial-evidence-v1",
    input.organizationId,
    input.leadId,
    input.criterion,
    input.value,
    new URL(input.sourceUrl).toString(),
    input.sourceName.trim(),
    new Date(input.observedAt).toISOString(),
    input.confidence,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

export function paymentEvidenceLedgerChecksum(input: {
  organizationId: string;
  opportunityId: string;
  amountMxn: number;
  paidAt: string;
  sourceUrl: string;
  sourceName: string;
  observedAt: string;
  confidence: "HIGH" | "VERIFIED";
}): string {
  const canonical = JSON.stringify([
    "ennco-payment-evidence-v1",
    input.organizationId,
    input.opportunityId,
    input.amountMxn,
    new Date(input.paidAt).toISOString(),
    new URL(input.sourceUrl).toString(),
    input.sourceName.trim(),
    new Date(input.observedAt).toISOString(),
    input.confidence,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}
