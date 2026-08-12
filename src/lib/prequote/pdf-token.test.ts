import { describe, expect, it } from "vitest";

import { calculatePrequote } from "@/lib/domain/prequote";
import { PRIVACY_NOTICE_VERSION } from "@/lib/privacy/notice";
import { createPrequotePdfToken, verifyPrequotePdfToken } from "@/lib/prequote/pdf-token";
import type { PrequoteInput } from "@/lib/domain/types";

const now = new Date("2026-08-11T18:00:00.000Z");
const secret = "synthetic-pdf-secret-with-at-least-32-characters";
const folio = "ENN-PRE-1234ABCD";
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
  privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
};

describe("prequote PDF token", () => {
  it("round-trips an unmodified, unexpired token", () => {
    const estimate = calculatePrequote(input, undefined, now);
    const created = createPrequotePdfToken({ folio, estimate, evidenceClass: "synthetic_demo", secret, now });
    const verified = verifyPrequotePdfToken({ token: created.token, expectedFolio: folio, secret, now });
    expect(verified.estimate.modelVersion).toBe(estimate.modelVersion);
  });

  it("rejects tampering, the wrong folio and expiry", () => {
    const estimate = calculatePrequote(input, undefined, now);
    const created = createPrequotePdfToken({ folio, estimate, evidenceClass: "synthetic_demo", secret, now });
    expect(() => verifyPrequotePdfToken({ token: `${created.token}x`, expectedFolio: folio, secret, now })).toThrow("INVALID_PDF_TOKEN");
    expect(() => verifyPrequotePdfToken({ token: created.token, expectedFolio: "ENN-PRE-FFFFFFFF", secret, now })).toThrow("PDF_TOKEN_FOLIO_MISMATCH");
    expect(() => verifyPrequotePdfToken({ token: created.token, expectedFolio: folio, secret, now: new Date("2026-08-12T18:00:00.000Z") })).toThrow("PDF_TOKEN_EXPIRED");
  });
});
