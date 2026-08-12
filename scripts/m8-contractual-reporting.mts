import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildContractualMonthlyReport, selectRecoveryAction } from "../src/lib/reporting/monthly.ts";

const repoArgument = process.argv.indexOf("--repo");
const repo = resolve(repoArgument >= 0 ? process.argv[repoArgument + 1] : ".");
const writeEvidence = process.argv.includes("--write-evidence");
const m7Evidence = JSON.parse(await readFile(resolve(repo, "docs/evidence/M7-controlled-scaling-verification.json"), "utf8"));
const migration = await readFile(resolve(repo, "supabase/migrations/202608120010_contractual_monthly_reporting.sql"), "utf8");

const operationDays = Array.from({ length: 31 }, (_, index) => ({
  observedOn: `2026-07-${String(index + 1).padStart(2, "0")}`,
  evidenceClass: "live" as const,
  status: "OPERATING" as const,
}));
const hypotheticalReport = buildContractualMonthlyReport({
  periodStart: "2026-07-01",
  periodEndExclusive: "2026-08-01",
  generatedAt: "2026-08-03T09:00:00-06:00",
  operationDays,
  counts: {
    deliveredMessages: 200,
    substantiveReplies: 24,
    positiveReplies: 12,
    emailStrictLeads: 6,
    prequoteStrictLeads: 2,
    heldMeetings: 5,
    qualifiedOpportunities: 3,
    deliveredProposals: 2,
    closedWon: 1,
    firstPaymentsMxn: 100_000,
    clientSlaBreaches: 0,
  },
});
const firstRecoveryAction = selectRecoveryAction({
  targetMet: hypotheticalReport.targetMet,
  denominatorsVerified: "UNKNOWN",
  deliverabilityVerified: "UNKNOWN",
  contactQualityVerified: "UNKNOWN",
  clientResponseSlaVerified: "UNKNOWN",
  bestSegmentIdentified: "UNKNOWN",
  activeExperiment: false,
});
const readyRecoveryAction = selectRecoveryAction({
  targetMet: hypotheticalReport.targetMet,
  denominatorsVerified: true,
  deliverabilityVerified: true,
  contactQualityVerified: true,
  clientResponseSlaVerified: true,
  bestSegmentIdentified: true,
  activeExperiment: false,
});

const checks = [
  { id: "M7_GLOBAL_GATE_EXTEND", pass: m7Evidence.global_gate === "EXTEND" },
  { id: "ZERO_REAL_DELIVERIES", pass: m7Evidence.valid_first_deliveries === 0 },
  { id: "ZERO_REAL_WAVES", pass: m7Evidence.real_waves_released === 0 },
  { id: "MONTHLY_REPORT_NOT_AVAILABLE", pass: m7Evidence.t0_status === "NOT_AVAILABLE" },
  { id: "FULL_CALENDAR_MONTH", pass: hypotheticalReport.operationalDays === 31 },
  { id: "CHANNEL_DENOMINATORS_SEPARATE", pass: hypotheticalReport.totalStrictLeads === 8 && hypotheticalReport.emailStrictLeadRatePerDelivered === 0.03 },
  { id: "TARGET_NOT_INVENTED", pass: hypotheticalReport.targetMet === false && hypotheticalReport.targetStrictLeads === 10 },
  { id: "RECOVERY_STARTS_WITH_DENOMINATORS", pass: firstRecoveryAction === "VERIFY_DENOMINATORS" },
  { id: "ONE_VARIABLE_ONLY_AFTER_DIAGNOSIS", pass: readyRecoveryAction === "READY_FOR_ONE_VARIABLE_EXPERIMENT" },
  { id: "DAILY_LIVE_TRUTH_PERSISTED", pass: migration.includes("campaign_operation_days") },
  { id: "BUSINESS_CALENDAR_EVIDENCE", pass: migration.includes("reporting_calendar_days") && migration.includes("MONTHLY_REPORT_BUSINESS_CALENDAR_INCOMPLETE") },
  { id: "COUNTED_ITEMS_PERSISTED", pass: migration.includes("contractual_report_items") },
  { id: "ISSUANCE_APPROVAL_REQUIRED", pass: migration.includes("MONTHLY_REPORT_APPROVAL_REQUIRED") },
  { id: "ONE_ACTIVE_EXPERIMENT", pass: migration.includes("recovery_one_active_experiment_per_campaign") },
  { id: "APPEND_ONLY_EVIDENCE", pass: migration.includes("MONTHLY_EVIDENCE_APPEND_ONLY") },
];
const failures = checks.filter((check) => !check.pass);
const report = {
  verification_status: failures.length === 0 ? "PASS" : "FAIL",
  global_gate: "EXTEND",
  evidence_class: "synthetic_demo",
  external_side_effects: 0,
  real_contractual_reports: 0,
  real_recovery_experiments: 0,
  contractual_month_status: "NOT_STARTED",
  checks_passed: checks.length - failures.length,
  checks_failed: failures.length,
  hypothetical_live_fixture: { report: hypotheticalReport, firstRecoveryAction, readyRecoveryAction },
  checks,
};

if (writeEvidence) {
  await writeFile(resolve(repo, "docs/evidence/M8-contractual-reporting-verification.json"), `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
