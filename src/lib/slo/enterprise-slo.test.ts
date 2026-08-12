import { describe, expect, it } from "vitest";

import {
  calculateEnterpriseSloSnapshotSha256,
  ENTERPRISE_SLI_CODES,
  evaluateEnterpriseSloSnapshot,
  type EnterpriseSliCode,
  type EnterpriseSloSnapshot,
} from "@/lib/slo/enterprise-slo";

const evaluatedAt = "2026-08-12T12:00:00.000-06:00";
const collectedAt = "2026-08-12T12:00:00.000-06:00";

function windows(code: EnterpriseSliCode) {
  const latency = code === "CRITICAL_ALERT_LATENCY" ? 60_000
    : code === "REPLY_SYNC_LATENCY" ? 180_000 : null;
  return [
    { kind: "SHORT" as const, startedAt: "2026-08-12T11:00:00.000-06:00", endedAt: evaluatedAt },
    { kind: "LONG" as const, startedAt: "2026-08-12T06:00:00.000-06:00", endedAt: evaluatedAt },
    { kind: "MONTH_TO_DATE" as const, startedAt: "2026-08-01T00:00:00.000-06:00", endedAt: evaluatedAt },
  ].map((window) => ({
    ...window,
    collectedAt,
    totalEvents: 100_000,
    badEvents: 0,
    observedP95Ms: latency,
    sourceReference: `synthetic fixture ${code}`,
    querySha256: "a".repeat(64),
  }));
}

function completeSnapshot(overrides: Partial<EnterpriseSloSnapshot> = {}): EnterpriseSloSnapshot {
  return {
    schemaVersion: "1.0.0",
    evidenceClass: "live",
    environment: "managed_staging",
    evaluatedAt,
    sourceCommitSha: "1".repeat(40),
    sourceTreeSha: "2".repeat(40),
    collector: "synthetic unit fixture",
    collectorVersion: "1.0.0",
    series: ENTERPRISE_SLI_CODES.flatMap((code) => {
      const dimensions = code === "PUBLIC_AVAILABILITY" ? ["CAPTURE", "PORTAL"] as const : ["ALL"] as const;
      return dimensions.map((dimension) => ({ code, dimension, windows: windows(code) }));
    }),
    ...overrides,
  };
}

function mutateWindow(
  snapshot: EnterpriseSloSnapshot,
  code: EnterpriseSliCode,
  kind: "SHORT" | "LONG" | "MONTH_TO_DATE",
  mutation: Record<string, unknown>,
): EnterpriseSloSnapshot {
  return {
    ...snapshot,
    series: snapshot.series.map((series) => series.code !== code ? series : {
      ...series,
      windows: series.windows.map((window) => window.kind !== kind ? window : { ...window, ...mutation }),
    }),
  } as EnterpriseSloSnapshot;
}

describe("enterprise SLO contract", () => {
  it("requires exactly the six canonical SLI and both public availability dimensions", () => {
    const complete = completeSnapshot();
    expect(evaluateEnterpriseSloSnapshot(complete)).toMatchObject({ status: "HEALTHY", featureFreeze: false });
    const missing = { ...complete, series: complete.series.slice(0, 6) };
    expect(evaluateEnterpriseSloSnapshot(missing)).toMatchObject({
      status: "UNKNOWN",
      featureFreeze: true,
      reasonCodes: ["SLO_SCHEMA_INVALID"],
    });
    expect(ENTERPRISE_SLI_CODES).toHaveLength(6);
  });

  it("never promotes synthetic or local telemetry to live health", () => {
    expect(evaluateEnterpriseSloSnapshot(completeSnapshot({ evidenceClass: "synthetic_demo", environment: "local" })))
      .toMatchObject({ status: "UNKNOWN", featureFreeze: true, reasonCodes: ["SLO_NON_LIVE_EVIDENCE"] });
    expect(evaluateEnterpriseSloSnapshot(completeSnapshot({ environment: "local" })))
      .toMatchObject({ status: "UNKNOWN", featureFreeze: true, reasonCodes: ["SLO_ENVIRONMENT_NOT_MANAGED"] });
  });

  it("fails closed on a missing denominator, stale collection or invalid windows", () => {
    expect(evaluateEnterpriseSloSnapshot(mutateWindow(completeSnapshot(), "PUBLIC_AVAILABILITY", "SHORT", { totalEvents: 0 })))
      .toMatchObject({ status: "UNKNOWN", reasonCodes: expect.arrayContaining(["SLO_DENOMINATOR_MISSING"]) });
    expect(evaluateEnterpriseSloSnapshot(mutateWindow(completeSnapshot(), "PUBLIC_AVAILABILITY", "SHORT", { collectedAt: "2026-08-12T11:40:00.000-06:00" })))
      .toMatchObject({ status: "UNKNOWN", reasonCodes: expect.arrayContaining(["SLO_TELEMETRY_STALE"]) });
    expect(evaluateEnterpriseSloSnapshot(mutateWindow(completeSnapshot(), "PUBLIC_AVAILABILITY", "SHORT", { startedAt: "2026-08-12T10:00:00.000-06:00" })))
      .toMatchObject({ status: "UNKNOWN", reasonCodes: expect.arrayContaining(["SLO_SHORT_WINDOW_INVALID"]) });
    expect(evaluateEnterpriseSloSnapshot(mutateWindow(completeSnapshot(), "PUBLIC_AVAILABILITY", "MONTH_TO_DATE", { startedAt: "2026-08-02T00:00:00.000-06:00" })))
      .toMatchObject({ status: "UNKNOWN", reasonCodes: expect.arrayContaining(["SLO_MONTH_WINDOW_INVALID"]) });
  });

  it("rejects duplicate window kinds and preserves trusted provenance for semantic UNKNOWN", () => {
    const snapshot = completeSnapshot();
    const duplicated = {
      ...snapshot,
      series: snapshot.series.map((series, index) => index !== 0 ? series : {
        ...series,
        windows: series.windows.map((window, windowIndex) => windowIndex !== 2 ? window : {
          ...window,
          kind: "SHORT" as const,
          startedAt: "2026-08-12T11:00:00.000-06:00",
        }),
      }),
    };
    const result = evaluateEnterpriseSloSnapshot(duplicated);
    expect(result).toMatchObject({
      status: "UNKNOWN",
      featureFreeze: true,
      reasonCodes: expect.arrayContaining(["SLO_WINDOW_SET_INCOMPLETE"]),
      sourceCommitSha: snapshot.sourceCommitSha,
      sourceTreeSha: snapshot.sourceTreeSha,
    });
    expect(result.snapshotSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("requires p95 measurements for latency SLI and rejects them on counter-only SLI", () => {
    expect(evaluateEnterpriseSloSnapshot(mutateWindow(completeSnapshot(), "CRITICAL_ALERT_LATENCY", "SHORT", { observedP95Ms: null })))
      .toMatchObject({ status: "UNKNOWN", reasonCodes: expect.arrayContaining(["SLO_LATENCY_QUANTILE_MISSING"]) });
    expect(evaluateEnterpriseSloSnapshot(mutateWindow(completeSnapshot(), "SUPPRESSION_ENFORCEMENT", "SHORT", { observedP95Ms: 1 })))
      .toMatchObject({ status: "UNKNOWN", reasonCodes: expect.arrayContaining(["SLO_UNEXPECTED_LATENCY_QUANTILE"]) });
  });

  it("exhausts zero-tolerance SLI on one silent loss, suppression miss or retry duplicate", () => {
    for (const code of ["ACCEPTED_REQUEST_DURABILITY", "SUPPRESSION_ENFORCEMENT", "RETRY_DUPLICATE_SEND"] as const) {
      const result = evaluateEnterpriseSloSnapshot(mutateWindow(completeSnapshot(), code, "MONTH_TO_DATE", { badEvents: 1 }));
      expect(result).toMatchObject({ status: "EXHAUSTED", featureFreeze: true });
      expect(result.sliResults.find((sli) => sli.code === code)?.status).toBe("EXHAUSTED");
    }
  });

  it("freezes features on a latency breach or burn rate above one", () => {
    const latency = evaluateEnterpriseSloSnapshot(mutateWindow(completeSnapshot(), "CRITICAL_ALERT_LATENCY", "SHORT", { observedP95Ms: 120_000 }));
    expect(latency).toMatchObject({ status: "AT_RISK", featureFreeze: true });
    const burn = evaluateEnterpriseSloSnapshot(mutateWindow(completeSnapshot(), "PUBLIC_AVAILABILITY", "LONG", { badEvents: 200 }));
    expect(burn).toMatchObject({ status: "AT_RISK", featureFreeze: true });
  });

  it("keeps the canonical SHA stable across ordering and changes it on material drift", () => {
    const snapshot = completeSnapshot();
    const reordered = {
      ...snapshot,
      series: [...snapshot.series].reverse().map((series) => ({ ...series, windows: [...series.windows].reverse() })),
    };
    expect(calculateEnterpriseSloSnapshotSha256(snapshot)).toBe(calculateEnterpriseSloSnapshotSha256(reordered));
    expect(calculateEnterpriseSloSnapshotSha256(snapshot))
      .not.toBe(calculateEnterpriseSloSnapshotSha256(mutateWindow(snapshot, "PUBLIC_AVAILABILITY", "SHORT", { badEvents: 1 })));
  });

  it("rejects malformed provenance and bad-event counters", () => {
    expect(evaluateEnterpriseSloSnapshot(completeSnapshot({ sourceCommitSha: "not-a-commit" } as Partial<EnterpriseSloSnapshot>)))
      .toMatchObject({ status: "UNKNOWN", featureFreeze: true, reasonCodes: ["SLO_SCHEMA_INVALID"] });
    expect(evaluateEnterpriseSloSnapshot(mutateWindow(completeSnapshot(), "PUBLIC_AVAILABILITY", "SHORT", { badEvents: 100_001 })))
      .toMatchObject({ status: "UNKNOWN", reasonCodes: expect.arrayContaining(["SLO_BAD_EVENTS_EXCEED_TOTAL"]) });
  });

  it("does not treat the exact latency boundary as less than the contractual limit", () => {
    const shortBoundary = evaluateEnterpriseSloSnapshot(mutateWindow(
      completeSnapshot(), "REPLY_SYNC_LATENCY", "SHORT", { observedP95Ms: 300_000 },
    ));
    expect(shortBoundary).toMatchObject({ status: "AT_RISK", featureFreeze: true });
    const monthlyBoundary = evaluateEnterpriseSloSnapshot(mutateWindow(
      completeSnapshot(), "REPLY_SYNC_LATENCY", "MONTH_TO_DATE", { observedP95Ms: 300_000 },
    ));
    expect(monthlyBoundary).toMatchObject({ status: "EXHAUSTED", featureFreeze: true });
  });
});
