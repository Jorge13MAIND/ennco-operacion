import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseRiskRegister, validateRtm } from "../../../scripts/lib/governance.mjs";

const repo = process.cwd();
const rtm = fs.readFileSync(path.join(repo, "docs/01-requirements-traceability.csv"), "utf8");
const risks = fs.readFileSync(path.join(repo, "docs/03-risk-register.md"), "utf8");

describe("governance validators", () => {
  it("validates the canonical RTM and exposes enterprise gaps without treating them as PASS", () => {
    const result = validateRtm({ text: rtm, repo });

    expect(result.status).toBe("PASS");
    expect(result.checklist_coverage).toBe("47/47");
    expect(result.enterprise_requirements).toHaveLength(9);
    expect(result.enterprise_gap_count).toBeGreaterThan(0);
    expect(result.failures).toEqual([]);
  });

  it("rejects EVIDENCE_READY backed by a non-local locator", () => {
    const changed = rtm.replace(
      "/Users/Jorge/dev/ennco-revenue-platform/supabase/tests/005_conversion_analytics_gate.sql",
      "/tmp/ennco-non-local-evidence.sql",
    );
    const result = validateRtm({ text: changed, repo });

    expect(result.failures).toContain("EVIDENCE_NOT_REPO_LOCAL_REQ-002");
  });

  it("rejects a missing mandatory enterprise requirement", () => {
    const changed = rtm.replace('"ENT-001"', '"ENT-X01"');
    const result = validateRtm({ text: changed, repo });

    expect(result.failures).toContain("MISSING_ENTERPRISE_REQUIREMENT_ENT-001");
  });

  it("derives all active P0 and P1 risks, including MITIGATING", () => {
    const result = parseRiskRegister(risks);

    expect(result.status).toBe("PASS");
    expect(result.open_counts.P0).toBe(result.open_records.filter((record) => record.priority === "P0").length);
    expect(result.open_counts.P1).toBe(result.open_records.filter((record) => record.priority === "P1").length);
    expect(result.open_counts.P0).toBeGreaterThan(0);
    expect(result.open_counts.P1).toBeGreaterThan(0);
    expect(result.open_records.some((record) => record.id === "R-010" && record.status === "MITIGATING")).toBe(true);
  });

  it("rejects an unknown risk status", () => {
    const changed = risks.replace(
      "| R-001 | P0 | Anexo A incompleto o tardío | No existe archivo aceptado y hasheado | Bloquear cualquier envío y desplazar reloj | Revenue Operations | OPEN |",
      "| R-001 | P0 | Anexo A incompleto o tardío | No existe archivo aceptado y hasheado | Bloquear cualquier envío y desplazar reloj | Revenue Operations | INVENTED |",
    );
    const result = parseRiskRegister(changed);

    expect(result.failures).toContain("RISK_STATUS_INVALID_R-001");
  });
});
