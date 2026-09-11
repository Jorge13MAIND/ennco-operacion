import { z } from "zod";
import { ENGINEERING_VERSION } from "./engineering-sources";
import {
  estimatePreliminarySizing,
  preliminarySizingSchema,
  type PreliminarySizingResult,
} from "./economics";

const positive = z.number().finite().positive().max(1e9);
const nonnegative = z.number().finite().nonnegative().max(1e9);
const pf = z.number().finite().gt(0).max(1);
const reference = z.string().trim().min(1).max(1000);
const month = z.string().regex(/^(20\d{2})-(0[1-9]|1[0-2])$/);
const reviewedRule = {
  sourceRef: reference,
  version: reference,
  reviewed: z.boolean(),
};
const moduleSchema = z
  .object({
    model: reference,
    sourceRef: reference,
    powerW: positive,
    vocV: positive.optional(),
    vmpV: positive.optional(),
    iscA: positive.optional(),
    impA: positive.optional(),
    vocTemperaturePctPerC: z.number().finite().min(-2).max(0).optional(),
    vmpTemperaturePctPerC: z.number().finite().min(-2).max(0).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.vocV !== undefined && v.vmpV !== undefined && v.vmpV >= v.vocV)
      ctx.addIssue({
        code: "custom",
        message: "Vmp debe ser menor que Voc.",
        path: ["vmpV"],
      });
    if (v.iscA !== undefined && v.impA !== undefined && v.impA > v.iscA)
      ctx.addIssue({
        code: "custom",
        message: "Imp no puede superar Isc.",
        path: ["impA"],
      });
  });
const solarSchema = z
  .object({
    moduleCount: z.number().int().positive().max(100000),
    module: moduleSchema,
    performanceRatio: pf.optional(),
    performanceRatioSourceRef: reference.optional(),
    monthlyResource: z
      .array(
        z
          .object({
            month,
            dailyPlaneOfArrayKwhM2: z.number().finite().min(0).max(24),
            sourceRef: reference,
            datasetPeriod: reference,
            tiltDeg: z.number().min(0).max(90),
            azimuthDeg: z.number().min(-180).max(180),
          })
          .strict(),
      )
      .max(12)
      .optional(),
    inverter: z
      .object({
        model: reference,
        sourceRef: reference,
        acPowerKw: positive,
        maxDcVoltageV: positive,
        mpptMinV: positive,
        mpptMaxV: positive,
        mpptCount: z.number().int().positive().max(100),
        maxInputCurrentPerMpptA: positive,
        maxShortCircuitCurrentPerMpptA: positive,
        maxDcPowerKw: positive.optional(),
      })
      .strict()
      .refine(
        (v) => v.mpptMinV < v.mpptMaxV && v.mpptMaxV <= v.maxDcVoltageV,
        "El rango MPPT debe estar dentro de la tensión DC máxima.",
      )
      .optional(),
    mpptStrings: z
      .array(
        z
          .object({
            mppt: z.number().int().positive().max(100),
            modulesInSeries: z.number().int().positive().max(100000),
            parallelStrings: z.number().int().positive().max(100000),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    temperature: z
      .object({
        minCellC: z.number().min(-100).max(150),
        maxCellC: z.number().min(-100).max(150),
        sourceRef: reference,
      })
      .strict()
      .refine(
        (v) => v.minCellC <= v.maxCellC,
        "La temperatura mínima debe ser menor o igual a la máxima.",
      )
      .optional(),
    shortCircuitDesignFactor: z.number().finite().min(1).max(4).optional(),
    currentFactorSourceRef: reference.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const months = v.monthlyResource?.map((m) => m.month) ?? [];
    const mppts = v.mpptStrings?.map((m) => m.mppt) ?? [];
    if (new Set(months).size !== months.length)
      ctx.addIssue({
        code: "custom",
        message: "No se permiten periodos repetidos.",
        path: ["monthlyResource"],
      });
    if (new Set(mppts).size !== mppts.length)
      ctx.addIssue({
        code: "custom",
        message: "Usar una distribución por MPPT.",
        path: ["mpptStrings"],
      });
  });
const circuitSchema = z
  .object({
    id: reference,
    type: z.enum(["DC", "AC_SINGLE_PHASE", "AC_THREE_PHASE"]),
    material: z.enum(["COPPER", "ALUMINUM"]),
    oneWayLengthM: nonnegative,
    voltageV: positive,
    currentA: positive,
    crossSectionMm2: positive,
    // Resistivity already evaluated at the explicitly declared operating temperature.
    resistivityOhmMm2PerM: z.number().finite().gt(0).max(1),
    conductorTemperatureC: z.number().min(-100).max(250),
    conductorSourceRef: reference,
    powerFactor: pf.optional(),
    reactanceOhmPerKm: z.number().finite().min(0).max(10).optional(),
    voltageDropLimitPct: z.number().finite().gt(0).max(100).optional(),
    voltageDropLimitSourceRef: reference.optional(),
    ampacity: z
      .object({
        ...reviewedRule,
        baseA: positive,
        temperatureFactor: z.number().gt(0).max(2),
        groupingFactor: pf,
        terminalLimitA: positive,
        requiredCurrentMultiplier: z.number().min(1).max(4),
      })
      .strict()
      .optional(),
    breakerA: positive.optional(),
    groundCrossSectionMm2: positive.optional(),
    protectionRule: z
      .object({
        ...reviewedRule,
        minimumBreakerMultiplier: z.number().min(1).max(4),
        maximumBreakerA: positive,
        minimumGroundMm2: positive,
      })
      .strict()
      .optional(),
    conduit: z
      .object({
        internalAreaMm2: positive,
        occupiedAreaMm2: positive,
        allowedFillFraction: pf,
        ...reviewedRule,
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.type !== "DC" &&
      (v.powerFactor === undefined || v.reactanceOhmPerKm === undefined)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "AC requiere factor de potencia y reactancia explícitos, incluso si X = 0.",
        path: ["powerFactor"],
      });
  });
const materialSchema = z
  .object({
    sourceRef: reference,
    reservePct: z.number().finite().min(0).max(100),
    layout: z
      .object({
        rows: z.number().int().positive().max(10000),
        modulesPerRow: z.number().int().positive().max(10000),
        moduleWidthM: positive,
        moduleGapM: nonnegative,
        railLinesPerRow: z.number().int().positive().max(100),
        railEndAllowanceM: nonnegative,
        railCommercialLengthM: positive,
        fixturesPerModule: z.number().int().nonnegative().max(100),
        connectorsPerString: z.number().int().nonnegative().max(100),
        stringCount: z.number().int().positive().max(10000),
      })
      .strict()
      .optional(),
    runs: z
      .array(
        z
          .object({
            id: reference,
            kind: z.enum(["CABLE", "CONDUIT"]),
            oneWayLengthM: nonnegative,
            parallelPieces: z.number().int().positive().max(10000),
            commercialLengthM: positive,
          })
          .strict(),
      )
      .max(500)
      .optional(),
  })
  .strict();

export const engineeringInputSchema = z
  .object({
    segment: z.enum(["RESIDENTIAL", "COMMERCIAL", "INDUSTRIAL"]),
    preliminarySizing: preliminarySizingSchema.optional(),
    consumption: z
      .object({
        months: z
          .array(
            z
              .object({
                month,
                kWh: nonnegative,
                confirmed: z.boolean(),
                sourceRef: reference,
                billMxn: nonnegative.optional(),
                demandKw: nonnegative.optional(),
                reactiveKvarh: nonnegative.optional(),
              })
              .strict(),
          )
          .max(12),
        selfConsumption: z
          .array(
            z
              .object({
                month,
                kWh: nonnegative,
                confirmed: z.boolean(),
                sourceRef: reference,
              })
              .strict(),
          )
          .max(12)
          .optional(),
        tariff: z
          .object({
            name: reference,
            ...reviewedRule,
            energyRateMxnKwh: nonnegative,
            fixedMonthlyMxn: nonnegative,
            demandMonthlyMxn: nonnegative,
            validFrom: month,
            validTo: month,
          })
          .strict()
          .refine(
            (v) => v.validFrom <= v.validTo,
            "Vigencia tarifaria invertida.",
          )
          .optional(),
      })
      .strict()
      .optional(),
    solar: solarSchema.optional(),
    solarSystems: z
      .array(z.object({ id: reference, design: solarSchema }).strict())
      .min(1)
      .max(100)
      .optional(),
    shadows: z
      .object({
        panelSlopeLengthM: positive,
        tiltDeg: z.number().min(0).max(90),
        designSolarElevationDeg: z.number().gt(0).max(90),
        additionalObstacleHeightM: nonnegative,
        sourceRef: reference,
      })
      .strict()
      .optional(),
    circuits: z.array(circuitSchema).max(200).optional(),
    capacitor: z
      .object({
        activeKw: positive,
        measuredPowerFactor: pf,
        targetPowerFactor: pf,
        measurementRef: reference,
        loadType: z.enum(["INDUCTIVE_SINUSOIDAL", "UNKNOWN_OR_DISTORTED"]),
      })
      .strict()
      .refine(
        (v) => v.targetPowerFactor >= v.measuredPowerFactor,
        "El factor objetivo no puede ser inferior al medido.",
      )
      .optional(),
    materials: materialSchema.optional(),
    qualityStudy: z
      .object({
        objective: reference,
        instrument: reference.optional(),
        measuredAt: reference.optional(),
        evidenceRefs: z.array(reference).max(50),
        findings: z.string().max(10000).optional(),
        reviewer: reference.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const unique = (values: (string | number)[], path: string[]) => {
      if (new Set(values).size !== values.length)
        ctx.addIssue({
          code: "custom",
          message: "No se permiten identificadores o periodos duplicados.",
          path,
        });
    };
    unique(v.consumption?.months.map((m) => m.month) ?? [], [
      "consumption",
      "months",
    ]);
    unique(v.consumption?.selfConsumption?.map((m) => m.month) ?? [], [
      "consumption",
      "selfConsumption",
    ]);
    unique(v.solar?.monthlyResource?.map((m) => m.month) ?? [], [
      "solar",
      "monthlyResource",
    ]);
    unique(v.solar?.mpptStrings?.map((m) => m.mppt) ?? [], [
      "solar",
      "mpptStrings",
    ]);
    unique(v.circuits?.map((c) => c.id) ?? [], ["circuits"]);
    unique(v.materials?.runs?.map((c) => c.id) ?? [], ["materials", "runs"]);
    unique(v.solarSystems?.map((s) => s.id) ?? [], ["solarSystems"]);
    if (v.solar && v.solarSystems)
      ctx.addIssue({
        code: "custom",
        message: "Usar solar o solarSystems, no ambos para el mismo estudio.",
        path: ["solarSystems"],
      });
  });

export type EngineeringInput = z.infer<typeof engineeringInputSchema>;
export type EngineeringIssue = {
  code: string;
  severity: "INFO" | "REVIEW" | "BLOCKER";
  path: string;
  message: string;
  sourceRefs: string[];
};
export type ResultEvidence = { assumptions: string[]; sourceRefs: string[] };
export type CircuitResult = ResultEvidence & {
  id: string;
  voltageDropV: number;
  voltageDropPct: number;
  meetsVoltageDropLimit?: boolean;
  correctedAmpacityA?: number;
  requiredAmpacityA?: number;
  meetsAmpacity?: boolean;
  breakerWithinReviewedRule?: boolean;
  groundWithinReviewedRule?: boolean;
  conduitFillFraction?: number;
  meetsConduitFill?: boolean;
};
export type SolarResult = ResultEvidence & {
  capacityKw: number;
  dcAcRatio?: number;
  totalGenerationKwh?: number;
  annualGenerationKwh?: number;
  monthlyGeneration: {
    month: string;
    days: number;
    generationKwh: number;
    sourceRefs: string[];
  }[];
  strings: {
    mppt: number;
    coldVocV: number;
    hotVmpV: number;
    coldVmpV: number;
    operatingCurrentA: number;
    designShortCircuitCurrentA: number;
    minModulesInSeries: number;
    maxModulesInSeries: number;
    compatible: boolean;
  }[];
  assignedModules?: number;
  compatible?: boolean;
};
export type MaterialResult = ResultEvidence & {
  items: {
    id: string;
    description: string;
    unit: "piece" | "m";
    requiredQuantity: number;
    purchaseQuantity: number;
    commercialUnits?: number;
  }[];
};
export type EngineeringResult = {
  version: string;
  status: "DRAFT" | "NEEDS_REVIEW" | "READY_FOR_REVIEW";
  missingData: string[];
  warnings: EngineeringIssue[];
  sourceRefs: string[];
  preliminarySizing?: PreliminarySizingResult;
  consumption?: ResultEvidence & {
    confirmedMonths: number;
    totalKwh: number;
    annualKwh?: number;
    totalHistoricalBillsMxn?: number;
    energySavingsMxn?: number;
    monthlyBilling: {
      month: string;
      beforeMxn: number;
      afterMxn: number;
      savingsMxn: number;
      unchangedDemandMxn: number;
    }[];
  };
  solar?: SolarResult;
  shadows?: ResultEvidence & {
    panelHeightM: number;
    clearGapM: number;
    rowPitchM: number;
  };
  solarSystems?: { id: string; solar: SolarResult }[];
  solarTotals?: ResultEvidence & {
    capacityKw: number;
    monthlyGeneration: { month: string; generationKwh: number }[];
    totalGenerationKwh?: number;
    annualGenerationKwh?: number;
  };
  circuits: CircuitResult[];
  materials?: MaterialResult;
  capacitor?: ResultEvidence & {
    estimateOnly: true;
    compensationKvar?: number;
    apparentBeforeKva?: number;
    apparentAfterKva?: number;
  };
  qualityStudy?: ResultEvidence & {
    status: "AWAITING_EVIDENCE" | "AWAITING_ENGINEER_REVIEW";
    objective: string;
    evidenceCount: number;
  };
};

const total = (values: number[]) => values.reduce((a, b) => a + b, 0);
function isCompleteYear(months: string[]) {
  if (months.length !== 12) return false;
  const indices = months
    .map((v) => Number(v.slice(0, 4)) * 12 + Number(v.slice(5)))
    .sort((a, b) => a - b);
  return indices.every((v, i) => i === 0 || v === indices[i - 1]! + 1);
}

/** Pure deterministic calculation. Approval of rules must be resolved by the server before invocation. */
export function calculateEngineering(
  rawInput: EngineeringInput,
): EngineeringResult {
  const input = engineeringInputSchema.parse(rawInput);
  const result: EngineeringResult = {
    version: ENGINEERING_VERSION,
    status: "DRAFT",
    missingData: [],
    warnings: [],
    sourceRefs: ["mest-recovery-audit"],
    circuits: [],
  };
  const warn = (
    code: string,
    path: string,
    message: string,
    sourceRefs: string[],
    severity: EngineeringIssue["severity"] = "REVIEW",
  ) => {
    result.warnings.push({ code, path, message, sourceRefs, severity });
  };
  const missing = (path: string, message: string, refs: string[] = []) => {
    result.missingData.push(path);
    warn("MISSING_DATA", path, message, refs);
  };

  if (input.preliminarySizing) {
    result.preliminarySizing = estimatePreliminarySizing(
      input.preliminarySizing,
    );
    warn(
      "PRELIMINARY_SIZING",
      "preliminarySizing",
      "La cantidad sugerida compara energía anual; requiere diseño de inversores, espacio, MPPT y revisión del autoconsumo antes de seleccionar equipos.",
      result.preliminarySizing.sourceRefs,
    );
  }

  if (input.solar) {
    const s = input.solar;
    const solar: SolarResult = {
      capacityKw: (s.moduleCount * s.module.powerW) / 1000,
      monthlyGeneration: [],
      strings: [],
      assumptions: [
        "Proyección simplificada E = kWp × HSP del plano × días × PR; no es una simulación horaria ni recupera la fórmula MEST.",
        "El PR declarado incluye pérdidas de temperatura, inversor, suciedad, cableado y recorte; no se restan nuevamente.",
      ],
      sourceRefs: [
        "nrel-performance-ratio",
        "pvgis-resource",
        s.module.sourceRef,
      ],
    };
    result.solar = solar;
    if (s.performanceRatio === undefined)
      missing(
        "solar.performanceRatio",
        "Definir pérdidas mediante un PR documentado.",
        solar.sourceRefs,
      );
    if (!s.performanceRatioSourceRef)
      missing(
        "solar.performanceRatioSourceRef",
        "Documentar el criterio del PR.",
        solar.sourceRefs,
      );
    if (!s.monthlyResource?.length)
      missing(
        "solar.monthlyResource",
        "Cargar recurso solar mensual del plano con periodo y procedencia.",
        ["pvgis-resource"],
      );
    if (
      s.performanceRatio !== undefined &&
      s.performanceRatioSourceRef &&
      s.monthlyResource?.length
    ) {
      solar.sourceRefs.push(s.performanceRatioSourceRef);
      solar.monthlyGeneration = s.monthlyResource.map((r) => {
        const days = new Date(
          Date.UTC(Number(r.month.slice(0, 4)), Number(r.month.slice(5)), 0),
        ).getUTCDate();
        return {
          month: r.month,
          days,
          generationKwh:
            solar.capacityKw *
            r.dailyPlaneOfArrayKwhM2 *
            days *
            s.performanceRatio!,
          sourceRefs: [
            "nrel-performance-ratio",
            r.sourceRef,
            s.performanceRatioSourceRef!,
          ],
        };
      });
      solar.totalGenerationKwh = total(
        solar.monthlyGeneration.map((m) => m.generationKwh),
      );
      solar.sourceRefs.push(...s.monthlyResource.map((r) => r.sourceRef));
      if (isCompleteYear(s.monthlyResource.map((m) => m.month)))
        solar.annualGenerationKwh = solar.totalGenerationKwh;
      else
        missing(
          "solar.monthlyResource.completeYear",
          "Se requieren doce meses consecutivos para emitir generación anual; no se extrapola el periodo parcial.",
          ["pvgis-resource"],
        );
    }
    if (!s.inverter)
      missing(
        "solar.inverter",
        "Seleccionar ficha técnica del inversor para revisar compatibilidad.",
        ["sandia-strings"],
      );
    if (!s.temperature)
      missing(
        "solar.temperature",
        "Definir temperaturas extremas de celda; la temperatura ambiente media no las reemplaza.",
        ["sandia-temperature"],
      );
    if (!s.mpptStrings?.length)
      missing("solar.mpptStrings", "Distribuir todos los módulos entre MPPT.", [
        "sandia-strings",
      ]);
    const fields = [
      "vocV",
      "vmpV",
      "iscA",
      "impA",
      "vocTemperaturePctPerC",
      "vmpTemperaturePctPerC",
    ] as const;
    for (const f of fields)
      if (s.module[f] === undefined)
        missing(`solar.module.${f}`, `Falta ${f} de la ficha del módulo.`, [
          s.module.sourceRef,
        ]);
    if (s.shortCircuitDesignFactor === undefined || !s.currentFactorSourceRef)
      missing(
        "solar.shortCircuitDesignFactor",
        "Registrar factor de corriente de diseño y su fuente para comparar Isc.",
        ["sandia-strings"],
      );
    if (s.inverter) {
      solar.dcAcRatio = solar.capacityKw / s.inverter.acPowerKw;
      solar.sourceRefs.push(s.inverter.sourceRef);
    }
    if (
      s.inverter &&
      s.temperature &&
      s.mpptStrings?.length &&
      fields.every((f) => s.module[f] !== undefined) &&
      s.shortCircuitDesignFactor !== undefined &&
      s.currentFactorSourceRef
    ) {
      const inv = s.inverter,
        m = s.module,
        t = s.temperature;
      const corrected = (v: number, coefficient: number, c: number) =>
        v * (1 + (coefficient / 100) * (c - 25));
      const coldVoc = corrected(m.vocV!, m.vocTemperaturePctPerC!, t.minCellC);
      const hotVmp = corrected(m.vmpV!, m.vmpTemperaturePctPerC!, t.maxCellC);
      const coldVmp = corrected(m.vmpV!, m.vmpTemperaturePctPerC!, t.minCellC);
      solar.sourceRefs.push(
        t.sourceRef,
        s.currentFactorSourceRef,
        "sandia-temperature",
        "sandia-strings",
      );
      if (hotVmp <= 0 || coldVoc <= 0 || coldVmp <= 0)
        warn(
          "INVALID_TEMPERATURE_MODEL",
          "solar.temperature",
          "Los coeficientes y temperaturas producen tensión no positiva; revisar las fichas.",
          solar.sourceRefs,
          "BLOCKER",
        );
      else {
        const minN = Math.ceil(inv.mpptMinV / hotVmp);
        const maxN = Math.min(
          Math.floor(inv.maxDcVoltageV / coldVoc),
          Math.floor(inv.mpptMaxV / coldVmp),
        );
        solar.strings = s.mpptStrings.map((string) => {
          const coldVocV = string.modulesInSeries * coldVoc,
            hotVmpV = string.modulesInSeries * hotVmp,
            coldVmpV = string.modulesInSeries * coldVmp;
          const operatingCurrentA = string.parallelStrings * m.impA!;
          const designShortCircuitCurrentA =
            string.parallelStrings * m.iscA! * s.shortCircuitDesignFactor!;
          const compatible =
            string.mppt <= inv.mpptCount &&
            coldVocV <= inv.maxDcVoltageV &&
            hotVmpV >= inv.mpptMinV &&
            coldVmpV <= inv.mpptMaxV &&
            operatingCurrentA <= inv.maxInputCurrentPerMpptA &&
            designShortCircuitCurrentA <= inv.maxShortCircuitCurrentPerMpptA;
          if (!compatible)
            warn(
              "STRING_INCOMPATIBLE",
              `solar.mpptStrings.${string.mppt}`,
              "La cadena excede un límite de tensión, corriente o cantidad de MPPT.",
              solar.sourceRefs,
              "BLOCKER",
            );
          return {
            mppt: string.mppt,
            coldVocV,
            hotVmpV,
            coldVmpV,
            operatingCurrentA,
            designShortCircuitCurrentA,
            minModulesInSeries: minN,
            maxModulesInSeries: maxN,
            compatible,
          };
        });
        solar.assignedModules = total(
          s.mpptStrings.map((v) => v.modulesInSeries * v.parallelStrings),
        );
        solar.compatible =
          solar.strings.every((v) => v.compatible) &&
          solar.assignedModules === s.moduleCount;
        if (solar.assignedModules !== s.moduleCount)
          warn(
            "MODULE_COUNT_MISMATCH",
            "solar.mpptStrings",
            "La distribución MPPT no coincide con el número de módulos.",
            ["sandia-strings"],
            "BLOCKER",
          );
        if (inv.maxDcPowerKw === undefined) {
          if (solar.compatible) solar.compatible = undefined;
          missing(
            "solar.inverter.maxDcPowerKw",
            "Revisar la potencia DC máxima admitida por el fabricante.",
            [inv.sourceRef],
          );
        } else if (solar.capacityKw > inv.maxDcPowerKw) {
          solar.compatible = false;
          warn(
            "DC_POWER_EXCEEDED",
            "solar.inverter",
            "La potencia de módulos supera el límite DC declarado del inversor.",
            [inv.sourceRef],
            "BLOCKER",
          );
        }
      }
    }
    warn(
      "SOLAR_ESTIMATE",
      "solar",
      "Revisar orientación, sombreado, recorte, degradación y condiciones del sitio antes de usar la proyección.",
      solar.sourceRefs,
      "INFO",
    );
  }

  if (input.solarSystems) {
    result.solarSystems = input.solarSystems.map((system) => {
      const calculated = calculateEngineering({
        segment: input.segment,
        solar: system.design,
      });
      const pathForSystem = (path: string) =>
        path.replace(/^solar(?=\.|$)/, `solarSystems.${system.id}.design`);
      result.missingData.push(...calculated.missingData.map(pathForSystem));
      result.warnings.push(
        ...calculated.warnings.map((w) => ({
          ...w,
          path: pathForSystem(w.path),
        })),
      );
      return { id: system.id, solar: calculated.solar! };
    });
    const systems = result.solarSystems.map((s) => s.solar);
    const periods = systems[0]!.monthlyGeneration.map((m) => m.month).sort();
    const matchingPeriods =
      periods.length > 0 &&
      systems.every(
        (s) =>
          s.totalGenerationKwh !== undefined &&
          s.monthlyGeneration
            .map((m) => m.month)
            .sort()
            .join(",") === periods.join(","),
      );
    result.solarTotals = {
      capacityKw: total(systems.map((s) => s.capacityKw)),
      monthlyGeneration: [],
      assumptions: [
        "Cada sistema representa un inversor y un campo homogéneo de módulos. Se comprueba cada inversor de forma independiente.",
        "Se suman energías sólo cuando todos los sistemas tienen los mismos periodos calculados; la proyección no evalúa interacción en el tablero ni límites de interconexión.",
      ],
      sourceRefs: [...new Set(systems.flatMap((s) => s.sourceRefs))],
    };
    if (matchingPeriods) {
      result.solarTotals.monthlyGeneration = periods.map((period) => ({
        month: period,
        generationKwh: total(
          systems.map(
            (s) =>
              s.monthlyGeneration.find((m) => m.month === period)!
                .generationKwh,
          ),
        ),
      }));
      result.solarTotals.totalGenerationKwh = total(
        result.solarTotals.monthlyGeneration.map((m) => m.generationKwh),
      );
      if (systems.every((s) => s.annualGenerationKwh !== undefined))
        result.solarTotals.annualGenerationKwh =
          result.solarTotals.totalGenerationKwh;
    } else
      missing(
        "solarSystems.matchingPeriods",
        "Todos los inversores requieren los mismos periodos calculados para sumar la generación del proyecto.",
        ["pvgis-resource"],
      );
  }

  if (input.consumption) {
    const c = input.consumption,
      confirmed = c.months.filter((v) => v.confirmed);
    const consumption: NonNullable<EngineeringResult["consumption"]> = {
      confirmedMonths: confirmed.length,
      totalKwh: total(confirmed.map((v) => v.kWh)),
      monthlyBilling: [],
      assumptions: [
        "Sólo se agregan meses confirmados; no se replica un mismo consumo a doce meses.",
        "Los cargos por demanda se conservan. El ahorro de energía no reduce automáticamente demanda, IVA ni otros conceptos.",
      ],
      sourceRefs: [
        "cfe-tariff-components",
        ...confirmed.map((m) => m.sourceRef),
      ],
    };
    result.consumption = consumption;
    if (confirmed.length !== c.months.length)
      missing(
        "consumption.confirmation",
        "Confirmar los recibos pendientes; se excluyeron de los totales.",
        consumption.sourceRefs,
      );
    if (!confirmed.length)
      missing(
        "consumption.months",
        "Se requiere por lo menos un mes confirmado.",
      );
    if (isCompleteYear(confirmed.map((v) => v.month)))
      consumption.annualKwh = consumption.totalKwh;
    else
      missing(
        "consumption.completeYear",
        "Completar doce meses consecutivos para un total anual sin extrapolación.",
      );
    if (confirmed.length > 0 && confirmed.every((m) => m.billMxn !== undefined))
      consumption.totalHistoricalBillsMxn = total(
        confirmed.map((m) => m.billMxn!),
      );
    if (c.tariff) {
      consumption.sourceRefs.push(c.tariff.sourceRef);
      if (!c.tariff.reviewed)
        missing(
          "consumption.tariff.reviewed",
          "La tarifa requiere revisión antes de estimar importes.",
          [c.tariff.sourceRef],
        );
      else if (!c.selfConsumption?.length)
        missing(
          "consumption.selfConsumption",
          "Definir energía autoconsumida mediante evidencia; generación mensual no equivale a autoconsumo.",
          ["cfe-tariff-components"],
        );
      else {
        for (const bill of confirmed) {
          const self = c.selfConsumption.find(
            (v) => v.month === bill.month && v.confirmed,
          );
          if (!self) {
            missing(
              `consumption.selfConsumption.${bill.month}`,
              "Falta autoconsumo confirmado para el periodo.",
            );
            continue;
          }
          if (
            bill.month < c.tariff.validFrom ||
            bill.month > c.tariff.validTo
          ) {
            missing(
              `consumption.tariff.${bill.month}`,
              "La tarifa no corresponde al periodo solicitado.",
              [c.tariff.sourceRef],
            );
            continue;
          }
          const generation = (
            result.solar?.monthlyGeneration ??
            result.solarTotals?.monthlyGeneration
          )?.find((v) => v.month === bill.month)?.generationKwh;
          if (
            self.kWh > bill.kWh ||
            (generation !== undefined && self.kWh > generation)
          ) {
            warn(
              "SELF_CONSUMPTION_EXCEEDED",
              `consumption.selfConsumption.${bill.month}`,
              "El autoconsumo supera el consumo o la generación del mes; no se corrige automáticamente.",
              [self.sourceRef],
              "BLOCKER",
            );
            continue;
          }
          const beforeMxn =
            bill.kWh * c.tariff.energyRateMxnKwh +
            c.tariff.fixedMonthlyMxn +
            c.tariff.demandMonthlyMxn;
          const savingsMxn = self.kWh * c.tariff.energyRateMxnKwh;
          consumption.monthlyBilling.push({
            month: bill.month,
            beforeMxn,
            afterMxn: beforeMxn - savingsMxn,
            savingsMxn,
            unchangedDemandMxn: c.tariff.demandMonthlyMxn,
          });
          consumption.sourceRefs.push(self.sourceRef);
        }
        if (
          consumption.monthlyBilling.length === confirmed.length &&
          confirmed.length > 0
        )
          consumption.energySavingsMxn = total(
            consumption.monthlyBilling.map((m) => m.savingsMxn),
          );
      }
      warn(
        "TARIFF_SCENARIO",
        "consumption.tariff",
        "Escenario de componente energético uniforme, antes de impuestos; no aplica escalones domésticos, bandas horarias ni liquidación de excedentes de CFE.",
        ["cfe-tariff-components"],
      );
    }
  }

  if (input.shadows) {
    const s = input.shadows,
      radians = Math.PI / 180;
    const panelHeightM = s.panelSlopeLengthM * Math.sin(s.tiltDeg * radians);
    const clearGapM =
      (panelHeightM + s.additionalObstacleHeightM) /
      Math.tan(s.designSolarElevationDeg * radians);
    result.shadows = {
      panelHeightM,
      clearGapM,
      rowPitchM:
        s.panelSlopeLengthM * Math.cos(s.tiltDeg * radians) + clearGapM,
      assumptions: [
        "Terreno horizontal, filas paralelas y sol perpendicular a la fila en la condición de diseño declarada. La distancia es perpendicular a las filas.",
        "No sustituye trayectoria solar, relieve, obstáculos tridimensionales ni revisión estructural.",
      ],
      sourceRefs: ["ennco-geometry", s.sourceRef],
    };
  }

  for (const c of input.circuits ?? []) {
    const resistanceOhmPerM = c.resistivityOhmMm2PerM / c.crossSectionMm2;
    const powerFactor = c.type === "DC" ? 1 : c.powerFactor!;
    const reactanceOhmPerM = c.type === "DC" ? 0 : c.reactanceOhmPerKm! / 1000;
    const factor = c.type === "AC_THREE_PHASE" ? Math.sqrt(3) : 2;
    const voltageDropV =
      factor *
      c.currentA *
      c.oneWayLengthM *
      (resistanceOhmPerM * powerFactor +
        reactanceOhmPerM * Math.sqrt(1 - powerFactor ** 2));
    const circuit: CircuitResult = {
      id: c.id,
      voltageDropV,
      voltageDropPct: (100 * voltageDropV) / c.voltageV,
      sourceRefs: ["schneider-voltage-drop", c.conductorSourceRef],
      assumptions: [
        "Longitud de ida; DC y monofásico incluyen retorno mediante factor 2. Trifásico equilibrado usa tensión entre fases.",
        `Resistividad declarada a ${c.conductorTemperatureC} °C; no se aplica otra corrección de temperatura.`,
        "No comprueba cortocircuito, capacidad interruptiva, selectividad, arranque ni toda la instalación.",
      ],
    };
    if (c.voltageDropLimitPct !== undefined && c.voltageDropLimitSourceRef) {
      circuit.meetsVoltageDropLimit =
        circuit.voltageDropPct <= c.voltageDropLimitPct;
      circuit.sourceRefs.push(c.voltageDropLimitSourceRef);
      if (!circuit.meetsVoltageDropLimit)
        warn(
          "VOLTAGE_DROP_EXCEEDED",
          `circuits.${c.id}`,
          "La caída de tensión supera el límite de diseño declarado.",
          circuit.sourceRefs,
          "BLOCKER",
        );
    } else
      missing(
        `circuits.${c.id}.voltageDropLimit`,
        "Documentar el límite de caída de tensión aplicable.",
      );
    if (c.ampacity?.reviewed) {
      circuit.correctedAmpacityA = Math.min(
        c.ampacity.baseA *
          c.ampacity.temperatureFactor *
          c.ampacity.groupingFactor,
        c.ampacity.terminalLimitA,
      );
      circuit.requiredAmpacityA =
        c.currentA * c.ampacity.requiredCurrentMultiplier;
      circuit.meetsAmpacity =
        circuit.correctedAmpacityA >= circuit.requiredAmpacityA;
      circuit.sourceRefs.push(c.ampacity.sourceRef);
      if (!circuit.meetsAmpacity)
        warn(
          "AMPACITY_EXCEEDED",
          `circuits.${c.id}`,
          "El conductor no alcanza la ampacidad requerida por la regla revisada.",
          [c.ampacity.sourceRef],
          "BLOCKER",
        );
    } else
      missing(
        `circuits.${c.id}.ampacity`,
        "Se requiere tabla y factores de ampacidad revisados; la sección por sí sola no acredita capacidad.",
        ["nom-catalog-review"],
      );
    if (c.protectionRule?.reviewed) {
      const rule = c.protectionRule;
      circuit.sourceRefs.push(rule.sourceRef);
      if (
        c.breakerA !== undefined &&
        circuit.correctedAmpacityA !== undefined
      ) {
        circuit.breakerWithinReviewedRule =
          c.breakerA >= c.currentA * rule.minimumBreakerMultiplier &&
          c.breakerA <= rule.maximumBreakerA &&
          c.breakerA <= circuit.correctedAmpacityA;
        if (!circuit.breakerWithinReviewedRule)
          warn(
            "BREAKER_OUTSIDE_RULE",
            `circuits.${c.id}.breakerA`,
            "La protección está fuera de la regla revisada o la ampacidad corregida.",
            [rule.sourceRef],
            "BLOCKER",
          );
      } else
        missing(
          `circuits.${c.id}.breakerA`,
          "Definir protección y ampacidad revisada para comparar.",
          [rule.sourceRef],
        );
      if (c.groundCrossSectionMm2 !== undefined) {
        circuit.groundWithinReviewedRule =
          c.groundCrossSectionMm2 >= rule.minimumGroundMm2;
        if (!circuit.groundWithinReviewedRule)
          warn(
            "GROUND_OUTSIDE_RULE",
            `circuits.${c.id}.groundCrossSectionMm2`,
            "La sección de tierra es inferior a la regla revisada.",
            [rule.sourceRef],
            "BLOCKER",
          );
      } else
        missing(
          `circuits.${c.id}.groundCrossSectionMm2`,
          "Registrar sección del conductor de protección.",
          [rule.sourceRef],
        );
    } else
      missing(
        `circuits.${c.id}.protectionRule`,
        "Protecciones y tierra requieren regla revisada; no se seleccionan automáticamente.",
        ["nom-catalog-review"],
      );
    if (c.conduit?.reviewed) {
      circuit.conduitFillFraction =
        c.conduit.occupiedAreaMm2 / c.conduit.internalAreaMm2;
      circuit.meetsConduitFill =
        circuit.conduitFillFraction <= c.conduit.allowedFillFraction;
      circuit.sourceRefs.push(c.conduit.sourceRef);
      if (!circuit.meetsConduitFill)
        warn(
          "CONDUIT_FILL_EXCEEDED",
          `circuits.${c.id}.conduit`,
          "La ocupación excede el límite de la regla revisada.",
          [c.conduit.sourceRef],
          "BLOCKER",
        );
    } else if (c.conduit)
      missing(
        `circuits.${c.id}.conduit.reviewed`,
        "Revisar diámetro interno, área exterior de cables y límite de ocupación.",
      );
    result.circuits.push(circuit);
  }

  if (input.capacitor) {
    const c = input.capacitor;
    result.capacitor = {
      estimateOnly: true,
      assumptions: [
        "Carga inductiva sinusoidal a potencia activa constante y factores de desplazamiento medidos en la misma condición.",
        "La estimación no selecciona tamaño comercial, pasos, filtros, tensión del banco ni protección.",
      ],
      sourceRefs: ["schneider-capacitor", c.measurementRef],
    };
    if (c.loadType === "INDUCTIVE_SINUSOIDAL") {
      result.capacitor.compensationKvar =
        c.activeKw *
        (Math.tan(Math.acos(c.measuredPowerFactor)) -
          Math.tan(Math.acos(c.targetPowerFactor)));
      result.capacitor.apparentBeforeKva = c.activeKw / c.measuredPowerFactor;
      result.capacitor.apparentAfterKva = c.activeKw / c.targetPowerFactor;
    } else
      missing(
        "capacitor.displacementFactor",
        "Con distorsión o tipo de carga desconocido se requiere estudio; no se usa el factor total como coseno de desplazamiento.",
        ["schneider-capacitor"],
      );
    warn(
      "CAPACITOR_ENGINEER_REVIEW",
      "capacitor",
      "Revisar armónicos, resonancia, variación de carga y sobrecompensación antes de seleccionar un banco.",
      ["schneider-capacitor"],
    );
  }

  if (input.materials) {
    const m = input.materials;
    const materials: MaterialResult = {
      items: [],
      assumptions: [
        "Cantidades geométricas según regla de montaje declarada, pendientes de revisión en sitio.",
        `Reserva explícita de ${m.reservePct}% para piezas y longitudes; compras en unidades completas por partida, sin optimizar cortes entre recorridos.`,
        "No selecciona anclajes ni acredita resistencia estructural.",
      ],
      sourceRefs: ["ennco-geometry", m.sourceRef],
    };
    result.materials = materials;
    const addLinear = (
      id: string,
      description: string,
      lengthM: number,
      commercialLengthM: number,
    ) => {
      const commercialUnits = Math.ceil(
        (lengthM * (1 + m.reservePct / 100)) / commercialLengthM,
      );
      materials.items.push({
        id,
        description,
        unit: "m",
        requiredQuantity: lengthM,
        commercialUnits,
        purchaseQuantity: commercialUnits * commercialLengthM,
      });
    };
    const addPieces = (
      id: string,
      description: string,
      quantity: number,
      reserve = true,
    ) =>
      materials.items.push({
        id,
        description,
        unit: "piece",
        requiredQuantity: quantity,
        purchaseQuantity: Math.ceil(
          quantity * (reserve ? 1 + m.reservePct / 100 : 1),
        ),
      });
    if (m.layout) {
      const l = m.layout,
        modules = l.rows * l.modulesPerRow;
      addPieces("modules", "Módulos", modules, false);
      addPieces(
        "fixtures",
        "Fijaciones según regla de montaje",
        modules * l.fixturesPerModule,
      );
      addPieces(
        "connectors",
        "Conectores según cadenas",
        l.stringCount * l.connectorsPerString,
      );
      // Every continuous rail line is purchased independently: offcuts are not assumed reusable.
      const lineLengthM =
        l.modulesPerRow * l.moduleWidthM +
        (l.modulesPerRow - 1) * l.moduleGapM +
        2 * l.railEndAllowanceM;
      const linePieces = Math.ceil(
        (lineLengthM * (1 + m.reservePct / 100)) / l.railCommercialLengthM,
      );
      materials.items.push({
        id: "rails",
        description: "Rieles por línea de montaje",
        unit: "m",
        requiredQuantity: lineLengthM * l.rows * l.railLinesPerRow,
        commercialUnits: linePieces * l.rows * l.railLinesPerRow,
        purchaseQuantity:
          linePieces * l.rows * l.railLinesPerRow * l.railCommercialLengthM,
      });
      const solarDesigns = input.solar
        ? [input.solar]
        : input.solarSystems?.map((s) => s.design);
      if (
        solarDesigns &&
        modules !== total(solarDesigns.map((s) => s.moduleCount))
      )
        warn(
          "LAYOUT_MODULE_MISMATCH",
          "materials.layout",
          "Las filas no coinciden con el total de módulos del diseño solar.",
          materials.sourceRefs,
          "BLOCKER",
        );
      if (
        solarDesigns?.every((s) => s.mpptStrings?.length) &&
        l.stringCount !==
          total(
            solarDesigns.flatMap((s) =>
              s.mpptStrings!.map((string) => string.parallelStrings),
            ),
          )
      )
        warn(
          "LAYOUT_STRING_MISMATCH",
          "materials.layout.stringCount",
          "Las cadenas del montaje no coinciden con la distribución MPPT.",
          materials.sourceRefs,
          "BLOCKER",
        );
    }
    for (const r of m.runs ?? [])
      addLinear(
        `run:${r.id}`,
        r.kind === "CABLE" ? `Cable · ${r.id}` : `Canalización · ${r.id}`,
        r.oneWayLengthM * r.parallelPieces,
        r.commercialLengthM,
      );
    if (!materials.items.length)
      missing(
        "materials.measures",
        "Agregar filas de módulos o recorridos medidos.",
      );
  }

  if (input.qualityStudy) {
    const q = input.qualityStudy;
    result.qualityStudy = {
      status: q.evidenceRefs.length
        ? "AWAITING_ENGINEER_REVIEW"
        : "AWAITING_EVIDENCE",
      objective: q.objective,
      evidenceCount: q.evidenceRefs.length,
      assumptions: [
        "Expediente de estudio manual: no hay algoritmo recuperado de armónicos, frecuencias ni selección de filtros.",
      ],
      sourceRefs: q.evidenceRefs,
    };
    if (!q.evidenceRefs.length)
      missing("qualityStudy.evidenceRefs", "Adjuntar mediciones del estudio.");
    warn(
      "QUALITY_MANUAL_REVIEW",
      "qualityStudy",
      "El responsable de ingeniería debe interpretar y validar las mediciones.",
      q.evidenceRefs,
    );
  }
  const outputs = [
    result.preliminarySizing,
    result.solar,
    result.solarTotals,
    ...(result.solarSystems?.map((s) => s.solar) ?? []),
    result.consumption,
    result.shadows,
    result.capacitor,
    result.materials,
    result.qualityStudy,
    ...result.circuits,
  ].filter((v): v is NonNullable<typeof v> => Boolean(v));
  result.sourceRefs = [
    ...new Set([
      ...result.sourceRefs,
      ...outputs.flatMap((v) => v.sourceRefs),
      ...result.warnings.flatMap((w) => w.sourceRefs),
    ]),
  ];
  result.missingData = [...new Set(result.missingData)];
  result.status = !outputs.length
    ? "DRAFT"
    : result.warnings.some((w) => w.severity !== "INFO")
      ? "NEEDS_REVIEW"
      : "READY_FOR_REVIEW";
  // Numeric overflow is a validation failure, never a serializable successful result.
  const checkFinite = (value: unknown): void => {
    if (typeof value === "number" && !Number.isFinite(value))
      throw new Error(
        "El cálculo produjo un valor no finito; revisar magnitudes de entrada.",
      );
    if (value && typeof value === "object")
      Object.values(value).forEach(checkFinite);
  };
  checkFinite(result);
  return result;
}
