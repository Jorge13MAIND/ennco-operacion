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
const gateRenamePath = resolve(repo, "supabase/migrations/202609010039_gate_codes_client_independent.sql");
const gateCodesSourcePath = resolve(repo, "src/lib/release/first-send.ts");
const apolloAlignmentPath = resolve(repo, "supabase/migrations/202608140023_apollo_warmup_alignment.sql");

const [packetBuffer, domainBuffer, fixtureBuffer, manifestBuffer, sequenceBuffer, migrationBuffer, apolloAlignmentBuffer, gateRenameBuffer, gateCodesSourceBuffer] = await Promise.all([
  readFile(packetPath), readFile(domainPath), readFile(fixturePath), readFile(manifestPath), readFile(sequencePath), readFile(migrationPath), readFile(apolloAlignmentPath), readFile(gateRenamePath), readFile(gateCodesSourcePath),
]);
const packet = JSON.parse(packetBuffer.toString("utf8"));
const domainLedger = JSON.parse(domainBuffer.toString("utf8"));
const fixture = JSON.parse(fixtureBuffer.toString("utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
// Los códigos se LEEN del código fuente en vez de duplicarse aquí. Antes el
// script tenía su propia copia y nada comprobaba que coincidieran: cambiar una
// sin la otra pasaba desapercibido, como se comprobó inyectando el defecto el
// 1-sep-2026. Una sola fuente de verdad, y si no se puede leer, se falla.
const gateCodesSource = gateCodesSourceBuffer.toString("utf8");
const gateCodesMatch = /FIRST_SEND_GATE_CODES\s*=\s*\[([^\]]+)\]/.exec(gateCodesSource);
if (!gateCodesMatch) {
  process.stderr.write("FIRST_SEND_GATE_CODES no se pudo leer de src/lib/release/first-send.ts\n");
  process.exit(1);
}
const requiredGateCodes = [...gateCodesMatch[1].matchAll(/"([A-Z0-9_]+)"/g)].map((match) => match[1]);
const checks = [];
function check(id, condition, observed) {
  checks.push({ id, status: condition ? "PASS" : "FAIL", observed });
}

const actualGateCodes = packet.gates.map((gate) => gate.code);
const enumMatch = migrationBuffer.toString("utf8").match(/create type public\.first_send_gate_code as enum \(([\s\S]*?)\);/);
const alignmentSql = apolloAlignmentBuffer.toString("utf8");
const gateRenameSql = gateRenameBuffer.toString("utf8");
// El enum vivo es la migración base MÁS los renombres posteriores. Antes esto
// estaba clavado a un solo renombre conocido; ahora aplica en cadena todos los
// `rename value` que encuentre, así el siguiente renombre no rompe el gate.
const renameSql = [alignmentSql, gateRenameSql].join("\n");
const renameChain = [...renameSql.matchAll(/rename\s+value\s+'([A-Z0-9_]+)'\s+to\s+'([A-Z0-9_]+)'/gi)]
  .map((match) => [match[1], match[2]]);
const applyRenames = (code) => {
  let current = code;
  for (const [from, to] of renameChain) if (current === from) current = to;
  return current;
};
const migrationGateCodes = enumMatch
  ? [...enumMatch[1].matchAll(/'([A-Z0-9_]+)'/g)].map((match) => applyRenames(match[1]))
  : [];
check("PACKET_HOLD", packet.status === "HOLD" && packet.release_decision === "EXTEND", { status: packet.status, release_decision: packet.release_decision });
check("PACKET_SYNTHETIC", packet.evidence_class === "synthetic_demo", packet.evidence_class);
check("ZERO_REAL_RECIPIENTS", packet.recipient_count === 0 && packet.account_count === 0 && packet.recipients.length === 0, { recipients: packet.recipient_count, accounts: packet.account_count });
check("RUNTIME_FAIL_CLOSED", packet.runtime.external_send_allowed === false && packet.runtime.global_kill_switch === true && packet.runtime.mailbox_kill_switch === true && packet.runtime.external_side_effect_budget === 0, packet.runtime);
check("EXACT_GATE_COVERAGE", JSON.stringify([...actualGateCodes].sort()) === JSON.stringify([...requiredGateCodes].sort()), { expected: requiredGateCodes.length, actual: actualGateCodes.length });
check("MIGRATION_GATE_COVERAGE", JSON.stringify([...migrationGateCodes].sort()) === JSON.stringify([...requiredGateCodes].sort()), { expected: requiredGateCodes.length, actual: migrationGateCodes.length });
check("APOLLO_WARMUP_42_DAY_TRIGGER", alignmentSql.includes("interval '42 days'") && alignmentSql.includes("messages_apollo_warmup_42_days"), true);
check("NO_DUPLICATE_GATES", new Set(actualGateCodes).size === actualGateCodes.length, actualGateCodes.length);
check("VALID_GATE_STATUSES", packet.gates.every((gate) => ["PASS", "PASS_LOCAL", "UNKNOWN", "BLOCKED_EXTERNAL", "FAIL", "KILL"].includes(gate.status)), true);
check("GATE_EVIDENCE_SHAPE", packet.gates.every((gate) => gate.evidence_sha256 === null || /^[a-f0-9]{64}$/.test(gate.evidence_sha256)), true);
// Antes: ningún gate podía estar en PASS. Ahora: ninguno puede estarlo SIN
// evidencia, y los que dependen de un envío real siguen sin poder pasar,
// porque su prueba sólo existe después de mandar un correo de verdad.
const SEND_DEPENDENT_GATES = ["SEED_GMAIL_PASS", "SEED_WORKSPACE_PASS", "SEED_OUTLOOK_PASS", "SEED_YAHOO_PASS", "CANARY_LIVE_PASS", "MAILBOX_HEALTHY"];
const passWithoutEvidence = packet.gates.filter((gate) => gate.status === "PASS" && !/^[a-f0-9]{64}$/.test(gate.evidence_sha256 ?? ""));
check("NO_PASS_WITHOUT_EVIDENCE", passWithoutEvidence.length === 0, passWithoutEvidence.map((gate) => gate.code));
const sendGatesPassed = packet.gates.filter((gate) => SEND_DEPENDENT_GATES.includes(gate.code) && gate.status === "PASS");
check("NO_SEND_DEPENDENT_PASS_BEFORE_LIVE", sendGatesPassed.length === 0, sendGatesPassed.map((gate) => gate.code));
check("BLOCKERS_PRESENT", packet.gates.some((gate) => gate.status === "BLOCKED_EXTERNAL") && packet.gates.some((gate) => gate.status === "UNKNOWN"), true);
check("MANIFEST_HASH_MATCHES_LOCAL", packet.campaign_manifest_sha256 === sha256(manifestBuffer), { expected: packet.campaign_manifest_sha256, observed: sha256(manifestBuffer) });
check("SEQUENCE_HASH_MATCHES_LOCAL", packet.sequence_sha256 === sha256(sequenceBuffer), { expected: packet.sequence_sha256, observed: sha256(sequenceBuffer) });
check("SEND_WINDOW_FROZEN", packet.schedule.timezone === "America/Mexico_City" && packet.schedule.window_start === "09:30" && packet.schedule.window_end === "11:30" && packet.schedule.scheduled_for === null, packet.schedule);

check("FOUR_DOMAIN_CANDIDATES", domainLedger.domains.length === 4 && new Set(domainLedger.domains.map((domain) => domain.candidate)).size === 4, domainLedger.domains.map((domain) => domain.candidate));

// El candado original exigía que TODO siguiera en UNKNOWN, para impedir un
// falso verde antes de comprar nada. Cumplió su función: los dominios se
// compraron el 26-ago y el DNS se verificó, y entonces el propio candado
// impedía registrar la evidencia real. Ahora protege lo correcto: nadie puede
// afirmar propiedad ni un PASS de DNS sin evidencia con hash y ruta.
const claimsWithoutEvidence = domainLedger.domains.filter((domain) =>
  (domain.ownership !== "UNKNOWN_NOT_PURCHASED"
    || [domain.spf, domain.dkim, domain.dmarc, domain.tls, domain.forward_reverse_dns, domain.postmaster].some((value) => value === "PASS"))
  && !(typeof domain.evidence_sha256 === "string" && /^[a-f0-9]{64}$/.test(domain.evidence_sha256) && typeof domain.evidence_path === "string"));
check("DOMAIN_CLAIMS_CARRY_EVIDENCE", claimsWithoutEvidence.length === 0, claimsWithoutEvidence.map((domain) => domain.candidate));

// Los dos relojes son independientes y ninguno se declara satisfecho solo.
const clockErrors = domainLedger.domains.filter((domain) =>
  (domain.domain_age_satisfied === true && (domain.domain_age_days ?? 0) < (domainLedger.minimum_domain_age_days ?? 30))
  || ((domain.warmup_days ?? 0) > 0 && !domain.warmup_started_at));
check("WARMUP_AND_AGE_CLOCKS_COHERENT", clockErrors.length === 0, clockErrors.map((domain) => domain.candidate));

// Nadie puede declarar calentamiento cumplido sin haberlo arrancado.
const warmupClaimed = domainLedger.domains.filter((domain) => (domain.warmup_days ?? 0) >= (domainLedger.minimum_warmup_days ?? 42) && !domain.warmup_started_at);
check("NO_WARMUP_CLAIM_WITHOUT_START", warmupClaimed.length === 0, warmupClaimed.map((domain) => domain.candidate));
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
