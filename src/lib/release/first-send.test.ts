import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { evaluateFirstSendReadiness, FIRST_SEND_GATE_CODES } from "@/lib/release/first-send";

const packet = JSON.parse(
  readFileSync(resolve(process.cwd(), "data/release/first-send-readiness-v1.json"), "utf8"),
);

describe("first send readiness", () => {
  it("keeps the current packet on EXTEND", () => {
    const result = evaluateFirstSendReadiness({
      evidenceClass: packet.evidence_class,
      recipientCount: packet.recipient_count,
      accountCount: packet.account_count,
      manifestStatus: packet.status,
      externalSendAllowed: packet.runtime.external_send_allowed,
      globalKillSwitch: packet.runtime.global_kill_switch,
      mailboxKillSwitch: packet.runtime.mailbox_kill_switch,
      externalSideEffectBudget: packet.runtime.external_side_effect_budget,
      gates: packet.gates,
    });
    expect(result.decision).toBe("EXTEND");
    expect(result.reasons).toContain("EVIDENCE_NOT_LIVE");
    expect(result.reasons).toContain("PILOT_NOT_EXACTLY_FIVE_ACCOUNTS");
  });

  it("passes only a complete hypothetical live packet", () => {
    const result = evaluateFirstSendReadiness({
      evidenceClass: "live",
      recipientCount: 5,
      accountCount: 5,
      manifestStatus: "APPROVED",
      externalSendAllowed: true,
      globalKillSwitch: false,
      mailboxKillSwitch: false,
      externalSideEffectBudget: 0,
      gates: FIRST_SEND_GATE_CODES.map((code) => ({ code, status: "PASS" })),
    });
    expect(result).toEqual({ decision: "PASS", reasons: [] });
  });

  it("kills a batch that exceeds the five-account pilot", () => {
    const result = evaluateFirstSendReadiness({
      evidenceClass: "live",
      recipientCount: 6,
      accountCount: 6,
      manifestStatus: "APPROVED",
      externalSendAllowed: true,
      globalKillSwitch: false,
      mailboxKillSwitch: false,
      externalSideEffectBudget: 0,
      gates: FIRST_SEND_GATE_CODES.map((code) => ({ code, status: "PASS" })),
    });
    expect(result).toEqual({ decision: "KILL", reasons: ["PILOT_LIMIT_EXCEEDED"] });
  });

  it("never treats PASS_LOCAL as a production PASS", () => {
    const result = evaluateFirstSendReadiness({
      evidenceClass: "live",
      recipientCount: 5,
      accountCount: 5,
      manifestStatus: "APPROVED",
      externalSendAllowed: true,
      globalKillSwitch: false,
      mailboxKillSwitch: false,
      externalSideEffectBudget: 0,
      gates: FIRST_SEND_GATE_CODES.map((code, index) => ({ code, status: index === 0 ? "PASS_LOCAL" : "PASS" })),
    });
    expect(result.decision).toBe("EXTEND");
  });
});

