import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoIndex = process.argv.indexOf("--repo");
const repo = resolve(repoIndex >= 0 ? process.argv[repoIndex + 1] : ".");
const writeEvidence = process.argv.includes("--write-evidence");
const packetPath = resolve(repo, "data/release/first-send-readiness-v1.json");
const domainPath = resolve(repo, "data/release/domain-readiness-ledger-v1.json");
const fixturePath = resolve(repo, "data/release/fixtures/first-send-synthetic-v1.json");
const manifestPath = resolve(repo, "data/campaigns/campaign-manifest-draft-v1.json");
const sequencePath = resolve(repo, "data/campaigns/sequence-draft-v1.json");
const migrationPath = resolve(repo, "supabase/migrations/202608110008_first_send_release.sql");

const [packetBuffer, domainBuffer, fixtureBuffer, manifestBuffer, sequenceBuffer, migrationBuffer] = await Promise.all([
  readFile(packetPath), readFile(domainPath), readFile(fixturePath), readFile(manifestPath), readFile(sequencePath), readFile(migrationPath),
]);
const packet = JSON.parse(packetBuffer.toString("utf8"));
const domainLedger = JSON.parse(domainBuffer.toString("utf8"));
const fixture = JSON.parse(fixtureBuffer.toString("utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const requiredGateCodes = [
  "ANNEX_A_RECONCILED", "EXECUTED_CONTRACT_ARCHIVED", "START_CONDITION_EVIDENCE",
  "LEGAL_BASIS_APPROVED", "PRIVACY_NOTICE_APPROVED", "DOMAIN_AGE_35_DAYS", "SPF_PASS",
  "DKIM_PASS", "DMARC_PASS", "TLS_PASS", "FORWARD_REVERSE_DNS_PASS", "POSTMASTER_VERIFIED",
  "SEED_GMAIL_PASS", "SEED_WORKSPACE_PASS", "SEED_OUTLOOK_PASS", "SEED_YAHOO_PASS",
  "PILOT_EXACTLY_FIVE_ACCOUNTS", "CONTACTS_VERIFIED", "COPY_APPROVED_FRANCISCO",
  "TECHNICAL_APPROVED_PACO", "SUPPRESSION_RECONCILED_24H", "DRY_RUN_IDENTICAL",
  "REPLY_SYNC_PASS", "ALERTS_PASS", "CANARY_LIVE_PASS", "MANIFEST_HASH_MATCH",
  "EXPLICIT_SEND_APPROVAL_JORGE", "SEND_WINDOW_VALID", "MAILBOX_HEALTHY", "UNSUBSCRIBE_READY",
];
const checks = [];
function check(id, condition, observed) {
  checks.push({ id, status: condition ? "PASS" : "FAIL", observed });
}

const actualGateCodes = packet.gates.map((gate) => gate.code);
const enumMatch = migrationBuffer.toString("utf8").match(/create type public\.first_send_gate_code as enum \(([\s\S]*?)\);/);
const migrationGateCodes = enumMatch ? [...enumMatch[1].matchAll(/'([A-Z0-9_]+)'/g)].map((match) => match[1]) : [];
check("PACKET_HOLD", packet.status === "HOLD" && packet.release_decision === "EXTEND", { status: packet.status, release_decision: packet.release_decision });
check("PACKET_SYNTHETIC", packet.evidence_class === "synthetic_demo", packet.evidence_class);
check("ZERO_REAL_RECIPIENTS", packet.recipient_count === 0 && packet.account_count === 0 && packet.recipients.length === 0, { recipients: packet.recipient_count, accounts: packet.account_count });
check("RUNTIME_FAIL_CLOSED", packet.runtime.external_send_allowed === false && packet.runtime.global_kill_switch === true && packet.runtime.mailbox_kill_switch === true && packet.runtime.external_side_effect_budget === 0, packet.runtime);
check("EXACT_GATE_COVERAGE", JSON.stringify([...actualGateCodes].sort()) === JSON.stringify([...requiredGateCodes].sort()), { expected: requiredGateCodes.length, actual: actualGateCodes.length });
check("MIGRATION_GATE_COVERAGE", JSON.stringify([...migrationGateCodes].sort()) === JSON.stringify([...requiredGateCodes].sort()), { expected: requiredGateCodes.length, actual: migrationGateCodes.length });
check("NO_DUPLICATE_GATES", new Set(actualGateCodes).size === actualGateCodes.length, actualGateCodes.length);
check("VALID_GATE_STATUSES", packet.gates.every((gate) => ["PASS_LOCAL", "UNKNOWN", "BLOCKED_EXTERNAL", "FAIL", "KILL"].includes(gate.status)), true);
check("GATE_EVIDENCE_SHAPE", packet.gates.every((gate) => gate.evidence_sha256 === null || /^[a-f0-9]{64}$/.test(gate.evidence_sha256)), true);
check("NO_LIVE_PASS_EVIDENCE", packet.gates.every((gate) => gate.status !== "PASS"), packet.gates.filter((gate) => gate.status === "PASS"));
check("BLOCKERS_PRESENT", packet.gates.some((gate) => gate.status === "BLOCKED_EXTERNAL") && packet.gates.some((gate) => gate.status === "UNKNOWN"), true);
check("MANIFEST_HASH_MATCHES_LOCAL", packet.campaign_manifest_sha256 === sha256(manifestBuffer), { expected: packet.campaign_manifest_sha256, observed: sha256(manifestBuffer) });
check("SEQUENCE_HASH_MATCHES_LOCAL", packet.sequence_sha256 === sha256(sequenceBuffer), { expected: packet.sequence_sha256, observed: sha256(sequenceBuffer) });
check("SEND_WINDOW_FROZEN", packet.schedule.timezone === "America/Mexico_City" && packet.schedule.window_start === "09:30" && packet.schedule.window_end === "11:30" && packet.schedule.scheduled_for === null, packet.schedule);
check("DOMAIN_AVAILABILITY_NOT_INVENTED", domainLedger.availability_checked === false && domainLedger.purchase_authorized === false, { availability_checked: domainLedger.availability_checked, purchase_authorized: domainLedger.purchase_authorized });
check("FOUR_DOMAIN_CANDIDATES", domainLedger.domains.length === 4 && new Set(domainLedger.domains.map((domain) => domain.candidate)).size === 4, domainLedger.domains.map((domain) => domain.candidate));
check("NO_DOMAIN_OWNERSHIP_CLAIM", domainLedger.domains.every((domain) => domain.ownership === "UNKNOWN_NOT_PURCHASED" && domain.authenticated_days === 0), true);
check("NO_DNS_PASS_CLAIM", domainLedger.domains.every((domain) => [domain.spf, domain.dkim, domain.dmarc, domain.tls, domain.forward_reverse_dns, domain.postmaster].every((value) => value === "UNKNOWN")), true);
check("SYNTHETIC_FIXTURE_FIVE", fixture.evidence_class === "synthetic_demo" && fixture.external_send_allowed === false && fixture.recipients.length === 5, fixture.recipients.length);
check("SYNTHETIC_FIXTURE_INVALID_TLD", fixture.recipients.every((recipient) => recipient.email.endsWith(".invalid")), fixture.recipients.map((recipient) => recipient.email));
check("SYNTHETIC_FIXTURE_UNIQUE_ACCOUNTS", new Set(fixture.recipients.map((recipient) => recipient.account_id)).size === 5, true);
check("SYNTHETIC_FIXTURE_GROUNDED_FIELDS", fixture.recipients.every((recipient) => recipient.observed_signal && recipient.source_name && recipient.variant), true);

const failures = checks.filter((entry) => entry.status === "FAIL");
const result = {
  verification_status: failures.length === 0 ? "PASS" : "FAIL",
  release_decision: "EXTEND",
  evidence_class: "synthetic_demo",
  real_recipients: 0,
  external_side_effects: 0,
  checks_passed: checks.length - failures.length,
  checks_failed: failures.length,
  packet_sha256: sha256(packetBuffer),
  domain_ledger_sha256: sha256(domainBuffer),
  fixture_sha256: sha256(fixtureBuffer),
  checks,
};

if (writeEvidence) {
  await writeFile(resolve(repo, "docs/evidence/M6-first-send-readiness.json"), `${JSON.stringify(result, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
