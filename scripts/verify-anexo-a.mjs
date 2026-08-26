import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { annexASnapshotSha256 } from "./lib/anexo-a.mjs";

const repoIndex = process.argv.indexOf("--repo");
const repo = path.resolve(repoIndex >= 0 ? process.argv[repoIndex + 1] : ".");
const writeEvidence = process.argv.includes("--write-evidence");
const sourcePath = path.join(repo, "data/suppression/anexo-a-2026-08-13.json");
const source = JSON.parse(await readFile(sourcePath, "utf8"));

const failures = [];
const expectedNames = ["MPE PLASTIC", "POSCO MPPC", "TEJAS EL AGUILA"];
const expectedIdentities = new Map([
  ["POSCO MPPC", { legalName: "POSCO MPPC, S.A. DE C.V.", domains: ["poscomppc.com", "poscomppc.com.mx"] }],
  ["MPE PLASTIC", { legalName: "MATERIAS PLASTICAS Y ELASTOMEROS DE MEXICO, S.A. DE C.V.", domains: ["mpeplastics.com"] }],
  ["TEJAS EL AGUILA", { legalName: "LAPROBA EL AGUILA SA DE CV", domains: ["tejaselaguila.com", "tejaselaguila.mx", "tejaselaguila.net"] }],
]);
const entries = Array.isArray(source.entries) ? source.entries : [];
const names = entries.map((entry) => entry.normalized_name).sort();

if (source.annex_id !== "ENNCO-ANNEX-A-2026-08-13") failures.push("ANNEX_ID_INVALID");
if (source.scope_statement !== "ONLY_THESE_THREE_COMPANIES_AS_OF_CONFIRMATION") failures.push("SCOPE_NOT_EXACT");
if (source.external_send_authorized !== false) failures.push("EXTERNAL_SEND_MUST_REMAIN_FALSE");
if (source.status !== "IDENTITY_AND_DOMAIN_VERIFIED_ACCOUNT_BINDING_PENDING") failures.push("ANNEX_STATUS_INVALID");
if (entries.length !== 3) failures.push("ENTRY_COUNT_NOT_THREE");
if (new Set(names).size !== entries.length) failures.push("DUPLICATE_NORMALIZED_NAME");
if (JSON.stringify(names) !== JSON.stringify(expectedNames)) failures.push("NAME_SET_DRIFT");

for (const entry of entries) {
  const expected = expectedIdentities.get(entry.normalized_name);
  const domains = Array.isArray(entry.domains) ? entry.domains : [];
  const domainNames = domains.map((domain) => domain.domain).sort();
  const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
  if (entry.name_as_received !== entry.normalized_name) failures.push(`NAME_NORMALIZATION_REQUIRES_REVIEW_${entry.normalized_name}`);
  if (entry.suppression_state !== "HOLD_FAIL_CLOSED") failures.push(`ENTRY_NOT_HOLD_${entry.normalized_name}`);
  if (!expected || entry.legal_name !== expected.legalName) failures.push(`LEGAL_NAME_DRIFT_${entry.normalized_name}`);
  if (entry.identity_resolution !== "VERIFIED_PUBLIC_SOURCE") failures.push(`IDENTITY_NOT_VERIFIED_${entry.normalized_name}`);
  if (!aliases.includes(entry.normalized_name) || aliases.length < 2 || new Set(aliases).size !== aliases.length) failures.push(`ALIASES_INVALID_${entry.normalized_name}`);
  if (!expected || JSON.stringify(domainNames) !== JSON.stringify(expected.domains)) failures.push(`DOMAIN_SET_DRIFT_${entry.normalized_name}`);
  if (domains.some((domain) => !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/u.test(domain.domain))) failures.push(`DOMAIN_FORMAT_INVALID_${entry.normalized_name}`);
  if (domains.some((domain) => domain.domain !== domain.domain.toLowerCase() || domain.domain.startsWith("www."))) failures.push(`DOMAIN_NOT_CANONICAL_${entry.normalized_name}`);
  if (domains.some((domain) => domain.confidence !== "HIGH" || !String(domain.source_url ?? "").startsWith("https://"))) failures.push(`DOMAIN_EVIDENCE_INVALID_${entry.normalized_name}`);
  if (entry.account_id !== null || entry.account_binding_status !== "PENDING_LIVE_DATABASE") failures.push(`ACCOUNT_BINDING_MUST_REMAIN_PENDING_${entry.normalized_name}`);
}

if (source.reconciliation?.legal_entity_resolution !== "VERIFIED_PUBLIC_SOURCE") failures.push("LEGAL_ENTITY_RESOLUTION_NOT_VERIFIED");
if (source.reconciliation?.domain_resolution !== "VERIFIED_PUBLIC_SOURCE") failures.push("DOMAIN_RESOLUTION_NOT_VERIFIED");
if (source.reconciliation?.account_binding !== "PENDING_LIVE_DATABASE") failures.push("ACCOUNT_BINDING_NOT_PENDING");
if (source.reconciliation?.transactional_database_import !== "NOT_EXECUTED") failures.push("DATABASE_IMPORT_STATUS_INVALID");
if (source.reconciliation?.outreach_eligible_records !== 0) failures.push("OUTREACH_ELIGIBILITY_MUST_BE_ZERO");
if (source.reconciliation?.release_state !== "HOLD") failures.push("RELEASE_STATE_MUST_BE_HOLD");

const snapshotSha256 = annexASnapshotSha256(source);

const result = {
  status: failures.length === 0 ? "PASS" : "FAIL",
  annex_id: source.annex_id,
  entry_count: entries.length,
  alias_count: entries.reduce((total, entry) => total + entry.aliases.length, 0),
  domain_count: entries.reduce((total, entry) => total + entry.domains.length, 0),
  names,
  snapshot_sha256: snapshotSha256,
  identity_resolution: source.reconciliation?.legal_entity_resolution,
  domain_resolution: source.reconciliation?.domain_resolution,
  account_binding: source.reconciliation?.account_binding,
  transactional_database_import: source.reconciliation?.transactional_database_import,
  outreach_eligible_records: source.reconciliation?.outreach_eligible_records,
  release_state: source.reconciliation?.release_state,
  failures
};

if (writeEvidence) {
  await writeFile(path.join(repo, "docs/evidence/M0-anexo-a-reconciliation.json"), `${JSON.stringify(result, null, 2)}\n`);
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
