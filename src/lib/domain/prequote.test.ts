import { describe, expect, it } from "vitest";

import calibrationCases from "../../../data/prequote/calibration-cases.json";
import { calculatePrequote, DRAFT_PREQUOTE_MODEL, prequoteInputSchema } from "@/lib/domain/prequote";
import type { PrequoteInput } from "@/lib/domain/types";
import { PRIVACY_NOTICE_VERSION } from "@/lib/privacy/notice";

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
  privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
};

const fixedNow = new Date("2026-08-11T18:00:00.000Z");

describe("prequote", () => {
  it("validates a complete prequote", () => {
    expect(prequoteInputSchema.safeParse(validInput).success).toBe(true);
  });

  it("rejects a prequote without consent", () => {
    expect(prequoteInputSchema.safeParse({ ...validInput, consent: false }).success).toBe(false);
  });

  it("returns an auditable range and keeps the model in draft", () => {
    const result = calculatePrequote(validInput, DRAFT_PREQUOTE_MODEL, fixedNow);
    expect(result.capacityKwp.min).toBeGreaterThan(200);
    expect(result.capacityKwp.max).toBeGreaterThan(result.capacityKwp.min);
    expect(result.investmentMxn.max).toBeGreaterThan(result.investmentMxn.min);
    expect(result.verdict).toBe("INDUSTRIAL_REVIEW");
    expect(result.modelStatus).toBe("DRAFT_REVIEW_REQUIRED");
    expect(result.evidenceConfidence).toBe("EXTRAPOLATED_REVIEW_REQUIRED");
    expect(result.strictLeadStatus).toBe("DOES_NOT_COUNT_WITHOUT_HUMAN_EVIDENCE");
  });

  it("never returns negative new capacity", () => {
    const result = calculatePrequote(
      { ...validInput, existingCapacityKwp: 10_000 },
      DRAFT_PREQUOTE_MODEL,
      fixedNow,
    );
    expect(result.capacityKwp).toEqual({ min: 0, max: 0 });
    expect(result.investmentMxn).toEqual({ min: 0, max: 0 });
  });

  it("routes non-sizing services to human technical review", () => {
    const result = calculatePrequote(
      { ...validInput, needType: "MAINTENANCE_THERMOGRAPHY" },
      DRAFT_PREQUOTE_MODEL,
      fixedNow,
    );
    expect(result.estimateKind).toBe("SERVICE_REVIEW");
    expect(result.verdict).toBe("TECHNICAL_REVIEW");
    expect(result.capacityKwp).toEqual({ min: 0, max: 0 });
  });

  it("expires the model without silently using stale sources", () => {
    const result = calculatePrequote(
      validInput,
      DRAFT_PREQUOTE_MODEL,
      new Date("2026-09-11T12:00:00.000Z"),
    );
    expect(result.modelStatus).toBe("EXPIRED");
  });

  it.each(calibrationCases)("contains the observed capacity and price for $case_id", (calibrationCase) => {
    const monthlySpendMxn = calibrationCase.monthly_consumption_kwh
      * calibrationCase.effective_energy_rate_mxn_per_kwh;
    const result = calculatePrequote(
      {
        ...validInput,
        monthlySpendMxn,
        coverageTargetPct: calibrationCase.coverage_pct_for_test,
      },
      DRAFT_PREQUOTE_MODEL,
      fixedNow,
    );

    expect(calibrationCase.capacity_kwp).toBeGreaterThanOrEqual(result.capacityKwp.min);
    expect(calibrationCase.capacity_kwp).toBeLessThanOrEqual(result.capacityKwp.max);
    expect(calibrationCase.installed_price_mxn_including_tax).toBeGreaterThanOrEqual(result.investmentMxn.min);
    expect(calibrationCase.installed_price_mxn_including_tax).toBeLessThanOrEqual(result.investmentMxn.max);
  });

  it("keeps the roof envelope above the physical 650 W module area", () => {
    const physicalM2PerKwp = (2.382 * 1.134) / 0.65;
    expect(DRAFT_PREQUOTE_MODEL.roofAreaM2PerKwp.min).toBeGreaterThan(physicalM2PerKwp);
  });
});
