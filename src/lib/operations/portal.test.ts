import { describe, expect, it } from "vitest";

import {
  buildControlCadenceRows,
  evaluateReplySync,
  getSyntheticOperationsPortal,
  isOpenIncident,
  isStrictQualifiedOpportunity,
  providerBlockersForHybridPlan,
  sumFirstPaymentsMxn,
} from "@/lib/operations/portal";

describe("provider blockers under the hybrid plan", () => {
  it("preserves every provider blocker without hiding drift", () => {
    expect(providerBlockersForHybridPlan([
      "OUTREACH_MAILBOX_COUNT_NOT_THREE",
      "OUTREACH_DOMAIN_COUNT_NOT_TWO",
      "APOLLO_ACCOUNT_NOT_CONFIGURED",
    ])).toEqual([
      "OUTREACH_MAILBOX_COUNT_NOT_THREE",
      "OUTREACH_DOMAIN_COUNT_NOT_TWO",
      "APOLLO_ACCOUNT_NOT_CONFIGURED",
    ]);
  });
});

describe("sumFirstPaymentsMxn", () => {
  it("sums only positive first payments and ignores unsafe values", () => {
    expect(sumFirstPaymentsMxn([
      { amount_mxn: "125000.50", is_first_payment: true },
      { amount_mxn: 25000, is_first_payment: true },
      { amount_mxn: 999999, is_first_payment: false },
      { amount_mxn: "not-a-number", is_first_payment: true },
      { amount_mxn: -1, is_first_payment: true },
    ])).toBe(150000.5);
  });
});

describe("isStrictQualifiedOpportunity", () => {
  const evidence = {
    economic_buyer: true,
    active_pain: true,
    business_impact: true,
    timing_under_90_days: true,
    value_mxn: 1_000_000,
    next_action: "Visita técnica",
    next_action_at: "2026-08-13T16:00:00.000Z",
  };

  it("counts only active stages at or above QUALIFIED", () => {
    expect(isStrictQualifiedOpportunity({ ...evidence, stage: "QUALIFIED" })).toBe(true);
    expect(isStrictQualifiedOpportunity({ ...evidence, stage: "DECISION" })).toBe(true);
    expect(isStrictQualifiedOpportunity({ ...evidence, stage: "PROSPECTING" })).toBe(false);
    expect(isStrictQualifiedOpportunity({ ...evidence, stage: "DISCOVERY_HELD" })).toBe(false);
    expect(isStrictQualifiedOpportunity({ ...evidence, stage: "CLOSED_WON" })).toBe(false);
    expect(isStrictQualifiedOpportunity({ ...evidence, stage: "CLOSED_LOST" })).toBe(false);
  });

  it("rejects an active stage with incomplete evidence", () => {
    expect(isStrictQualifiedOpportunity({ ...evidence, stage: "QUALIFIED", next_action: null })).toBe(false);
  });
});

describe("isOpenIncident", () => {
  it("excludes terminal incident states from open risk", () => {
    expect(isOpenIncident({ status: "OPEN" })).toBe(true);
    expect(isOpenIncident({ status: "CONTAINED" })).toBe(true);
    expect(isOpenIncident({ status: "RESOLVED" })).toBe(false);
    expect(isOpenIncident({ status: "REVIEWED" })).toBe(false);
  });
});

describe("evaluateReplySync", () => {
  const evaluatedAt = new Date("2026-08-12T16:00:00.000Z");

  it("is healthy only when every ready cursor is fresh and its watch is active", () => {
    expect(evaluateReplySync([{
      status: "READY",
      last_synced_at: "2026-08-12T15:58:00.000Z",
      watch_expires_at: "2026-08-13T16:00:00.000Z",
    }], evaluatedAt)).toBe("HEALTHY");
  });

  it("degrades stale, expired or malformed cursors instead of showing green", () => {
    expect(evaluateReplySync([{
      status: "READY",
      last_synced_at: "2026-08-12T15:40:00.000Z",
      watch_expires_at: "2026-08-13T16:00:00.000Z",
    }], evaluatedAt)).toBe("DEGRADED");
    expect(evaluateReplySync([{
      status: "READY",
      last_synced_at: "2026-08-12T15:58:00.000Z",
      watch_expires_at: "2026-08-12T15:59:59.000Z",
    }], evaluatedAt)).toBe("DEGRADED");
    expect(evaluateReplySync([{
      status: "READY",
      last_synced_at: null,
      watch_expires_at: null,
    }], evaluatedAt)).toBe("DEGRADED");
  });

  it("holds when no cursor exists or setup is incomplete", () => {
    expect(evaluateReplySync([], evaluatedAt)).toBe("HOLD");
    expect(evaluateReplySync([{
      status: "INITIALIZING",
      last_synced_at: null,
      watch_expires_at: null,
    }], evaluatedAt)).toBe("HOLD");
  });
});

describe("control cadence portal fallback", () => {
  it("renders all five synthetic cadences as UNKNOWN without invented facts", () => {
    const snapshot = getSyntheticOperationsPortal();
    const rows = buildControlCadenceRows(snapshot.health.cadence);

    expect(snapshot.health.externalSendAllowed).toBe(false);
    expect(snapshot.health.cadence.state).toBe("UNKNOWN");
    expect(rows).toHaveLength(5);
    expect(rows.every((item) => item.status === "UNKNOWN")).toBe(true);
    expect(rows.every((item) => item.values.responsable === "Sin responsable verificado")).toBe(true);
    expect(rows.every((item) => item.values.proxima === "Sin horario verificado")).toBe(true);
  });
});
