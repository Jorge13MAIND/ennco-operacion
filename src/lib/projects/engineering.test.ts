import { describe, expect, it } from "vitest";
import {
  calculateEngineering,
  engineeringInputSchema,
  type EngineeringInput,
} from "./engineering";

const solar = (): NonNullable<EngineeringInput["solar"]> => ({
  moduleCount: 10,
  module: {
    model: "Ficha sintética de prueba",
    sourceRef: "test:module",
    powerW: 500,
    vocV: 50,
    vmpV: 40,
    iscA: 14,
    impA: 12.5,
    vocTemperaturePctPerC: -0.3,
    vmpTemperaturePctPerC: -0.4,
  },
  inverter: {
    model: "Inversor de prueba",
    sourceRef: "test:inverter",
    acPowerKw: 5,
    maxDcVoltageV: 600,
    mpptMinV: 200,
    mpptMaxV: 550,
    mpptCount: 2,
    maxInputCurrentPerMpptA: 20,
    maxShortCircuitCurrentPerMpptA: 25,
    maxDcPowerKw: 7,
  },
  mpptStrings: [{ mppt: 1, modulesInSeries: 10, parallelStrings: 1 }],
  temperature: { minCellC: 0, maxCellC: 75, sourceRef: "test:cell-extremes" },
  shortCircuitDesignFactor: 1.25,
  currentFactorSourceRef: "test:current-factor",
  performanceRatio: 0.8,
  performanceRatioSourceRef: "test:losses",
  monthlyResource: Array.from({ length: 12 }, (_, i) => ({
    month: `2026-${String(i + 1).padStart(2, "0")}`,
    dailyPlaneOfArrayKwhM2: 5,
    sourceRef: "test:resource",
    datasetPeriod: "prueba sintética",
    tiltDeg: 20,
    azimuthDeg: 0,
  })),
});
const circuit = (): NonNullable<EngineeringInput["circuits"]>[number] => ({
  id: "DC-1",
  type: "DC",
  material: "COPPER",
  oneWayLengthM: 25,
  voltageV: 400,
  currentA: 20,
  crossSectionMm2: 4,
  resistivityOhmMm2PerM: 0.02,
  conductorTemperatureC: 75,
  conductorSourceRef: "test:resistivity-at-75C",
  voltageDropLimitPct: 3,
  voltageDropLimitSourceRef: "test:design-limit",
  ampacity: {
    reviewed: true,
    sourceRef: "test:ampacity",
    version: "1",
    baseA: 50,
    temperatureFactor: 0.8,
    groupingFactor: 0.8,
    terminalLimitA: 40,
    requiredCurrentMultiplier: 1.25,
  },
  breakerA: 30,
  groundCrossSectionMm2: 4,
  protectionRule: {
    reviewed: true,
    sourceRef: "test:protection",
    version: "1",
    minimumBreakerMultiplier: 1.25,
    maximumBreakerA: 32,
    minimumGroundMm2: 4,
  },
});

describe("ingeniería ENNCO: cálculo independiente y límites", () => {
  it.each(["RESIDENTIAL", "COMMERCIAL", "INDUSTRIAL"] as const)(
    "conserva un mismo motor físico para %s",
    (segment) => {
      const output = calculateEngineering({ segment, solar: solar() });
      expect(output.status).toBe("READY_FOR_REVIEW");
      expect(output.solar?.capacityKw).toBe(5);
      // 5 kWp, 5 h/d, 80% PR = 20 kWh/day; 365 days. Independent daily-energy expectation.
      expect(output.solar?.annualGenerationKwh).toBe(7300);
      expect(output.solar?.monthlyGeneration[0]!.generationKwh).toBe(620);
      expect(output.solar?.compatible).toBe(true);
      expect(output.sourceRefs).toContain("test:resource");
    },
  );

  it("respeta febrero bisiesto y no anualiza un periodo parcial", () => {
    const value = solar();
    value.monthlyResource = [
      { ...value.monthlyResource![0]!, month: "2024-02" },
    ];
    const output = calculateEngineering({
      segment: "RESIDENTIAL",
      solar: value,
    });
    expect(output.solar?.monthlyGeneration[0]!.days).toBe(29);
    expect(output.solar?.totalGenerationKwh).toBe(580);
    expect(output.solar?.annualGenerationKwh).toBeUndefined();
    expect(output.missingData).toContain("solar.monthlyResource.completeYear");
  });

  it("no oculta temperaturas o PR faltantes con datos históricos", () => {
    const value = solar();
    delete value.performanceRatio;
    delete value.temperature;
    const output = calculateEngineering({
      segment: "COMMERCIAL",
      solar: value,
    });
    expect(output.solar?.annualGenerationKwh).toBeUndefined();
    expect(output.solar?.strings).toEqual([]);
    expect(output.status).toBe("NEEDS_REVIEW");
  });

  it("corrige tensión con temperatura de celda y verifica límites MPPT", () => {
    const output = calculateEngineering({
      segment: "INDUSTRIAL",
      solar: solar(),
    });
    const string = output.solar!.strings[0]!;
    // 10 × 50 V × 1.075; 10 × 40 V × .8; 10 × 40 V × 1.1.
    expect(string.coldVocV).toBeCloseTo(537.5, 8);
    expect(string.hotVmpV).toBe(320);
    expect(string.coldVmpV).toBe(440);
    expect(string.minModulesInSeries).toBe(7);
    expect(string.maxModulesInSeries).toBe(11);
    expect(string.designShortCircuitCurrentA).toBe(17.5);
  });

  it("marca sobrevoltaje, exceso de corriente y módulos sin asignar", () => {
    const value = solar();
    value.mpptStrings = [{ mppt: 1, modulesInSeries: 12, parallelStrings: 2 }];
    const output = calculateEngineering({
      segment: "INDUSTRIAL",
      solar: value,
    });
    expect(output.solar?.compatible).toBe(false);
    expect(output.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(["STRING_INCOMPATIBLE", "MODULE_COUNT_MISMATCH"]),
    );
  });

  it("no emite compatibilidad cuando coeficientes producen tensión negativa", () => {
    const value = solar();
    value.module.vmpTemperaturePctPerC = -2;
    const output = calculateEngineering({
      segment: "RESIDENTIAL",
      solar: value,
    });
    expect(output.solar?.compatible).toBeUndefined();
    expect(
      output.warnings.some(
        (w) =>
          w.code === "INVALID_TEMPERATURE_MODEL" && w.severity === "BLOCKER",
      ),
    ).toBe(true);
  });

  it("cuenta sólo consumos confirmados y no replica un mes", () => {
    const output = calculateEngineering({
      segment: "RESIDENTIAL",
      consumption: {
        months: [
          {
            month: "2026-01",
            kWh: 100,
            confirmed: true,
            sourceRef: "test:receipt1",
          },
          {
            month: "2026-02",
            kWh: 999,
            confirmed: false,
            sourceRef: "test:receipt2",
          },
        ],
      },
    });
    expect(output.consumption?.totalKwh).toBe(100);
    expect(output.consumption?.annualKwh).toBeUndefined();
    expect(output.consumption?.totalHistoricalBillsMxn).toBeUndefined();
    expect(output.missingData).toContain("consumption.confirmation");
  });

  it("conserva demanda y cargos fijos al reducir energía explícitamente autoconsumida", () => {
    const output = calculateEngineering({
      segment: "INDUSTRIAL",
      consumption: {
        months: [
          {
            month: "2026-01",
            kWh: 1000,
            confirmed: true,
            sourceRef: "test:bill",
            billMxn: 3900,
          },
        ],
        selfConsumption: [
          {
            month: "2026-01",
            kWh: 200,
            confirmed: true,
            sourceRef: "test:hourly-study",
          },
        ],
        tariff: {
          name: "Escenario energético",
          reviewed: true,
          version: "1",
          sourceRef: "test:tariff",
          energyRateMxnKwh: 2,
          fixedMonthlyMxn: 100,
          demandMonthlyMxn: 500,
          validFrom: "2026-01",
          validTo: "2026-01",
        },
      },
    });
    expect(output.consumption?.monthlyBilling[0]).toEqual({
      month: "2026-01",
      beforeMxn: 2600,
      afterMxn: 2200,
      savingsMxn: 400,
      unchangedDemandMxn: 500,
    });
    expect(output.consumption?.totalHistoricalBillsMxn).toBe(3900);
    expect(output.consumption?.energySavingsMxn).toBe(400);
    expect(output.status).toBe("NEEDS_REVIEW");
  });

  it("no recorta autoconsumo imposible ni agrega ahorros incompletos", () => {
    const output = calculateEngineering({
      segment: "COMMERCIAL",
      solar: solar(),
      consumption: {
        months: [
          {
            month: "2026-01",
            kWh: 1000,
            confirmed: true,
            sourceRef: "test:bill",
          },
        ],
        selfConsumption: [
          {
            month: "2026-01",
            kWh: 900,
            confirmed: true,
            sourceRef: "test:bad-study",
          },
        ],
        tariff: {
          name: "Escenario",
          reviewed: true,
          version: "1",
          sourceRef: "test:tariff",
          energyRateMxnKwh: 2,
          fixedMonthlyMxn: 0,
          demandMonthlyMxn: 0,
          validFrom: "2026-01",
          validTo: "2026-12",
        },
      },
    });
    expect(output.consumption?.monthlyBilling).toEqual([]);
    expect(output.consumption?.energySavingsMxn).toBeUndefined();
    expect(
      output.warnings.some((w) => w.code === "SELF_CONSUMPTION_EXCEEDED"),
    ).toBe(true);
  });

  it("calcula caída DC con ida y retorno sin duplicar longitud", () => {
    const output = calculateEngineering({
      segment: "COMMERCIAL",
      circuits: [circuit()],
    });
    expect(output.circuits[0]!.voltageDropV).toBe(5);
    expect(output.circuits[0]!.voltageDropPct).toBe(1.25);
    expect(output.circuits[0]!.correctedAmpacityA).toBe(32);
    expect(output.circuits[0]!.requiredAmpacityA).toBe(25);
    expect(output.circuits[0]!.breakerWithinReviewedRule).toBe(true);
    expect(output.status).toBe("READY_FOR_REVIEW");
  });

  it("incluye componente reactiva y tensión entre fases en circuito trifásico equilibrado", () => {
    const c = circuit();
    c.type = "AC_THREE_PHASE";
    c.powerFactor = 0.8;
    c.reactanceOhmPerKm = 0.1;
    c.oneWayLengthM = 50;
    c.crossSectionMm2 = 10;
    c.currentA = 100;
    const output = calculateEngineering({
      segment: "INDUSTRIAL",
      circuits: [c],
    });
    // R = .002 ohm/m, cos phi .8, X = .0001 ohm/m, sin phi .6; sqrt(3)*100*50*.00166.
    expect(output.circuits[0]!.voltageDropV).toBeCloseTo(14.376021702821683, 8);
    expect(output.circuits[0]!.meetsAmpacity).toBe(false);
    expect(output.circuits[0]!.breakerWithinReviewedRule).toBe(false);
  });

  it("limita ampacidad a terminales y no verifica reglas sin revisar", () => {
    const c = circuit();
    c.ampacity!.terminalLimitA = 20;
    c.protectionRule!.reviewed = false;
    const output = calculateEngineering({
      segment: "COMMERCIAL",
      circuits: [c],
    });
    expect(output.circuits[0]!.correctedAmpacityA).toBe(20);
    expect(output.circuits[0]!.meetsAmpacity).toBe(false);
    expect(output.circuits[0]!.breakerWithinReviewedRule).toBeUndefined();
    expect(output.circuits[0]!.groundWithinReviewedRule).toBeUndefined();
    expect(output.missingData).toContain("circuits.DC-1.protectionRule");
  });

  it("comprueba ocupación de canalización únicamente con regla revisada", () => {
    const c = circuit();
    c.conduit = {
      reviewed: true,
      sourceRef: "test:conduit",
      version: "1",
      internalAreaMm2: 100,
      occupiedAreaMm2: 50,
      allowedFillFraction: 0.4,
    };
    const output = calculateEngineering({
      segment: "INDUSTRIAL",
      circuits: [c],
    });
    expect(output.circuits[0]!.conduitFillFraction).toBe(0.5);
    expect(output.circuits[0]!.meetsConduitFill).toBe(false);
  });

  it("estima kvar con triángulo 3-4-5 y bloquea uso de FP distorsionado", () => {
    const capacitor = {
      activeKw: 100,
      measuredPowerFactor: 0.8,
      targetPowerFactor: 1,
      measurementRef: "test:measurement",
      loadType: "INDUCTIVE_SINUSOIDAL" as const,
    };
    const output = calculateEngineering({ segment: "INDUSTRIAL", capacitor });
    expect(output.capacitor?.compensationKvar).toBeCloseTo(75, 10);
    expect(output.capacitor?.apparentBeforeKva).toBe(125);
    expect(output.capacitor?.estimateOnly).toBe(true);
    expect(output.status).toBe("NEEDS_REVIEW");
    expect(
      calculateEngineering({
        segment: "INDUSTRIAL",
        capacitor: { ...capacitor, loadType: "UNKNOWN_OR_DISTORTED" },
      }).capacitor?.compensationKvar,
    ).toBeUndefined();
  });

  it("calcula sombra perpendicular y distingue paso de fila de hueco libre", () => {
    const output = calculateEngineering({
      segment: "RESIDENTIAL",
      shadows: {
        panelSlopeLengthM: 2,
        tiltDeg: 30,
        designSolarElevationDeg: 45,
        additionalObstacleHeightM: 0,
        sourceRef: "test:survey",
      },
    });
    expect(output.shadows?.panelHeightM).toBeCloseTo(1, 10);
    expect(output.shadows?.clearGapM).toBeCloseTo(1, 10);
    expect(output.shadows?.rowPitchM).toBeCloseTo(2.732050807568877, 10);
  });

  it("compra tramos completos por línea de riel sin asumir reutilización de recortes", () => {
    const output = calculateEngineering({
      segment: "RESIDENTIAL",
      materials: {
        sourceRef: "test:mounting-rule",
        reservePct: 10,
        layout: {
          rows: 2,
          modulesPerRow: 5,
          moduleWidthM: 1,
          moduleGapM: 0.02,
          railLinesPerRow: 2,
          railEndAllowanceM: 0.1,
          railCommercialLengthM: 3,
          fixturesPerModule: 4,
          connectorsPerString: 2,
          stringCount: 1,
        },
        runs: [
          {
            id: "DC",
            kind: "CABLE",
            oneWayLengthM: 20,
            parallelPieces: 2,
            commercialLengthM: 100,
          },
          {
            id: "tube",
            kind: "CONDUIT",
            oneWayLengthM: 10,
            parallelPieces: 1,
            commercialLengthM: 3,
          },
        ],
      },
    });
    expect(
      output.materials?.items.find((i) => i.id === "modules")?.purchaseQuantity,
    ).toBe(10);
    expect(
      output.materials?.items.find((i) => i.id === "fixtures")
        ?.purchaseQuantity,
    ).toBe(44);
    expect(
      output.materials?.items.find((i) => i.id === "rails")?.commercialUnits,
    ).toBe(8);
    expect(
      output.materials?.items.find((i) => i.id === "run:DC")?.purchaseQuantity,
    ).toBe(100);
    expect(
      output.materials?.items.find((i) => i.id === "run:tube")
        ?.purchaseQuantity,
    ).toBe(12);
  });

  it("mantiene el estudio de calidad como evidencia pendiente de interpretación", () => {
    const output = calculateEngineering({
      segment: "INDUSTRIAL",
      qualityStudy: {
        objective: "Armónicos y frecuencia",
        evidenceRefs: ["test:measurement.csv"],
        instrument: "Analizador",
      },
    });
    expect(output.qualityStudy?.status).toBe("AWAITING_ENGINEER_REVIEW");
    expect(output.status).toBe("NEEDS_REVIEW");
  });

  it("acepta borrador vacío y rechaza números inválidos, periodos duplicados y campos desconocidos", () => {
    expect(calculateEngineering({ segment: "RESIDENTIAL" }).status).toBe(
      "DRAFT",
    );
    for (const powerW of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        engineeringInputSchema.safeParse({
          segment: "RESIDENTIAL",
          solar: { ...solar(), module: { ...solar().module, powerW } },
        }).success,
      ).toBe(false);
    }
    const value = solar();
    value.monthlyResource = [
      value.monthlyResource![0]!,
      value.monthlyResource![0]!,
    ];
    expect(
      engineeringInputSchema.safeParse({ segment: "RESIDENTIAL", solar: value })
        .success,
    ).toBe(false);
    expect(
      engineeringInputSchema.safeParse({
        segment: "RESIDENTIAL",
        phantomApproved: true,
      }).success,
    ).toBe(false);
    expect(
      engineeringInputSchema.safeParse({
        segment: "INDUSTRIAL",
        circuits: [{ ...circuit(), type: "AC_THREE_PHASE" }],
      }).success,
    ).toBe(false);
  });

  it("no muta entradas ni incorpora reloj o estado en los resultados", () => {
    const value: EngineeringInput = { segment: "INDUSTRIAL", solar: solar() };
    const before = structuredClone(value);
    const result1 = calculateEngineering(value);
    expect(value).toEqual(before);
    expect(calculateEngineering(value)).toEqual(result1);
  });

  it("suma sistemas de inversores independientes sin mezclar límites MPPT", () => {
    const second = solar();
    second.performanceRatio = 0.7;
    const output = calculateEngineering({
      segment: "INDUSTRIAL",
      solarSystems: [
        { id: "INV-01", design: solar() },
        { id: "INV-02", design: second },
      ],
    });
    expect(output.solar).toBeUndefined();
    expect(output.solarSystems).toHaveLength(2);
    expect(output.solarTotals?.capacityKw).toBe(10);
    expect(output.solarTotals?.annualGenerationKwh).toBe(13687.5);
    expect(output.solarTotals?.monthlyGeneration[0]!.generationKwh).toBe(
      1162.5,
    );
    expect(output.status).toBe("READY_FOR_REVIEW");
  });

  it("localiza errores por inversor y no publica generación parcial como total", () => {
    const second = solar();
    delete second.performanceRatio;
    const output = calculateEngineering({
      segment: "INDUSTRIAL",
      solarSystems: [
        { id: "INV-01", design: solar() },
        { id: "INV-02", design: second },
      ],
    });
    expect(output.solarTotals?.capacityKw).toBe(10);
    expect(output.solarTotals?.annualGenerationKwh).toBeUndefined();
    expect(output.solarTotals?.totalGenerationKwh).toBeUndefined();
    expect(output.missingData).toContain(
      "solarSystems.INV-02.design.performanceRatio",
    );
    expect(output.missingData).toContain("solarSystems.matchingPeriods");
  });

  it("rechaza doble conteo solar y sistemas, ids repetidos y meses repetidos por inversor", () => {
    const system = { id: "INV-01", design: solar() };
    expect(
      engineeringInputSchema.safeParse({
        segment: "INDUSTRIAL",
        solar: solar(),
        solarSystems: [system],
      }).success,
    ).toBe(false);
    expect(
      engineeringInputSchema.safeParse({
        segment: "INDUSTRIAL",
        solarSystems: [system, system],
      }).success,
    ).toBe(false);
    system.design.monthlyResource = [
      system.design.monthlyResource![0]!,
      system.design.monthlyResource![0]!,
    ];
    expect(
      engineeringInputSchema.safeParse({
        segment: "INDUSTRIAL",
        solarSystems: [system],
      }).success,
    ).toBe(false);
  });
});
