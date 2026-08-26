export const FIRST_SEND_GATE_CODES = [
  "ANNEX_A_RECONCILED",
  "EXECUTED_CONTRACT_ARCHIVED",
  "START_CONDITION_EVIDENCE",
  "LEGAL_BASIS_APPROVED",
  "PRIVACY_NOTICE_APPROVED",
  "APOLLO_WARMUP_42_DAYS",
  "SPF_PASS",
  "DKIM_PASS",
  "DMARC_PASS",
  "TLS_PASS",
  "FORWARD_REVERSE_DNS_PASS",
  "POSTMASTER_VERIFIED",
  "SEED_GMAIL_PASS",
  "SEED_WORKSPACE_PASS",
  "SEED_OUTLOOK_PASS",
  "SEED_YAHOO_PASS",
  "PILOT_EXACTLY_FIVE_ACCOUNTS",
  "CONTACTS_VERIFIED",
  "COPY_APPROVED_FRANCISCO",
  "TECHNICAL_APPROVED_PACO",
  "SUPPRESSION_RECONCILED_24H",
  "DRY_RUN_IDENTICAL",
  "REPLY_SYNC_PASS",
  "ALERTS_PASS",
  "CANARY_LIVE_PASS",
  "MANIFEST_HASH_MATCH",
  "EXPLICIT_SEND_APPROVAL_JORGE",
  "SEND_WINDOW_VALID",
  "MAILBOX_HEALTHY",
  "UNSUBSCRIBE_READY",
] as const;

export type FirstSendGateCode = (typeof FIRST_SEND_GATE_CODES)[number];
export type FirstSendGateStatus = "PASS" | "PASS_LOCAL" | "UNKNOWN" | "BLOCKED_EXTERNAL" | "FAIL" | "KILL";

export type FirstSendReadinessInput = {
  evidenceClass: "synthetic_demo" | "live";
  recipientCount: number;
  accountCount: number;
  manifestStatus: "HOLD" | "APPROVED";
  externalSendAllowed: boolean;
  globalKillSwitch: boolean;
  mailboxKillSwitch: boolean;
  externalSideEffectBudget: number;
  gates: Array<{ code: FirstSendGateCode; status: FirstSendGateStatus }>;
};

export type FirstSendReadinessResult = {
  decision: "PASS" | "EXTEND" | "KILL";
  reasons: string[];
};

export function evaluateFirstSendReadiness(input: FirstSendReadinessInput): FirstSendReadinessResult {
  const reasons: string[] = [];
  const codes = input.gates.map((gate) => gate.code);
  const uniqueCodes = new Set(codes);
  const missing = FIRST_SEND_GATE_CODES.filter((code) => !uniqueCodes.has(code));
  const unexpected = codes.filter((code) => !FIRST_SEND_GATE_CODES.includes(code));

  if (uniqueCodes.size !== codes.length) reasons.push("DUPLICATE_GATE_CODE");
  if (missing.length > 0) reasons.push(...missing.map((code) => `MISSING_GATE:${code}`));
  if (unexpected.length > 0) reasons.push(...unexpected.map((code) => `UNEXPECTED_GATE:${code}`));
  if (input.recipientCount > 5 || input.accountCount > 5) return { decision: "KILL", reasons: ["PILOT_LIMIT_EXCEEDED"] };
  if (input.externalSideEffectBudget > 0) return { decision: "KILL", reasons: ["EXTERNAL_SIDE_EFFECT_BUDGET_NOT_ZERO"] };
  if (input.gates.some((gate) => gate.status === "KILL")) {
    return { decision: "KILL", reasons: input.gates.filter((gate) => gate.status === "KILL").map((gate) => `KILL_GATE:${gate.code}`) };
  }

  if (input.evidenceClass !== "live") reasons.push("EVIDENCE_NOT_LIVE");
  if (input.recipientCount !== 5 || input.accountCount !== 5) reasons.push("PILOT_NOT_EXACTLY_FIVE_ACCOUNTS");
  if (input.manifestStatus !== "APPROVED") reasons.push("MANIFEST_NOT_APPROVED");
  if (!input.externalSendAllowed) reasons.push("EXTERNAL_SEND_DISABLED");
  if (input.globalKillSwitch) reasons.push("GLOBAL_KILL_SWITCH_ACTIVE");
  if (input.mailboxKillSwitch) reasons.push("MAILBOX_KILL_SWITCH_ACTIVE");
  for (const gate of input.gates) {
    if (gate.status !== "PASS") reasons.push(`GATE_NOT_PASS:${gate.code}:${gate.status}`);
  }

  return { decision: reasons.length === 0 ? "PASS" : "EXTEND", reasons };
}
