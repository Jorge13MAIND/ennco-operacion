import { createHash } from "node:crypto";

import { z } from "zod";

export const ENTERPRISE_SLI_CODES = [
  "PUBLIC_AVAILABILITY",
  "ACCEPTED_REQUEST_DURABILITY",
  "CRITICAL_ALERT_LATENCY",
  "REPLY_SYNC_LATENCY",
  "SUPPRESSION_ENFORCEMENT",
  "RETRY_DUPLICATE_SEND",
] as const;

export const ENTERPRISE_SLO_WINDOWS = ["SHORT", "LONG", "MONTH_TO_DATE"] as const;

export type EnterpriseSliCode = (typeof ENTERPRISE_SLI_CODES)[number];
export type EnterpriseSloStatus = "HEALTHY" | "AT_RISK" | "EXHAUSTED" | "UNKNOWN";

const SHA1_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const MAX_COLLECTION_AGE_MS = 10 * 60 * 1_000;
const WINDOW_DURATION_MS = {
  SHORT: 60 * 60 * 1_000,
  LONG: 6 * 60 * 60 * 1_000,
} as const;

const sliCodeSchema = z.enum(ENTERPRISE_SLI_CODES);
const windowKindSchema = z.enum(ENTERPRISE_SLO_WINDOWS);
const timestampSchema = z.iso.datetime({ offset: true });

const windowObservationSchema = z.object({
  kind: windowKindSchema,
  startedAt: timestampSchema,
  endedAt: timestampSchema,
  collectedAt: timestampSchema,
  totalEvents: z.number().int().safe().nonnegative(),
  badEvents: z.number().int().safe().nonnegative(),
  observedP95Ms: z.number().finite().nonnegative().nullable(),
  sourceReference: z.string().trim().min(3).max(500),
  querySha256: z.string().regex(SHA256_PATTERN),
}).strict();

const seriesSchema = z.object({
  code: sliCodeSchema,
  dimension: z.enum(["CAPTURE", "PORTAL", "ALL"]),
  windows: z.array(windowObservationSchema).length(3),
}).strict();

export const enterpriseSloSnapshotSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  evidenceClass: z.enum(["synthetic_demo", "live"]),
  environment: z.enum(["local", "managed_staging", "production"]),
  evaluatedAt: timestampSchema,
  sourceCommitSha: z.string().regex(SHA1_PATTERN),
  sourceTreeSha: z.string().regex(SHA1_PATTERN),
  collector: z.string().trim().min(3).max(160),
  collectorVersion: z.string().trim().min(1).max(80),
  series: z.array(seriesSchema).length(7),
}).strict();

export type EnterpriseSloSnapshot = z.infer<typeof enterpriseSloSnapshotSchema>;
export type EnterpriseSloWindowObservation = z.infer<typeof windowObservationSchema>;

type SliDefinition = {
  targetSuccessRatio: number;
  zeroTolerance: boolean;
  latencyThresholdMs: number | null;
  dimensions: readonly string[];
};

export const ENTERPRISE_SLI_DEFINITIONS: Record<EnterpriseSliCode, SliDefinition> = {
  PUBLIC_AVAILABILITY: {
    targetSuccessRatio: 0.999,
    zeroTolerance: false,
    latencyThresholdMs: null,
    dimensions: ["CAPTURE", "PORTAL"],
  },
  ACCEPTED_REQUEST_DURABILITY: {
    targetSuccessRatio: 1,
    zeroTolerance: true,
    latencyThresholdMs: null,
    dimensions: ["ALL"],
  },
  CRITICAL_ALERT_LATENCY: {
    targetSuccessRatio: 0.95,
    zeroTolerance: false,
    latencyThresholdMs: 120_000,
    dimensions: ["ALL"],
  },
  REPLY_SYNC_LATENCY: {
    targetSuccessRatio: 0.95,
    zeroTolerance: false,
    latencyThresholdMs: 300_000,
    dimensions: ["ALL"],
  },
  SUPPRESSION_ENFORCEMENT: {
    targetSuccessRatio: 1,
    zeroTolerance: true,
    latencyThresholdMs: null,
    dimensions: ["ALL"],
  },
  RETRY_DUPLICATE_SEND: {
    targetSuccessRatio: 1,
    zeroTolerance: true,
    latencyThresholdMs: null,
    dimensions: ["ALL"],
  },
};

type WindowEvaluation = {
  kind: (typeof ENTERPRISE_SLO_WINDOWS)[number];
  totalEvents: number;
  badEvents: number;
  observedSuccessRatio: number;
  observedP95Ms: number | null;
  targetSuccessRatio: number;
  latencyThresholdMs: number | null;
  objectiveMet: boolean;
  burnRate: number | null;
};

type DimensionEvaluation = {
  dimension: string;
  status: Exclude<EnterpriseSloStatus, "UNKNOWN">;
  windows: WindowEvaluation[];
};

export type EnterpriseSliEvaluation = {
  code: EnterpriseSliCode;
  status: Exclude<EnterpriseSloStatus, "UNKNOWN">;
  dimensions: DimensionEvaluation[];
};

export type EnterpriseSloEvaluation = {
  status: EnterpriseSloStatus;
  featureFreeze: boolean;
  reasonCodes: string[];
  evidenceClass: "synthetic_demo" | "live" | "UNKNOWN";
  environment: "local" | "managed_staging" | "production" | "UNKNOWN";
  evaluatedAt: string | null;
  sourceCommitSha: string | null;
  sourceTreeSha: string | null;
  snapshotSha256: string;
  sliResults: EnterpriseSliEvaluation[];
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]));
  }
  return value;
}

function canonicalSnapshot(snapshot: EnterpriseSloSnapshot): EnterpriseSloSnapshot {
  return {
    ...snapshot,
    series: [...snapshot.series]
      .sort((left, right) => `${left.code}:${left.dimension}`.localeCompare(`${right.code}:${right.dimension}`))
      .map((series) => ({
        ...series,
        windows: [...series.windows].sort((left, right) => left.kind.localeCompare(right.kind)),
      })),
  };
}

export function calculateEnterpriseSloSnapshotSha256(snapshot: EnterpriseSloSnapshot): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(canonicalSnapshot(snapshot))))
    .digest("hex");
}

function unknown(input: unknown, reasonCodes: string[]): EnterpriseSloEvaluation {
  let snapshotSha256: string;
  try {
    snapshotSha256 = createHash("sha256").update(JSON.stringify(canonicalize(input))).digest("hex");
  } catch {
    snapshotSha256 = createHash("sha256").update("UNSERIALIZABLE_SLO_INPUT").digest("hex");
  }
  return {
    status: "UNKNOWN",
    featureFreeze: true,
    reasonCodes: [...new Set(reasonCodes)].sort(),
    evidenceClass: "UNKNOWN",
    environment: "UNKNOWN",
    evaluatedAt: null,
    sourceCommitSha: null,
    sourceTreeSha: null,
    snapshotSha256,
    sliResults: [],
  };
}

function unknownFromSnapshot(snapshot: EnterpriseSloSnapshot, reasonCodes: string[]): EnterpriseSloEvaluation {
  return {
    status: "UNKNOWN",
    featureFreeze: true,
    reasonCodes: [...new Set(reasonCodes)].sort(),
    evidenceClass: snapshot.evidenceClass,
    environment: snapshot.environment,
    evaluatedAt: snapshot.evaluatedAt,
    sourceCommitSha: snapshot.sourceCommitSha,
    sourceTreeSha: snapshot.sourceTreeSha,
    snapshotSha256: calculateEnterpriseSloSnapshotSha256(snapshot),
    sliResults: [],
  };
}

function expectedSeriesKeys(): string[] {
  return ENTERPRISE_SLI_CODES.flatMap((code) =>
    ENTERPRISE_SLI_DEFINITIONS[code].dimensions.map((dimension) => `${code}:${dimension}`),
  ).sort();
}

function mexicoCityParts(timestamp: string): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month) };
}

function zonedMonthStartUtc(timestamp: string): number {
  const { year, month } = mexicoCityParts(timestamp);
  let guess = Date.UTC(year, month - 1, 1, 0, 0, 0);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Mexico_City",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const representedAsUtc = Date.UTC(
      Number(values.year), Number(values.month) - 1, Number(values.day),
      Number(values.hour), Number(values.minute), Number(values.second),
    );
    guess -= representedAsUtc - Date.UTC(year, month - 1, 1, 0, 0, 0);
  }
  return guess;
}

function semanticFailures(snapshot: EnterpriseSloSnapshot): string[] {
  const failures: string[] = [];
  const evaluatedAt = Date.parse(snapshot.evaluatedAt);
  const actualKeys = snapshot.series.map((series) => `${series.code}:${series.dimension}`).sort();
  if (actualKeys.join("|") !== expectedSeriesKeys().join("|")) failures.push("SLO_SERIES_SET_INCOMPLETE");

  for (const series of snapshot.series) {
    const definition = ENTERPRISE_SLI_DEFINITIONS[series.code];
    if (!definition.dimensions.includes(series.dimension)) failures.push("SLO_DIMENSION_INVALID");
    const kinds = series.windows.map((window) => window.kind).sort();
    if (kinds.join("|") !== [...ENTERPRISE_SLO_WINDOWS].sort().join("|")) {
      failures.push("SLO_WINDOW_SET_INCOMPLETE");
    }
    for (const window of series.windows) {
      const startedAt = Date.parse(window.startedAt);
      const endedAt = Date.parse(window.endedAt);
      const collectedAt = Date.parse(window.collectedAt);
      if (window.totalEvents === 0) failures.push("SLO_DENOMINATOR_MISSING");
      if (window.badEvents > window.totalEvents) failures.push("SLO_BAD_EVENTS_EXCEED_TOTAL");
      if (startedAt >= endedAt || endedAt > evaluatedAt + MAX_CLOCK_SKEW_MS) failures.push("SLO_WINDOW_TIME_INVALID");
      if (collectedAt < endedAt || collectedAt > evaluatedAt + MAX_CLOCK_SKEW_MS
        || evaluatedAt - collectedAt > MAX_COLLECTION_AGE_MS) failures.push("SLO_TELEMETRY_STALE");
      if (window.kind === "SHORT" && Math.abs((endedAt - startedAt) - WINDOW_DURATION_MS.SHORT) > 1_000) {
        failures.push("SLO_SHORT_WINDOW_INVALID");
      }
      if (window.kind === "LONG" && Math.abs((endedAt - startedAt) - WINDOW_DURATION_MS.LONG) > 1_000) {
        failures.push("SLO_LONG_WINDOW_INVALID");
      }
      if (window.kind === "MONTH_TO_DATE" && Math.abs(startedAt - zonedMonthStartUtc(snapshot.evaluatedAt)) > 1_000) {
        failures.push("SLO_MONTH_WINDOW_INVALID");
      }
      if (Math.abs(evaluatedAt - endedAt) > MAX_COLLECTION_AGE_MS) failures.push("SLO_WINDOW_NOT_CURRENT");
      if (definition.latencyThresholdMs === null && window.observedP95Ms !== null) failures.push("SLO_UNEXPECTED_LATENCY_QUANTILE");
      if (definition.latencyThresholdMs !== null && window.observedP95Ms === null) failures.push("SLO_LATENCY_QUANTILE_MISSING");
    }
  }
  return [...new Set(failures)].sort();
}

function evaluateWindow(
  window: EnterpriseSloWindowObservation,
  definition: SliDefinition,
): WindowEvaluation {
  const observedSuccessRatio = 1 - window.badEvents / window.totalEvents;
  const errorBudgetRatio = 1 - definition.targetSuccessRatio;
  const burnRate = definition.zeroTolerance ? null : (window.badEvents / window.totalEvents) / errorBudgetRatio;
  const latencyMet = definition.latencyThresholdMs === null
    || (window.observedP95Ms !== null && window.observedP95Ms < definition.latencyThresholdMs);
  const objectiveMet = definition.zeroTolerance
    ? window.badEvents === 0 && latencyMet
    : observedSuccessRatio >= definition.targetSuccessRatio && latencyMet;
  return {
    kind: window.kind,
    totalEvents: window.totalEvents,
    badEvents: window.badEvents,
    observedSuccessRatio,
    observedP95Ms: window.observedP95Ms,
    targetSuccessRatio: definition.targetSuccessRatio,
    latencyThresholdMs: definition.latencyThresholdMs,
    objectiveMet,
    burnRate,
  };
}

function evaluateDimension(
  dimension: string,
  windows: EnterpriseSloWindowObservation[],
  definition: SliDefinition,
): DimensionEvaluation {
  const evaluated = windows.map((window) => evaluateWindow(window, definition));
  const month = evaluated.find((window) => window.kind === "MONTH_TO_DATE")!;
  const shortAndLong = evaluated.filter((window) => window.kind !== "MONTH_TO_DATE");
  let status: DimensionEvaluation["status"] = "HEALTHY";
  if (!month.objectiveMet || (definition.zeroTolerance && evaluated.some((window) => window.badEvents > 0))) {
    status = "EXHAUSTED";
  } else if (shortAndLong.some((window) => !window.objectiveMet || (window.burnRate ?? 0) > 1)
    || (month.burnRate ?? 0) >= 0.5) {
    status = "AT_RISK";
  }
  return { dimension, status, windows: evaluated.sort((left, right) => left.kind.localeCompare(right.kind)) };
}

const statusRank: Record<EnterpriseSloStatus, number> = {
  HEALTHY: 0,
  AT_RISK: 1,
  EXHAUSTED: 2,
  UNKNOWN: 3,
};

function worstStatus(statuses: EnterpriseSloStatus[]): EnterpriseSloStatus {
  return [...statuses].sort((left, right) => statusRank[right] - statusRank[left])[0] ?? "UNKNOWN";
}

export function evaluateEnterpriseSloSnapshot(input: unknown): EnterpriseSloEvaluation {
  const parsed = enterpriseSloSnapshotSchema.safeParse(input);
  if (!parsed.success) return unknown(input, ["SLO_SCHEMA_INVALID"]);
  const snapshot = canonicalSnapshot(parsed.data);
  const failures = semanticFailures(snapshot);
  if (failures.length > 0) return unknownFromSnapshot(snapshot, failures);

  const snapshotSha256 = calculateEnterpriseSloSnapshotSha256(snapshot);
  if (snapshot.evidenceClass !== "live") {
    return unknownFromSnapshot(snapshot, ["SLO_NON_LIVE_EVIDENCE"]);
  }
  if (!new Set(["managed_staging", "production"]).has(snapshot.environment)) {
    return unknownFromSnapshot(snapshot, ["SLO_ENVIRONMENT_NOT_MANAGED"]);
  }

  const sliResults = ENTERPRISE_SLI_CODES.map((code): EnterpriseSliEvaluation => {
    const definition = ENTERPRISE_SLI_DEFINITIONS[code];
    const dimensions = snapshot.series
      .filter((series) => series.code === code)
      .map((series) => evaluateDimension(series.dimension, series.windows, definition));
    return {
      code,
      status: worstStatus(dimensions.map((dimension) => dimension.status)) as Exclude<EnterpriseSloStatus, "UNKNOWN">,
      dimensions,
    };
  });
  const status = worstStatus(sliResults.map((result) => result.status));
  return {
    status,
    featureFreeze: status !== "HEALTHY",
    reasonCodes: status === "HEALTHY" ? [] : [`SLO_${status}`],
    evidenceClass: snapshot.evidenceClass,
    environment: snapshot.environment,
    evaluatedAt: snapshot.evaluatedAt,
    sourceCommitSha: snapshot.sourceCommitSha,
    sourceTreeSha: snapshot.sourceTreeSha,
    snapshotSha256,
    sliResults,
  };
}
