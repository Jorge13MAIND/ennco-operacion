import { describe, expect, it } from "vitest";

import { calculateAvailabilityBudget } from "@/lib/slo/error-budget";

describe("calculateAvailabilityBudget", () => {
  it("fails closed when there is no production denominator", () => {
    expect(calculateAvailabilityBudget({ totalEvents: 0, badEvents: 0 })).toMatchObject({
      status: "UNKNOWN",
      featureFreeze: true,
      observedAvailability: null,
    });
  });

  it("freezes features when the monthly availability budget is exhausted", () => {
    expect(calculateAvailabilityBudget({ totalEvents: 100_000, badEvents: 101 })).toMatchObject({
      status: "EXHAUSTED",
      featureFreeze: true,
      observedAvailability: 0.99899,
    });
  });

  it("keeps a healthy budget separate from zero errors as an absolute promise", () => {
    expect(calculateAvailabilityBudget({ totalEvents: 100_000, badEvents: 10 })).toMatchObject({
      status: "HEALTHY",
      featureFreeze: false,
      consumedFraction: expect.closeTo(0.1),
    });
  });
});
