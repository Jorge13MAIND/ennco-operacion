import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_REPO = "/Users/Jorge/dev/ennco-revenue-platform";

function parseArgs(argv) {
  const args = { repo: DEFAULT_REPO, writeEvidence: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--repo") {
      args.repo = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--write-evidence") {
      args.writeEvidence = true;
    } else {
      throw new Error(`Argumento no reconocido: ${argv[index]}`);
    }
  }
  return args;
}

async function sha256File(filePath) {
  return createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

function round(value, decimals = 2) {
  const scale = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function assert(checks, id, condition, expected, actual) {
  checks.push({ id, status: condition ? "PASS" : "FAIL", expected, actual });
}

const { repo, writeEvidence } = parseArgs(process.argv.slice(2));
const manifestPath = path.join(repo, "data/imports/manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const historical = JSON.parse(
  await fs.readFile(path.join(repo, manifest.datasets.historicalJson.path), "utf8"),
);
const directory = JSON.parse(
  await fs.readFile(path.join(repo, manifest.datasets.directoryJson.path), "utf8"),
);
const quarantine = JSON.parse(
  await fs.readFile(path.join(repo, manifest.datasets.quarantineJson.path), "utf8"),
);
const duplicateCandidates = JSON.parse(
  await fs.readFile(path.join(repo, manifest.datasets.duplicateCandidatesJson.path), "utf8"),
);

const checks = [];

for (const [key, source] of Object.entries(manifest.sources)) {
  const rawHash = await sha256File(path.join(repo, source.raw_workbook));
  const liveSourceHash = await sha256File(source.source_path);
  assert(checks, `${key}_raw_hash`, rawHash === source.source_sha256, source.source_sha256, rawHash);
  assert(checks, `${key}_live_source_unchanged`, liveSourceHash === source.source_sha256, source.source_sha256, liveSourceHash);
}

for (const [key, dataset] of Object.entries(manifest.datasets)) {
  const actualHash = await sha256File(path.join(repo, dataset.path));
  assert(checks, `dataset_hash_${key}`, actualHash === dataset.sha256, dataset.sha256, actualHash);
}

const historicalSales = round(historical.reduce((sum, row) => sum + (row.sales_mxn ?? 0), 0), 2);
const pvCount = historical.filter((row) => row.work_type_normalized === "INSTALACION FOTOVOLTAICA").length;
const maintenanceCount = historical.filter((row) => row.work_type_normalized === "MANTENIMIENTO ELECTRICO").length;
const capacityWp = historical.reduce((sum, row) => sum + (row.capacity_wp ?? 0), 0);
const capacityKwp = round(historical.reduce((sum, row) => sum + (row.capacity_kwp ?? 0), 0), 3);
const conversionCorrect = historical.every((row) =>
  row.capacity_wp === null ? row.capacity_kwp === null : round(row.capacity_wp / 1000, 3) === row.capacity_kwp,
);
const uniqueHistoricalIds = new Set(historical.map((row) => row.record_id)).size;

assert(checks, "historical_record_count", historical.length === 20, 20, historical.length);
assert(checks, "historical_sales_total", historicalSales === 8411668.31, 8411668.31, historicalSales);
assert(checks, "historical_pv_count", pvCount === 18, 18, pvCount);
assert(checks, "historical_maintenance_count", maintenanceCount === 2, 2, maintenanceCount);
assert(checks, "historical_capacity_wp", capacityWp === 277895, 277895, capacityWp);
assert(checks, "historical_capacity_kwp", capacityKwp === 277.895, 277.895, capacityKwp);
assert(checks, "historical_unit_conversion", conversionCorrect, true, conversionCorrect);
assert(checks, "historical_unique_record_ids", uniqueHistoricalIds === historical.length, historical.length, uniqueHistoricalIds);
assert(
  checks,
  "historical_high_outlier_count",
  historical.filter((row) => row.model_calibration_status === "manual_review_excluded").length === 2,
  2,
  historical.filter((row) => row.model_calibration_status === "manual_review_excluded").length,
);

const uniqueDirectoryIds = new Set(directory.map((row) => row.record_id)).size;
const locationReviewCount = directory.filter((row) => row.qa_flags.includes("location_verification_required")).length;
const allResearchSeed = directory.every((row) => row.commercial_state === "RESEARCH_SEED");
const allNotEligible = directory.every((row) => row.outreach_eligible === false);
const candidateNames = new Set(
  duplicateCandidates.flatMap((pair) => [pair.left_company, pair.right_company]),
);

assert(checks, "directory_record_count", directory.length === 27, 27, directory.length);
assert(checks, "directory_unique_record_ids", uniqueDirectoryIds === directory.length, directory.length, uniqueDirectoryIds);
assert(checks, "directory_location_review_count", locationReviewCount === 5, 5, locationReviewCount);
assert(checks, "directory_quarantine_count", quarantine.length === 6, 6, quarantine.length);
assert(checks, "directory_duplicate_pair_count", duplicateCandidates.length === 1, 1, duplicateCandidates.length);
assert(
  checks,
  "directory_duplicate_names",
  candidateNames.has("WELDCOAT de México") && candidateNames.has("HEWELDCOAT de México"),
  ["WELDCOAT de México", "HEWELDCOAT de México"],
  [...candidateNames],
);
assert(checks, "directory_research_seed_only", allResearchSeed, true, allResearchSeed);
assert(checks, "directory_no_outreach_eligibility", allNotEligible, true, allNotEligible);

const failed = checks.filter((check) => check.status === "FAIL");
const evidence = {
  schema_version: "1.0.0",
  verified_at_utc: new Date().toISOString(),
  status: failed.length === 0 ? "PASS" : "FAIL",
  manifest_sha256: await sha256File(manifestPath),
  checks_passed: checks.length - failed.length,
  checks_failed: failed.length,
  checks,
  boundaries: {
    contacts_created: 0,
    leads_created: 0,
    opportunities_created: 0,
    outreach_eligible_records: directory.filter((row) => row.outreach_eligible).length,
  },
};

const evidenceDir = path.join(repo, "evidence/data-import");
if (writeEvidence) {
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(
    path.join(evidenceDir, "verification.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );

  const checksumTargets = [
    "data/imports/manifest.json",
    ...Object.values(manifest.sources).flatMap((source) => [source.raw_workbook, source.raw_extraction]),
    ...Object.values(manifest.datasets).map((dataset) => dataset.path),
  ];
  const checksumLines = [];
  for (const relativePath of checksumTargets) {
    checksumLines.push(`${await sha256File(path.join(repo, relativePath))}  ${relativePath}`);
  }
  await fs.writeFile(path.join(evidenceDir, "checksums.sha256"), `${checksumLines.join("\n")}\n`, "utf8");
}

process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
if (failed.length > 0) process.exitCode = 1;
