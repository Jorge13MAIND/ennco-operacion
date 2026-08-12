import { describe, expect, it } from "vitest";

import { analyticsEventInputSchema } from "@/lib/analytics/events";

const valid = {
  eventName: "PREQUOTE_SUCCEEDED",
  sessionId: "11111111-1111-4111-8111-111111111111",
  correlationId: "21111111-1111-4111-8111-111111111111",
  path: "/diagnostico",
  occurredAt: "2026-08-11T18:00:00.000Z",
  properties: {
    estimate_kind: "SOLAR_RANGE",
    verdict: "INDUSTRIAL_REVIEW",
    model_version: "ENNCO-PREQ-2026-08-DRAFT-02",
  },
};

describe("analytics allowlist", () => {
  it("accepts a PII-free conversion event", () => {
    expect(analyticsEventInputSchema.parse(valid)).toMatchObject(valid);
  });

  it("rejects arbitrary properties and email-like values", () => {
    expect(analyticsEventInputSchema.safeParse({
      ...valid,
      properties: { email: "person@example.com" },
    }).success).toBe(false);
    expect(analyticsEventInputSchema.safeParse({
      ...valid,
      properties: { error_code: "person@example.com" },
    }).success).toBe(false);
  });
});
