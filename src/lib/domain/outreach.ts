export const OUTREACH_TOUCH_DAYS = [0, 3, 7, 14, 28, 42, 60, 75] as const;

export type RuntimeReleaseGate = {
  externalSendAllowed: boolean;
  globalKillSwitch: boolean;
  manifestApproved: boolean;
  manifestHashMatches: boolean;
  suppressionSnapshotCurrent: boolean;
  mailboxHealthy: boolean;
  domainReadyDays: number;
  shadowCanaryDecision: "PASS" | "EXTEND" | "KILL" | null;
};

export type ReleaseGateResult = {
  decision: "SEND_ALLOWED" | "HOLD";
  reasons: string[];
};

export function evaluateReleaseGate(gate: RuntimeReleaseGate): ReleaseGateResult {
  const reasons: string[] = [];
  if (!gate.externalSendAllowed) reasons.push("EXTERNAL_SEND_DISABLED");
  if (gate.globalKillSwitch) reasons.push("GLOBAL_KILL_SWITCH_ACTIVE");
  if (!gate.manifestApproved) reasons.push("MANIFEST_NOT_APPROVED");
  if (!gate.manifestHashMatches) reasons.push("MANIFEST_HASH_MISMATCH");
  if (!gate.suppressionSnapshotCurrent) reasons.push("SUPPRESSION_NOT_CURRENT");
  if (!gate.mailboxHealthy) reasons.push("MAILBOX_NOT_HEALTHY");
  if (gate.domainReadyDays < 42) reasons.push("APOLLO_WARMUP_UNDER_42_DAYS");
  if (gate.shadowCanaryDecision !== "PASS") reasons.push("SHADOW_CANARY_NOT_PASS");
  return { decision: reasons.length === 0 ? "SEND_ALLOWED" : "HOLD", reasons };
}
