import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { annexASnapshotSha256 } from "./lib/anexo-a.mjs";

const repoArgument = process.argv.indexOf("--repo");
const repo = resolve(repoArgument >= 0 ? process.argv[repoArgument + 1] : ".");
const writeEvidence = process.argv.includes("--write-evidence");
const sequencePath = resolve(repo, "data/campaigns/sequence-draft-v1.json");
const manifestPath = resolve(repo, "data/campaigns/campaign-manifest-draft-v1.json");
const playbookPath = resolve(repo, "data/campaigns/response-playbook-v1.json");
const referenceCardsPath = resolve(repo, "data/content/anonymous-reference-cards-v1.json");
const annexAPath = resolve(repo, "data/suppression/anexo-a-2026-08-13.json");

const sequenceBuffer = await readFile(sequencePath);
const manifestBuffer = await readFile(manifestPath);
const playbookBuffer = await readFile(playbookPath);
const referenceCardsBuffer = await readFile(referenceCardsPath);
const annexABuffer = await readFile(annexAPath);
const sequence = JSON.parse(sequenceBuffer.toString("utf8"));
const manifest = JSON.parse(manifestBuffer.toString("utf8"));
const playbook = JSON.parse(playbookBuffer.toString("utf8"));
const referenceCards = JSON.parse(referenceCardsBuffer.toString("utf8"));
const annexA = JSON.parse(annexABuffer.toString("utf8"));
const sequenceSha256 = createHash("sha256").update(sequenceBuffer).digest("hex");
const manifestSha256 = createHash("sha256").update(manifestBuffer).digest("hex");
const annexASnapshot = annexASnapshotSha256(annexA);
const checks = [];

function check(id, condition, observed) {
  checks.push({ id, status: condition ? "PASS" : "FAIL", observed });
}

const expectedDays = [0, 3, 7, 14, 28, 42, 60, 75];
const expectedVariants = ["executive", "maintenance", "procurement"];
const bodies = sequence.touches.flatMap((touch) => Object.entries(touch.variants).map(([variant, value]) => ({
  touch: touch.touch_number,
  variant,
  subject: value.subject,
  body: value.body,
})));

check("SEQUENCE_DRAFT_ONLY", sequence.status === "DRAFT_REVIEW_REQUIRED", sequence.status);
check("SYNTHETIC_EVIDENCE_ONLY", sequence.evidence_class === "synthetic_demo", sequence.evidence_class);
check("SENDER_FROZEN", sequence.sender.name === "Francisco Cuellar" && sequence.sender.title === "CEO", sequence.sender);
check("EIGHT_TOUCHES", sequence.touches.length === 8, sequence.touches.length);
check("CADENCE_MATCHES", JSON.stringify(sequence.cadence_days) === JSON.stringify(expectedDays), sequence.cadence_days);
check("TOUCH_OFFSETS_MATCH", JSON.stringify(sequence.touches.map((touch) => touch.day_offset)) === JSON.stringify(expectedDays), sequence.touches.map((touch) => touch.day_offset));
check("THREE_ROLE_VARIANTS", sequence.touches.every((touch) => JSON.stringify(Object.keys(touch.variants).sort()) === JSON.stringify(expectedVariants)), bodies.length);
check("COPY_UNDER_100_WORDS", bodies.every((entry) => entry.body.trim().split(/\s+/).length <= 100), Math.max(...bodies.map((entry) => entry.body.trim().split(/\s+/).length)));
check("SUBJECTS_UNDER_70_CHARS", bodies.every((entry) => entry.subject.length <= 70), Math.max(...bodies.map((entry) => entry.subject.length)));
check("ONE_CTA_MAX", bodies.every((entry) => (entry.body.match(/\?/g) ?? []).length === 1), bodies.filter((entry) => (entry.body.match(/\?/g) ?? []).length !== 1).map((entry) => `${entry.touch}:${entry.variant}`));
check("FRANCISCO_SIGNATURE", bodies.every((entry) => entry.body.includes("Francisco")), true);
check("INITIAL_SIGNAL_GROUNDED", Object.values(sequence.touches[0].variants).every((variant) => variant.body.includes("{{observed_signal}}") && variant.body.includes("{{source_name}}")), true);
check("NO_UNICODE_DASHES", bodies.every((entry) => !/[\u2014\u2013]/.test(`${entry.subject}${entry.body}`)), true);
check("NO_PROHIBITED_COMMITMENTS", bodies.every((entry) => !/(te garantizo|garantizamos|descuento de|precio final|queda instalado el|ahorro de \d|deducci[oó]n de \d)/i.test(entry.body)), true);
check("EXPLICIT_STOP_RULES", ["HUMAN_REPLY", "HARD_BOUNCE", "UNSUBSCRIBE", "DNC", "SUPPRESSION_MATCH", "GLOBAL_KILL_SWITCH"].every((rule) => sequence.stop_rules.includes(rule)), sequence.stop_rules);
check("SEQUENCE_HASH_MATCHES_MANIFEST", manifest.sequence.sha256 === sequenceSha256, { expected: manifest.sequence.sha256, observed: sequenceSha256 });
check("MANIFEST_IS_HOLD", manifest.status === "HOLD" && manifest.external_send_authorized === false, { status: manifest.status, external_send_authorized: manifest.external_send_authorized });
check("ZERO_RECIPIENTS", manifest.recipient_count === 0 && manifest.recipients.length === 0, manifest.recipient_count);
check("FAIL_CLOSED_RUNTIME", manifest.runtime.global_kill_switch === true && manifest.runtime.mailbox_kill_switch === true && manifest.runtime.external_send_allowed === false && manifest.runtime.dry_run_only === true, manifest.runtime);
check("ANNEX_A_SNAPSHOT_MATCHES", manifest.suppression.annex_a_present === true && manifest.suppression.snapshot_sha256 === annexASnapshot, { expected: annexASnapshot, observed: manifest.suppression.snapshot_sha256 });
check("ANNEX_A_ACCOUNT_BINDING_BLOCKS_RELEASE", manifest.approvals.suppression_reconciled === false && manifest.release_blockers.includes("ANNEX_A_DATABASE_BINDING_PENDING"), { suppression_reconciled: manifest.approvals.suppression_reconciled, release_blockers: manifest.release_blockers });
check("ONLY_TECHNICAL_APPROVAL_PRESENT", manifest.approvals.technical_paco === true && Object.entries(manifest.approvals).filter(([key]) => key !== "technical_paco").every(([, value]) => value === false), manifest.approvals);
check("UNKNOWN_NEVER_PASS", manifest.canary.unknown_is_pass === false && manifest.canary.release_decision === "EXTEND", manifest.canary);
check("APOLLO_WARMUP_MINIMUM_42_DAYS", manifest.canary.required_real_consecutive_days === 42, manifest.canary.required_real_consecutive_days);
check("NO_OPEN_PIXEL", manifest.tracking.open_pixel === false, manifest.tracking);
check("EXTERNAL_SIDE_EFFECT_BUDGET_ZERO", manifest.runtime.max_external_side_effects === 0, manifest.runtime.max_external_side_effects);
check("RESPONSE_PLAYBOOK_DRAFT_ONLY", playbook.status === "DRAFT_REVIEW_REQUIRED" && playbook.responses.length === 8, { status: playbook.status, responses: playbook.responses.length });
check("RESPONSE_PLAYBOOK_ONE_CTA_MAX", playbook.responses.every((response) => (response.body.match(/\?/g) ?? []).length <= 1), true);
check("RESPONSE_PLAYBOOK_NO_COMMITMENTS", playbook.responses.every((response) => !/(te garantizo|descuento de|precio final es|queda instalado el|ahorro de \d)/i.test(response.body)), true);
check("ANONYMOUS_REFERENCES_NOT_CASE_STUDIES", referenceCards.status === "INTERNAL_REFERENCE_NOT_CASE_STUDY" && referenceCards.publish_authorized === false && referenceCards.cards.every((card) => card.outcome_verified === false), { status: referenceCards.status, publish_authorized: referenceCards.publish_authorized });
check("REFERENCE_SOURCE_IDS_EXIST", referenceCards.cards.every((card) => typeof card.source_record_id === "string" && card.source_record_id.length > 8), referenceCards.cards.map((card) => card.source_record_id));

const failures = checks.filter((item) => item.status === "FAIL");
const result = {
  status: failures.length === 0 ? "PASS" : "FAIL",
  evidence_class: "synthetic_demo",
  release_decision: "EXTEND",
  sequence_sha256: sequenceSha256,
  manifest_sha256: manifestSha256,
  check_count: checks.length,
  pass_count: checks.length - failures.length,
  failure_count: failures.length,
  checks,
};

if (writeEvidence) {
  await writeFile(resolve(repo, "docs/evidence/M5-campaign-verification-current.json"), `${JSON.stringify(result, null, 2)}\n`);
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
