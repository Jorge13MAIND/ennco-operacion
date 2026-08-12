import { describe, expect, it } from "vitest";

import {
  CONTROL_CADENCE_CODES,
  createUnknownControlCadenceHealth,
  isControlCadenceReleaseAllowed,
  isExternalSendAllowedWithCadence,
  parseControlCadenceReadModel,
} from "@/lib/operations/cadence";

const organizationId = "11111111-1111-4111-8111-111111111111";
const policyVersionId = "22222222-2222-4222-8222-222222222222";
const evaluatedAt = "2026-08-12T16:00:00.000Z";

function healthyResult() {
  return {
    status: "READ_ONLY",
    state: "HEALTHY",
    reason_code: null,
    organization_id: organizationId,
    evaluated_at: evaluatedAt,
    policy_version_id: policyVersionId,
    policy_version: 1,
    timezone: "America/Mexico_City",
    cadence_count: 5,
    required_cadence_count: 5,
    open_occurrences: 0,
    breached_occurrences: 0,
    open_p0: 0,
    open_p1: 0,
    last_reconciled_at: "2026-08-12T15:59:00.000Z",
    heartbeat_state: "FRESH",
    outbound_release: "ALLOWED",
    cadences: CONTROL_CADENCE_CODES.map((code) => ({
      code,
      config_state: "VERIFIED",
      owner_user_id: "33333333-3333-4333-8333-333333333333",
      next_occurrence_at: "2026-08-13T15:00:00.000Z",
      due_at: "2026-08-13T16:00:00.000Z",
      execution_status: "COMPLETED",
      compliance_status: "MET",
      evidence_state: "COMPLETE",
      attendance_state: code === "ENNCO_TECKEL_WEEKLY_MEETING" ? "COMPLETE" : "NOT_REQUIRED",
      delivery_state: "NOT_REQUIRED",
      breach_severity: null,
      next_action: "NONE",
    })),
  };
}

function parse(rpcData: unknown) {
  return parseControlCadenceReadModel({ rpcAvailable: true, rpcData, expectedOrganizationId: organizationId, evaluatedAt });
}

describe("control cadence portal contract", () => {
  it("accepts only the exact healthy five-cadence response", () => {
    const result = parse(healthyResult());
    expect(result.state).toBe("HEALTHY");
    expect(isControlCadenceReleaseAllowed(result)).toBe(true);
  });

  it("fails closed on malformed or truncated responses", () => {
    expect(parse({ ...healthyResult(), unexpected: true }).reason_code).toBe("CONTROL_CADENCE_SCHEMA_INVALID");
    expect(parse({ ...healthyResult(), cadences: healthyResult().cadences.slice(0, 4) }).reason_code)
      .toBe("CONTROL_CADENCE_POLICY_INCOMPLETE");
  });

  it("fails closed on stale heartbeat even when the response claims healthy", () => {
    const result = parse({
      ...healthyResult(),
      heartbeat_state: "STALE",
      outbound_release: "BLOCKED",
    });
    expect(result.state).toBe("UNKNOWN");
    expect(result.reason_code).toBe("RECONCILER_HEARTBEAT_STALE");
    expect(isControlCadenceReleaseAllowed(result)).toBe(false);
  });

  it("fails closed on incomplete policy and duplicate cadence codes", () => {
    const incompleteBase = healthyResult();
    const incomplete = {
      ...incompleteBase,
      cadences: incompleteBase.cadences.map((item, index) => index === 0 ? { ...item, config_state: "UNKNOWN" } : item),
    };
    expect(parse(incomplete).reason_code).toBe("CONTROL_CADENCE_POLICY_INCOMPLETE");

    const duplicateBase = healthyResult();
    const duplicate = {
      ...duplicateBase,
      cadences: duplicateBase.cadences.map((item, index) => index === 4 ? { ...item, code: "CONTROL_ROOM_DAILY_UPDATE" } : item),
    };
    expect(parse(duplicate).reason_code).toBe("CONTROL_CADENCE_POLICY_INCOMPLETE");
  });

  it("fails closed on organization identifier drift", () => {
    const result = parse({ ...healthyResult(), organization_id: "44444444-4444-4444-8444-444444444444" });
    expect(result.state).toBe("UNKNOWN");
    expect(result.reason_code).toBe("CONTROL_CADENCE_ORGANIZATION_DRIFT");
  });

  it("never treats UNKNOWN as green or outbound-authorized", () => {
    const unknown = createUnknownControlCadenceHealth({ reasonCode: "TEST_UNKNOWN", evaluatedAt, organizationId });
    expect(unknown.cadences).toHaveLength(5);
    expect(unknown.cadences.every((item) => item.execution_status === "UNKNOWN")).toBe(true);
    expect(unknown.outbound_release).toBe("BLOCKED");
    expect(isControlCadenceReleaseAllowed(unknown)).toBe(false);
    expect(isExternalSendAllowedWithCadence(true, unknown)).toBe(false);
  });
});
