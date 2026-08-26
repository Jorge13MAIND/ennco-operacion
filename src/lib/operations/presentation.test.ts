import { describe, expect, it } from "vitest";

import { operationalLabel } from "@/lib/operations/presentation";

describe("operationalLabel", () => {
  it("translates internal evidence and blocking states for the interface", () => {
    expect(operationalLabel("synthetic_demo")).toBe("Demo sintético");
    expect(operationalLabel("BLOCKED_EXTERNAL")).toBe("Bloqueado por dependencia externa");
    expect(operationalLabel("UNKNOWN")).toBe("Sin evidencia");
  });

  it("keeps unknown identifiers readable without exposing underscore codes", () => {
    expect(operationalLabel("provider_read_pending")).toBe("Provider read pending");
    expect(operationalLabel(null)).toBe("Sin evidencia");
  });
});
