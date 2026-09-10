import { describe, expect, it } from "vitest";
import {
  estimatePreliminarySizing,
  preliminarySizingSchema,
  proposalEconomics,
  type PreliminarySizingInput,
} from "./economics";
import { calculateEngineering } from "./engineering";
import type { JsonRecord, ProjectRecord } from "./types";

function sizing(): PreliminarySizingInput {
  return {
    annualDemandKwh: 7300,
    coveragePct: 100,
    modulePowerW: 500,
    performanceRatio: 0.8,
    sourceRef: "test:demand-and-pr",
    monthlyResource: Array.from({ length: 12 }, (_, i) => ({
      month: `2026-${String(i + 1).padStart(2, "0")}`,
      dailyPlaneOfArrayKwhM2: 5,
      sourceRef: "test:climate",
      datasetPeriod: "2005-2023 climatology",
      tiltDeg: 20,
      azimuthDeg: 0,
    })),
  };
}
function calculation(): ProjectRecord {
  return {
    id: "calc1",
    projectId: "project1",
    actorId: "test",
    kind: "calculation",
    createdAt: "2026-09-10T12:00:00Z",
    revision: 1,
    data: {
      inputHash: "frozen-input-hash",
      input: {
        consumption: {
          months: Array.from({ length: 12 }, (_, i) => ({
            month: `2026-${String(i + 1).padStart(2, "0")}`,
            kWh: 1000,
            confirmed: true,
          })),
        },
      },
      result: {
        version: "fixture-independent",
        warnings: [],
        sourceRefs: ["test:uniform-tariff"],
        consumption: {
          confirmedMonths: 12,
          annualKwh: 12000,
          energySavingsMxn: 2400,
          monthlyBilling: Array.from({ length: 12 }, (_, i) => ({
            month: `2026-${String(i + 1).padStart(2, "0")}`,
            beforeMxn: 1000,
            afterMxn: 800,
            savingsMxn: 200,
          })),
        },
      },
    },
  };
}
const proposal = (): JsonRecord => ({
  calculationId: "calc1",
  subtotalMxn: 10000,
  vatMxn: 1600,
  totalMxn: 11600,
  annualOperatingCostMxn: 400,
});
function inputMonths(
  c: ProjectRecord,
): { month: string; kWh: number; confirmed: boolean }[] {
  return ((c.data.input as JsonRecord).consumption as JsonRecord).months as {
    month: string;
    kWh: number;
    confirmed: boolean;
  }[];
}
function resultConsumption(c: ProjectRecord): JsonRecord {
  return (c.data.result as JsonRecord).consumption as JsonRecord;
}
function bills(
  c: ProjectRecord,
): {
  month: string;
  beforeMxn: number;
  afterMxn: number;
  savingsMxn: number;
}[] {
  return resultConsumption(c).monthlyBilling as {
    month: string;
    beforeMxn: number;
    afterMxn: number;
    savingsMxn: number;
  }[];
}

describe("dimensionamiento preliminar por energía anual", () => {
  it("calcula potencia y módulos desde demanda sin inventar MPPT o ahorro", () => {
    const value = estimatePreliminarySizing(sizing());
    // 5 HSP × .8 × 365 = 1,460 kWh/kWp; 7,300 kWh needs 5 kWp, i.e. ten 500-W modules.
    expect(value.annualSpecificYieldKwhPerKwp).toBe(1460);
    expect(value.minimumCapacityKw).toBe(5);
    expect(value.moduleCount).toBe(10);
    expect(value.capacityKw).toBe(5);
    expect(value.estimatedAnnualEnergyKwh).toBe(7300);
    expect(value.estimatedCoveragePct).toBe(100);
    expect(value.monthlyGeneration[0]!.generationKwh).toBe(620);
    expect(value.status).toBe("PRELIMINARY");
    expect(value).not.toHaveProperty("savingsMxn");
    expect(value).not.toHaveProperty("mpptStrings");
  });

  it("redondea módulos hacia arriba y deja visible cobertura adicional", () => {
    const value = estimatePreliminarySizing({
      ...sizing(),
      annualDemandKwh: 7300.001,
    });
    expect(value.moduleCount).toBe(11);
    expect(value.capacityKw).toBe(5.5);
    expect(value.estimatedCoveragePct).toBeGreaterThan(100);
    const half = estimatePreliminarySizing({ ...sizing(), coveragePct: 50 });
    expect(half.moduleCount).toBe(5);
    expect(half.targetEnergyKwh).toBe(3650);
  });

  it("considera días bisiestos una sola vez", () => {
    const value = sizing();
    value.monthlyResource = value.monthlyResource.map((m) => ({
      ...m,
      month: m.month.replace("2026", "2024"),
    }));
    value.annualDemandKwh = 7320;
    const result = estimatePreliminarySizing(value);
    expect(result.moduleCount).toBe(10);
    expect(result.monthlyGeneration[1]!.generationKwh).toBe(580);
    expect(result.estimatedAnnualEnergyKwh).toBe(7320);
  });

  it("rechaza meses faltantes, duplicados, no consecutivos y mezcla de planos", () => {
    const missing = sizing();
    missing.monthlyResource.pop();
    expect(preliminarySizingSchema.safeParse(missing).success).toBe(false);
    const duplicate = sizing();
    duplicate.monthlyResource[1]!.month = "2026-01";
    expect(preliminarySizingSchema.safeParse(duplicate).success).toBe(false);
    const gap = sizing();
    gap.monthlyResource[11]!.month = "2027-01";
    expect(preliminarySizingSchema.safeParse(gap).success).toBe(false);
    const plane = sizing();
    plane.monthlyResource[11]!.azimuthDeg = 90;
    expect(preliminarySizingSchema.safeParse(plane).success).toBe(false);
    const period = sizing();
    period.monthlyResource[1]!.datasetPeriod = "different";
    expect(preliminarySizingSchema.safeParse(period).success).toBe(false);
  });

  it("rechaza irradiación cero y cantidades imposibles en lugar de inventar datos", () => {
    const zero = sizing();
    zero.monthlyResource = zero.monthlyResource.map((m) => ({
      ...m,
      dailyPlaneOfArrayKwhM2: 0,
    }));
    expect(() => estimatePreliminarySizing(zero)).toThrow("cero irradiación");
    expect(() =>
      estimatePreliminarySizing({
        ...sizing(),
        modulePowerW: Number.MIN_VALUE,
      }),
    ).toThrow("PRELIMINARY_SIZING_OUT_OF_RANGE");
    expect(
      preliminarySizingSchema.safeParse({ ...sizing(), performanceRatio: 0 })
        .success,
    ).toBe(false);
  });

  it("se conserva como resultado de la revisión técnica, sin aprobación automática", () => {
    const result = calculateEngineering({
      segment: "INDUSTRIAL",
      preliminarySizing: sizing(),
    });
    expect(result.preliminarySizing?.moduleCount).toBe(10);
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(
      result.warnings.some(
        (w) => w.code === "PRELIMINARY_SIZING" && w.severity === "REVIEW",
      ),
    ).toBe(true);
    expect(result.sourceRefs).toContain("test:climate");
  });
});

describe("retorno simple antes de IVA", () => {
  it("divide inversión por ahorro neto anual sin incluir IVA o margen ENNCO", () => {
    const result = proposalEconomics(proposal(), calculation());
    expect(result.status).toBe("ESTIMATE");
    expect(result.investmentMxn).toBe(10000);
    expect(result.annualEnergySavingsMxn).toBe(2400);
    expect(result.netAnnualSavingsMxn).toBe(2000);
    expect(result.simplePaybackYears).toBe(5);
    expect(result.calculationInputHash).toBe("frozen-input-hash");
    expect(result.periodFrom).toBe("2026-01");
    expect(result.periodTo).toBe("2026-12");
    expect(result.sourceRefs).toContain("test:uniform-tariff");
  });

  it("requiere costo operativo explícito y admite cero sólo si fue declarado", () => {
    const p = proposal();
    delete p.annualOperatingCostMxn;
    const unavailable = proposalEconomics(p, calculation());
    expect(unavailable.simplePaybackYears).toBeNull();
    expect(unavailable.missingReason).toContain("no se supone cero");
    expect(
      proposalEconomics({ ...p, annualOperatingCostMxn: 0 }, calculation())
        .simplePaybackYears,
    ).toBeCloseTo(10000 / 2400, 12);
  });

  it.each([2400, 2500])(
    "con operación de %s no presenta retorno positivo",
    (operating) => {
      const value = proposalEconomics(
        { ...proposal(), annualOperatingCostMxn: operating },
        calculation(),
      );
      expect(value.status).toBe("UNAVAILABLE");
      expect(value.simplePaybackYears).toBeNull();
      expect(value.missingReason).toContain("no supera");
    },
  );

  it("rechaza cálculo de otra revisión y meses sin confirmación", () => {
    const other = calculation();
    other.id = "other";
    expect(proposalEconomics(proposal(), other).simplePaybackYears).toBeNull();
    const unconfirmed = calculation();
    inputMonths(unconfirmed)[0]!.confirmed = false;
    expect(
      proposalEconomics(proposal(), unconfirmed).simplePaybackYears,
    ).toBeNull();
    const missing = calculation();
    bills(missing).pop();
    expect(
      proposalEconomics(proposal(), missing).simplePaybackYears,
    ).toBeNull();
  });

  it("no mezcla año de consumo y año de facturación aunque ambos tengan doce meses", () => {
    const value = calculation();
    bills(value).forEach((m) => {
      m.month = m.month.replace("2026", "2025");
    });
    const result = proposalEconomics(proposal(), value);
    expect(result.simplePaybackYears).toBeNull();
    expect(result.missingReason).toContain("mismo periodo anual");
  });

  it("rechaza duplicados y totales que no concilian con los doce meses", () => {
    const duplicated = calculation();
    bills(duplicated)[11]!.month = "2026-01";
    expect(
      proposalEconomics(proposal(), duplicated).simplePaybackYears,
    ).toBeNull();
    const wrongTotal = calculation();
    resultConsumption(wrongTotal).energySavingsMxn = 9999;
    expect(proposalEconomics(proposal(), wrongTotal).missingReason).toContain(
      "no concilian",
    );
    const wrongDemand = calculation();
    resultConsumption(wrongDemand).annualKwh = 13000;
    expect(
      proposalEconomics(proposal(), wrongDemand).simplePaybackYears,
    ).toBeNull();
    const wrongBalance = calculation();
    bills(wrongBalance)[0]!.afterMxn = 200;
    expect(
      proposalEconomics(proposal(), wrongBalance).simplePaybackYears,
    ).toBeNull();
  });

  it("no muestra retorno con incompatibilidades bloqueantes", () => {
    const value = calculation();
    (value.data.result as JsonRecord).warnings = [{ severity: "BLOCKER" }];
    expect(proposalEconomics(proposal(), value).simplePaybackYears).toBeNull();
  });

  it("faltantes y valores no finitos no producen Infinity/NaN ni modifican datos", () => {
    const p = proposal(),
      c = calculation(),
      before = structuredClone({ p, c });
    expect(
      proposalEconomics({ ...p, subtotalMxn: Number.POSITIVE_INFINITY }, c)
        .simplePaybackYears,
    ).toBeNull();
    expect(
      proposalEconomics({ ...p, annualOperatingCostMxn: -1 }, c)
        .simplePaybackYears,
    ).toBeNull();
    expect(proposalEconomics(p).simplePaybackYears).toBeNull();
    proposalEconomics(p, c);
    expect({ p, c }).toEqual(before);
  });
});
