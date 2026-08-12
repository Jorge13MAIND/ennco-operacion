import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { calculatePrequote } from "@/lib/domain/prequote";
import { renderPrequotePdf } from "@/lib/prequote/pdf";
import type { PrequoteInput } from "@/lib/domain/types";

const input: PrequoteInput = {
  needType: "SOLAR_NEW",
  monthlySpendMxn: 150_000,
  tariff: "GDMTH",
  existingCapacityKwp: 0,
  coverageTargetPct: 75,
  city: "León",
  state: "Guanajuato",
  zone: "URBAN",
  contact: {
    company: "Synthetic Plant",
    fullName: "Synthetic Contact",
    role: "Dirección de planta",
    email: "synthetic@example.com",
    phone: "4770000000",
  },
  consent: true,
  privacyNoticeVersion: "DRAFT-2026-08-11",
};

describe("prequote PDF", () => {
  it("renders one valid page without contact PII", async () => {
    const bytes = await renderPrequotePdf({
      folio: "ENN-PRE-1234ABCD",
      evidenceClass: "synthetic_demo",
      issuedAtEpoch: 1_786_467_600,
      expiresAtEpoch: 1_786_468_500,
      estimate: calculatePrequote(input, undefined, new Date("2026-08-11T18:00:00.000Z")),
    });
    expect(Buffer.from(bytes.subarray(0, 5)).toString("ascii")).toBe("%PDF-");
    expect(Buffer.from(bytes).includes(Buffer.from("synthetic@example.com"))).toBe(false);
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBe(1);
  });
});
