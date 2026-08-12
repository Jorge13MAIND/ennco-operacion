import { describe, expect, it } from "vitest";

import {
  evaluateM9Handoff,
  M9_LIVE_CRITERIA,
  M9_LOCAL_CRITERIA,
  type M9Criterion,
} from "@/lib/handoff/readiness";

function criteria(
  localStatus: M9Criterion["status"] = "PASS",
  liveStatus: M9Criterion["status"] = "EXTEND",
): M9Criterion[] {
  return [
    ...M9_LOCAL_CRITERIA.map((code) => ({
      code,
      status: localStatus,
      evidenceClass: "synthetic_demo" as const,
      evidenceReference: localStatus === "PASS" ? `docs/evidence/${code}.json` : null,
    })),
    ...M9_LIVE_CRITERIA.map((code) => ({
      code,
      status: liveStatus,
      evidenceClass: "live" as const,
      evidenceReference: liveStatus === "PASS" ? `evidence/live/${code}.json` : null,
    })),
  ];
}

describe("evaluateM9Handoff", () => {
  it("separa evidencia local de aceptación real", () => {
    const result = evaluateM9Handoff({
      evidenceClass: "synthetic_demo",
      criteria: criteria(),
      openP0: 10,
      openP1: 4,
      finalAcceptanceRecorded: false,
    });
    expect(result.localEvidenceReady).toBe(true);
    expect(result.readyForClientAcceptance).toBe(false);
    expect(result.accepted).toBe(false);
    expect(result.gate).toBe("EXTEND");
  });

  it("un UNKNOWN nunca cuenta como verde", () => {
    const values = criteria();
    values[0] = { ...values[0]!, status: "UNKNOWN", evidenceReference: null };
    const result = evaluateM9Handoff({
      evidenceClass: "synthetic_demo",
      criteria: values,
      openP0: 0,
      openP1: 0,
      finalAcceptanceRecorded: false,
    });
    expect(result.localEvidenceReady).toBe(false);
    expect(result.missingLocal).toContain("SOURCE_PACKAGE_LOCAL");
  });

  it("bloquea aceptación cuando existe un P0 o P1", () => {
    const result = evaluateM9Handoff({
      evidenceClass: "live",
      criteria: criteria("PASS", "PASS"),
      openP0: 0,
      openP1: 1,
      finalAcceptanceRecorded: true,
    });
    expect(result.readyForClientAcceptance).toBe(false);
    expect(result.gate).toBe("EXTEND");
  });

  it("no permite que un paquete sintético se acepte aunque copie estados live", () => {
    const result = evaluateM9Handoff({
      evidenceClass: "synthetic_demo",
      criteria: criteria("PASS", "PASS"),
      openP0: 0,
      openP1: 0,
      finalAcceptanceRecorded: true,
    });
    expect(result.readyForClientAcceptance).toBe(false);
    expect(result.accepted).toBe(false);
  });

  it("deja listo para firma, pero no declara PASS sin aceptación", () => {
    const result = evaluateM9Handoff({
      evidenceClass: "live",
      criteria: criteria("PASS", "PASS"),
      openP0: 0,
      openP1: 0,
      finalAcceptanceRecorded: false,
    });
    expect(result.readyForClientAcceptance).toBe(true);
    expect(result.accepted).toBe(false);
    expect(result.gate).toBe("EXTEND");
  });

  it("declara PASS sólo con evidencia live, cero P0/P1 y aceptación", () => {
    const result = evaluateM9Handoff({
      evidenceClass: "live",
      criteria: criteria("PASS", "PASS"),
      openP0: 0,
      openP1: 0,
      finalAcceptanceRecorded: true,
    });
    expect(result.readyForClientAcceptance).toBe(true);
    expect(result.accepted).toBe(true);
    expect(result.gate).toBe("PASS");
  });

  it("eleva cualquier KILL aunque el resto esté completo", () => {
    const values = criteria("PASS", "PASS");
    values.at(-1)!.status = "KILL";
    const result = evaluateM9Handoff({
      evidenceClass: "live",
      criteria: values,
      openP0: 0,
      openP1: 0,
      finalAcceptanceRecorded: true,
    });
    expect(result.gate).toBe("KILL");
    expect(result.accepted).toBe(false);
  });

  it("rechaza criterios duplicados", () => {
    const values = criteria();
    expect(() => evaluateM9Handoff({
      evidenceClass: "synthetic_demo",
      criteria: [values[0]!, values[0]!],
      openP0: 0,
      openP1: 0,
      finalAcceptanceRecorded: false,
    })).toThrow("M9_DUPLICATE_CRITERION");
  });
});
