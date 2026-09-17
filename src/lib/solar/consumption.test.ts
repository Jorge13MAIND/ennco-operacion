import { describe, expect, it } from "vitest";

import { computeConsumption, defaultConsumptionInput } from "@/lib/solar/consumption";

/** Valores del libro v1.0.1, hoja Cal_Consumo, con su captura original. */
describe("calculadora de consumo (Cal_Consumo)", () => {
  const result = computeConsumption(defaultConsumptionInput());

  it("reproduce los totales del libro", () => {
    expect(result.acMonthlyTotal).toBeCloseTo(197.30769230769235, 9);
    expect(result.applianceDailyTotal).toBeCloseTo(10.742857142857138, 9);
    expect(result.lightingDailyTotal).toBeCloseTo(1.33, 9);
    expect(result.dailyTotal).toBeCloseTo(18.649780219780219, 9);
    expect(result.monthlyTotal).toBeCloseTo(559.49340659340658, 9);
  });

  it("reproduce los renglones de aire acondicionado del libro", () => {
    expect(result.ac[0]!.hoursPerDay).toBeCloseTo(2, 12);
    expect(result.ac[0]!.kwhDay).toBeCloseTo(3.6923076923076925, 12);
    expect(result.ac[0]!.kwhMonth).toBeCloseTo(64.615384615384627, 9);
    expect(result.ac[1]!.kwhMonth).toBeCloseTo(115.3846153846154, 9);
    expect(result.ac[2]!.kwhMonth).toBeCloseTo(8.6538461538461551, 9);
  });

  it("reproduce renglones de electrodomésticos e iluminación", () => {
    expect(result.appliances[0]).toBeCloseTo(0.8571428571428571, 12);
    expect(result.appliances[10]).toBe(0);
    expect(result.lighting[2]).toBeCloseTo(0.28000000000000003, 12);
    expect(result.lighting[11]).toBeCloseTo(0.56000000000000005, 12);
  });

  it("un SEER en cero no produce infinito", () => {
    const input = defaultConsumptionInput();
    input.ac[0] = { ...input.ac[0]!, seer: 0 };
    const r = computeConsumption(input);
    expect(Number.isFinite(r.monthlyTotal)).toBe(true);
    expect(r.ac[0]!.kwhDay).toBe(0);
  });

  it("una captura vacía da cero, no NaN", () => {
    const r = computeConsumption({ ac: [], appliances: [], lighting: [] });
    expect(r.monthlyTotal).toBe(0);
    expect(r.dailyTotal).toBe(0);
  });
});
