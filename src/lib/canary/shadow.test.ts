import { describe, expect, it } from "vitest";

import { runAcceleratedShadowCanary, verifyAcceleratedCanary } from "@/lib/canary/shadow";

describe("M5 accelerated shadow canary", () => {
  it("passes the deterministic local harness without pretending real time elapsed", () => {
    const result = runAcceleratedShadowCanary();
    expect(verifyAcceleratedCanary(result)).toEqual([]);
    expect(result.localHarnessDecision).toBe("PASS");
    expect(result.releaseDecision).toBe("EXTEND");
    expect(result.realElapsedDays).toBe(0);
    expect(result.externalSideEffects).toBe(0);
  });

  it("covers required failure and recovery scenarios", () => {
    const keys = runAcceleratedShadowCanary().days.flatMap((day) => day.scenarios.map((scenario) => scenario.key));
    expect(keys).toEqual(expect.arrayContaining([
      "SUPPRESSION_FAIL_CLOSED",
      "IDEMPOTENT_DUPLICATE",
      "REPLY_STOPS_SEQUENCE",
      "HARD_BOUNCE_EXACT_SUPPRESSION",
      "UNSUBSCRIBE_EXACT_SUPPRESSION",
      "PROVIDER_TIMEOUT_RETRY",
      "RETRY_TO_DEAD_LETTER",
      "ALERT_FAILURE_PRESERVES_LEAD",
      "GLOBAL_KILL_SWITCH_HOLD",
      "MANIFEST_HASH_MISMATCH_HOLD",
      "PARTIAL_RESTORE_RECONCILIATION",
      "UNKNOWN_GATE_FAILS_CLOSED",
      "LOAD_IDEMPOTENCY_1000",
    ]));
  });

  it("is byte deterministic across two complete runs", () => {
    expect(runAcceleratedShadowCanary()).toEqual(runAcceleratedShadowCanary());
  });
});

