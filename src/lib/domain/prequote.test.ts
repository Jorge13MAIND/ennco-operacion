import { describe, expect, it } from "vitest";

import { calculatePrequote, prequoteInputSchema } from "@/lib/domain/prequote";
import type { PrequoteInput } from "@/lib/domain/types";

const validInput: PrequoteInput = {
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
};

describe("prequote", () => {
  it("validates a complete prequote", () => {
    expect(prequoteInputSchema.safeParse(validInput).success).toBe(true);
  });

  it("rejects a prequote without consent", () => {
    expect(prequoteInputSchema.safeParse({ ...validInput, consent: false }).success).toBe(false);
  });

  it("returns a range and keeps the model in draft", () => {
    const result = calculatePrequote(validInput);
    expect(result.capacityKwp.min).toBeGreaterThan(250);
    expect(result.capacityKwp.max).toBeGreaterThan(result.capacityKwp.min);
    expect(result.investmentMxn.max).toBeGreaterThan(result.investmentMxn.min);
    expect(result.verdict).toBe("INDUSTRIAL_REVIEW");
    expect(result.modelStatus).toBe("DRAFT_REVIEW_REQUIRED");
  });

  it("never returns negative new capacity", () => {
    const result = calculatePrequote({ ...validInput, existingCapacityKwp: 10_000 });
    expect(result.capacityKwp.min).toBe(0);
    expect(result.capacityKwp.max).toBe(0);
    expect(result.investmentMxn.min).toBe(0);
  });
});
