import { describe, expect, it } from "vitest";

import { commercialEvidenceLedgerChecksum, paymentEvidenceLedgerChecksum } from "@/lib/operations/evidence";

describe("commercialEvidenceLedgerChecksum", () => {
  it("is deterministic and changes when the commercial fact changes", () => {
    const input = {
      organizationId: "11111111-1111-4111-8111-111111111111",
      leadId: "22222222-2222-4222-8222-222222222222",
      criterion: "outside_annex_a",
      value: true,
      sourceUrl: "https://example.invalid/source",
      sourceName: "Registro sintético",
      observedAt: "2026-08-12T12:00:00.000Z",
      confidence: "VERIFIED" as const,
    };
    const first = commercialEvidenceLedgerChecksum(input);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(commercialEvidenceLedgerChecksum(input)).toBe(first);
    expect(commercialEvidenceLedgerChecksum({ ...input, value: false })).not.toBe(first);
  });
});

describe("payment evidence checksum", () => {
  it("is deterministic and changes with the amount", () => {
    const base = {
      organizationId: "11111111-1111-4111-8111-111111111111",
      opportunityId: "22222222-2222-4222-8222-222222222222",
      amountMxn: 100_000,
      paidAt: "2026-08-12T12:00:00.000Z",
      sourceUrl: "https://example.invalid/payment",
      sourceName: "Comprobante",
      observedAt: "2026-08-12T12:05:00.000Z",
      confidence: "VERIFIED" as const,
    };
    expect(paymentEvidenceLedgerChecksum(base)).toMatch(/^[a-f0-9]{64}$/);
    expect(paymentEvidenceLedgerChecksum(base)).toBe(paymentEvidenceLedgerChecksum({ ...base }));
    expect(paymentEvidenceLedgerChecksum(base)).not.toBe(paymentEvidenceLedgerChecksum({ ...base, amountMxn: 100_001 }));
  });
});
