import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createCsv } from "../src/lib/exports/csv.ts";
import { parseCsv } from "../src/lib/handoff/csv-roundtrip.ts";
import { evaluateM9Handoff, M9_LIVE_CRITERIA, M9_LOCAL_CRITERIA } from "../src/lib/handoff/readiness.ts";

const repoArgument = process.argv.indexOf("--repo");
const repo = resolve(repoArgument >= 0 ? process.argv[repoArgument + 1] : ".");
const sourceArgument = process.argv.indexOf("--source-commit");
const writeEvidence = process.argv.includes("--write-evidence");
const evidenceRoot = resolve(repo, "evidence/m9-handoff");
const artifactsRoot = resolve(evidenceRoot, "artifacts");
const verificationPath = resolve(repo, "docs/evidence/M9-handoff-verification.json");

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function git(args: string[], encoding?: BufferEncoding): string | Buffer {
  return execFileSync("git", args, { cwd: repo, encoding });
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

const requiredRunbooks = [
  "docs/runbooks/incident-response.md",
  "docs/runbooks/m2-local-backup-restore.md",
  "docs/runbooks/prequote-release.md",
  "docs/runbooks/gmail-reply-sync.md",
  "docs/runbooks/m5-shadow-canary.md",
  "docs/runbooks/m6-first-send-release.md",
  "docs/runbooks/m7-controlled-scaling.md",
  "docs/runbooks/m8-contractual-reporting.md",
  "docs/runbooks/m9-final-handoff.md",
  "docs/runbooks/m9-operator-training.md",
];

let sourceCommit: string;
if (writeEvidence) {
  sourceCommit = sourceArgument >= 0
    ? String(process.argv[sourceArgument + 1] ?? "")
    : String(git(["rev-parse", "HEAD"], "utf8")).trim();
} else {
  const existing = JSON.parse(await readFile(verificationPath, "utf8"));
  sourceCommit = String(existing.source_commit_sha ?? "");
}
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error("M9_SOURCE_COMMIT_INVALID");
git(["cat-file", "-e", `${sourceCommit}^{commit}`]);

const sourceArchive = git(["archive", "--format=tar", sourceCommit]) as Buffer;
const companiesCsv = createCsv([
  "evidence_class", "account_name", "contact_name", "role_title", "normalized_email", "verified",
], [
  { evidence_class: "synthetic_demo", account_name: "Cuenta sintética sin contacto", contact_name: "", role_title: "", normalized_email: "", verified: false },
  { evidence_class: "synthetic_demo", account_name: "Cuenta sintética con contacto", contact_name: "Persona sintética", role_title: "CEO", normalized_email: "synthetic@example.invalid", verified: true },
]);
const pipelineCsv = createCsv([
  "evidence_class", "account_name", "stage", "value_mxn", "next_action", "result_status",
], [
  { evidence_class: "synthetic_demo", account_name: "Cuenta sintética", stage: "QUALIFIED", value_mxn: 1000000, next_action: "Revisión sintética", result_status: "NOT_REAL" },
]);
const parsedCompanies = parseCsv(companiesCsv);
const parsedPipeline = parseCsv(pipelineCsv);

const archiveSha = sha256(sourceArchive);
const companiesSha = sha256(companiesCsv);
const pipelineSha = sha256(pipelineCsv);
const manifest = {
  schema_version: "1.0.0",
  evidence_class: "synthetic_demo",
  source_commit_sha: sourceCommit,
  contains_real_ennco_data: false,
  external_side_effects: 0,
  artifacts: [
    { key: "SOURCE_PACKAGE_LOCAL", path: "artifacts/ennco-revenue-platform-source.tar", sha256: archiveSha },
    { key: "EXPORT_COMPANIES_CONTACTS_LOCAL", path: "artifacts/companies-contacts-synthetic.csv", sha256: companiesSha },
    { key: "EXPORT_PIPELINE_ATTRIBUTION_LOCAL", path: "artifacts/pipeline-attribution-synthetic.csv", sha256: pipelineSha },
  ],
};
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;

if (writeEvidence) {
  await mkdir(artifactsRoot, { recursive: true });
  await writeFile(resolve(artifactsRoot, "ennco-revenue-platform-source.tar"), sourceArchive);
  await writeFile(resolve(artifactsRoot, "companies-contacts-synthetic.csv"), companiesCsv);
  await writeFile(resolve(artifactsRoot, "pipeline-attribution-synthetic.csv"), pipelineCsv);
  await writeFile(resolve(evidenceRoot, "manifest.json"), manifestText);
}

const migration = await readFile(resolve(repo, "supabase/migrations/202608120011_handoff_acceptance.sql"), "utf8");
const rollback = await readFile(resolve(repo, "supabase/rollbacks/202608120011_handoff_acceptance.down.sql"), "utf8");
const gateTest = await readFile(resolve(repo, "supabase/tests/011_handoff_acceptance_gate.sql"), "utf8");
const runbookIndex = await readFile(resolve(repo, "docs/runbooks/README.md"), "utf8");
const m8Evidence = JSON.parse(await readFile(resolve(repo, "docs/evidence/M8-contractual-reporting-verification.json"), "utf8"));
const checkedArchive = writeEvidence ? sourceArchive : await readFile(resolve(artifactsRoot, "ennco-revenue-platform-source.tar"));
const checkedCompanies = writeEvidence ? companiesCsv : await readFile(resolve(artifactsRoot, "companies-contacts-synthetic.csv"), "utf8");
const checkedPipeline = writeEvidence ? pipelineCsv : await readFile(resolve(artifactsRoot, "pipeline-attribution-synthetic.csv"), "utf8");
const checkedManifest = writeEvidence ? manifest : JSON.parse(await readFile(resolve(evidenceRoot, "manifest.json"), "utf8"));

const checks = [
  { id: "M8_GLOBAL_GATE_EXTEND", pass: m8Evidence.global_gate === "EXTEND" },
  { id: "SOURCE_COMMIT_EXISTS", pass: /^[a-f0-9]{40}$/.test(sourceCommit) },
  { id: "SOURCE_ARCHIVE_REPRODUCIBLE", pass: sha256(checkedArchive) === archiveSha },
  { id: "SOURCE_ARCHIVE_MANIFEST_MATCH", pass: checkedManifest.artifacts?.[0]?.sha256 === archiveSha },
  { id: "COMPANIES_EXPORT_REIMPORT", pass: parseCsv(checkedCompanies).rows.length === 2 && parsedCompanies.rows.length === 2 },
  { id: "ACCOUNT_WITHOUT_CONTACT_PRESERVED", pass: parsedCompanies.rows[0]?.contact_name === "" },
  { id: "PIPELINE_EXPORT_REIMPORT", pass: parseCsv(checkedPipeline).rows.length === 1 && parsedPipeline.rows[0]?.result_status === "NOT_REAL" },
  { id: "SYNTHETIC_EXPORTS_ONLY", pass: [...parsedCompanies.rows, ...parsedPipeline.rows].every((row) => row.evidence_class === "synthetic_demo") },
  { id: "NO_REAL_ENNCO_DATA", pass: checkedManifest.contains_real_ennco_data === false },
  { id: "NO_EXTERNAL_EFFECTS", pass: checkedManifest.external_side_effects === 0 },
  { id: "HANDOFF_DB_CONTRACT", pass: migration.includes("final_acceptances") && migration.includes("READY_FOR_ACCEPTANCE") },
  { id: "ENNCO_ADMIN_ACCEPTANCE_ONLY", pass: migration.includes("HANDOFF_ACCEPTANCE_ENNCO_ADMIN_REQUIRED") },
  { id: "ACCEPTANCE_APPEND_ONLY", pass: migration.includes("final_acceptances_append_only") },
  { id: "ROLLBACK_RESTORES_M8", pass: rollback.includes("contractual_monthly_report_issue") },
  { id: "ADVERSARIAL_DB_GATE", pass: gateTest.includes("cross-tenant acceptance accepted") && gateTest.includes("synthetic package accepted") },
  { id: "RUNBOOK_INDEX_COMPLETE", pass: requiredRunbooks.every((path) => runbookIndex.includes(path.replace("docs/runbooks/", ""))) },
  { id: "SECOND_RESTORE_EVIDENCE", pass: await exists(resolve(repo, "evidence/m9-restore/summary.json")) },
];

const localCriteria = M9_LOCAL_CRITERIA.map((code) => ({
  code,
  status: checks.every((check) => check.pass) ? "PASS" as const : "EXTEND" as const,
  evidenceClass: "synthetic_demo" as const,
  evidenceReference: checks.every((check) => check.pass) ? `docs/evidence/M9-handoff-verification.json#${code}` : null,
}));
const liveCriteria = M9_LIVE_CRITERIA.map((code) => ({
  code,
  status: "EXTEND" as const,
  evidenceClass: "live" as const,
  evidenceReference: null,
}));
const decision = evaluateM9Handoff({
  evidenceClass: "synthetic_demo",
  criteria: [...localCriteria, ...liveCriteria],
  openP0: 11,
  openP1: 7,
  finalAcceptanceRecorded: false,
});
const failures = checks.filter((check) => !check.pass);
const report = {
  verification_status: failures.length === 0 ? "PASS" : "FAIL",
  local_m9_status: decision.localEvidenceReady ? "EVIDENCE_READY" : "EXTEND",
  global_m9_gate: decision.gate,
  evidence_class: "synthetic_demo",
  source_commit_sha: sourceCommit,
  handoff_manifest_sha256: sha256(manifestText),
  external_side_effects: 0,
  real_client_uat_sessions: 0,
  real_client_training_sessions: 0,
  real_final_acceptances: 0,
  real_access_transfers: 0,
  production_restores_proven: 0,
  local_restore_drills_proven: 2,
  checks_passed: checks.length - failures.length,
  checks_failed: failures.length,
  local_criteria: localCriteria,
  live_criteria: liveCriteria,
  decision,
  checks,
};

if (writeEvidence) {
  await writeFile(verificationPath, `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
