import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { calculateT0, evaluateScalingHealth, requiredDeliveredContacts } from "../src/lib/scaling/health.ts";

const repoArgument = process.argv.indexOf("--repo");
const repo = resolve(repoArgument >= 0 ? process.argv[repoArgument + 1] : ".");
const writeEvidence = process.argv.includes("--write-evidence");
const readiness = JSON.parse(await readFile(resolve(repo, "data/release/first-send-readiness-v1.json"), "utf8"));
const migration = await readFile(resolve(repo, "supabase/migrations/202608110009_controlled_scaling.sql"), "utf8");

const cleanLive = {
  evidenceClass: "live" as const,
  deliveredCount: 5,
  hardBounceCount: 0,
  spamComplaintCount: 0,
  unsubscribeCount: 0,
  duplicateDeliveryCount: 0,
  suppressionViolationCount: 0,
  unknownCount: 0,
  openP0: 0,
  openP1: 0,
  replySyncP95Seconds: 120,
  observationHours: 24,
  plannedNextVolume: 10,
};
const passHealth = evaluateScalingHealth(cleanLive);
const syntheticHealth = evaluateScalingHealth({ ...cleanLive, evidenceClass: "synthetic_demo" });
const killHealth = evaluateScalingHealth({ ...cleanLive, suppressionViolationCount: 1 });
const t0 = calculateT0({
  validFirstDeliveries: 100,
  substantiveReplies: 10,
  positiveReplies: 6,
  strictLeads: 4,
  heldMeetings: 3,
  qualifiedOpportunities: 2,
});

const checks = [
  { id: "M6_REMAINS_HOLD", pass: readiness.status === "HOLD" && readiness.release_decision === "EXTEND" },
  { id: "ZERO_REAL_RECIPIENTS", pass: readiness.recipient_count === 0 && readiness.account_count === 0 },
  { id: "RUNTIME_CLOSED", pass: readiness.runtime.external_send_allowed === false && readiness.runtime.global_kill_switch === true },
  { id: "LIVE_HEALTH_PASS", pass: passHealth.decision === "PASS" && passHealth.nextMaximumVolume === 10 },
  { id: "SYNTHETIC_NEVER_PASS", pass: syntheticHealth.decision === "EXTEND" },
  { id: "SUPPRESSION_VIOLATION_KILLS", pass: killHealth.decision === "KILL" },
  { id: "WAVE_CAP_25", pass: migration.includes("planned_recipient_count between 1 and 25") },
  { id: "OBSERVATION_MINIMUM_24H", pass: migration.includes("interval '24 hours'") },
  { id: "REPLY_SYNC_MAX_300S", pass: migration.includes("reply_sync_p95_seconds > 300") },
  { id: "RELEASE_SOURCE_UNIQUE", pass: migration.includes("first_send_one_batch_per_enrollment") && migration.includes("ENROLLMENT_RELEASE_SOURCE_OVERLAP") },
  { id: "T0_EXACT_DENOMINATOR", pass: t0.validFirstDeliveries === 100 && t0.strictLeadRate === 0.04 },
  { id: "T0_FORECAST_DERIVED", pass: requiredDeliveredContacts(10, t0.strictLeadRate) === 250 },
  { id: "ZERO_RATE_NO_FORECAST", pass: requiredDeliveredContacts(10, 0) === null },
];
const failed = checks.filter((check) => !check.pass);
const report = {
  verification_status: failed.length === 0 ? "PASS" : "FAIL",
  global_gate: "EXTEND",
  evidence_class: "synthetic_demo",
  external_side_effects: 0,
  real_waves_released: 0,
  valid_first_deliveries: 0,
  t0_status: "NOT_AVAILABLE",
  checks_passed: checks.length - failed.length,
  checks_failed: failed.length,
  scenarios: { passHealth, syntheticHealth, killHealth, t0 },
  checks,
};

if (writeEvidence) {
  await writeFile(resolve(repo, "docs/evidence/M7-controlled-scaling-verification.json"), `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failed.length > 0) process.exitCode = 1;
