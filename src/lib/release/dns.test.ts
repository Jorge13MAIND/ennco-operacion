import { describe, expect, it } from "vitest";

import { evaluateDnsReadiness } from "@/lib/release/dns";

describe("DNS readiness evidence", () => {
  it("accepts a complete synthetic observation", () => {
    expect(evaluateDnsReadiness({
      domain: "outreach.invalid",
      spfRecords: ["v=spf1 include:_spf.google.com ~all"],
      dkimRecords: [{ selector: "google", value: "v=DKIM1; k=rsa; p=SYNTHETICPUBLICKEY" }],
      dmarcRecords: ["v=DMARC1; p=none; rua=mailto:dmarc@outreach.invalid"],
      mxRecords: ["smtp.google.invalid"],
      forwardReverseDnsPass: true,
      tlsSeedPass: true,
    }).decision).toBe("PASS");
  });

  it("fails closed for duplicate SPF, missing DMARC and unknown TLS", () => {
    const result = evaluateDnsReadiness({
      domain: "outreach.invalid",
      spfRecords: ["v=spf1 include:a.invalid ~all", "v=spf1 include:b.invalid ~all"],
      dkimRecords: [],
      dmarcRecords: [],
      mxRecords: [],
      forwardReverseDnsPass: false,
      tlsSeedPass: false,
    });
    expect(result.decision).toBe("EXTEND");
    expect(result.reasons.length).toBeGreaterThanOrEqual(6);
  });
});

