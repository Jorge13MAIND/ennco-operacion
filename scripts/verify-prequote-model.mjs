#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";

const repoIndex = process.argv.indexOf("--repo");
const repoRoot = resolve(repoIndex >= 0 ? process.argv[repoIndex + 1] : ".");
const writeEvidence = process.argv.includes("--write-evidence");
const sourceArguments = process.argv
  .map((value, index) => ({ value, index }))
  .filter(({ value }) => value === "--source")
  .map(({ index }) => process.argv[index + 1]);

function parseSourceArguments(values) {
  return new Map(values.map((value) => {
    const separator = value.indexOf("=");
    if (separator < 1) throw new Error(`INVALID_SOURCE_ARGUMENT:${value}`);
    return [value.slice(0, separator), value.slice(separator + 1)];
  }));
}

async function json(relativePath) {
  return JSON.parse(await readFile(resolve(repoRoot, relativePath), "utf8"));
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

const model = await json("data/prequote/model-approved-v3.json");
const sourceManifest = await json("data/prequote/source-manifest.json");
const pacoApproval = await json("data/prequote/paco-approved-parameters-2026-08-20.json");
const calibrationCases = await json("data/prequote/calibration-cases.json");
const historicalProjects = await json("data/imports/normalized/historical_projects.json");
const localSources = parseSourceArguments(sourceArguments);
const checks = [];
const localSourceVerification = [];

function check(id, condition, details) {
  checks.push({ id, status: condition ? "PASS" : "FAIL", details });
}

check("MODEL_VERSION_MATCH", model.version === sourceManifest.model_version, model.version);
check(
  "MODEL_TECHNICAL_INPUT_APPROVED",
  model.status === "APPROVED" && sourceManifest.approval_status === "APPROVED",
  `${model.status}/${sourceManifest.approval_status}`,
);
check("MODEL_APPROVER_IS_PACO", model.modelApprovalRequiredBy === "Paco", model.modelApprovalRequiredBy);
check(
  "MODEL_APPROVAL_SOURCE_PATH",
  model.approvalSourcePath === "data/prequote/paco-approved-parameters-2026-08-20.json",
  model.approvalSourcePath,
);
check("MODEL_HAS_EXPIRY", Number.isFinite(Date.parse(model.validUntil)), model.validUntil);
check(
  "MODEL_NOT_EXPIRED_AT_SNAPSHOT",
  Date.parse(model.validUntil) > Date.parse(`${sourceManifest.snapshot_date}T23:59:59-06:00`),
  `${sourceManifest.snapshot_date} -> ${model.validUntil}`,
);
check(
  "MODEL_SOURCE_MANIFEST_PATH",
  model.sourceManifestPath === "data/prequote/source-manifest.json",
  model.sourceManifestPath,
);

const pacoApprovalSha256 = await sha256(resolve(repoRoot, "data/prequote/paco-approved-parameters-2026-08-20.json"));
const pacoManifestSource = sourceManifest.sources.find((source) => source.source_id === "SRC-PACO-2026-08-20");
check(
  "PACO_APPROVAL_SOURCE_HASH",
  pacoManifestSource?.sha256 === pacoApprovalSha256,
  pacoApprovalSha256,
);
check(
  "PACO_APPROVAL_SCOPE",
  pacoApproval.approval_scope === "Parámetros técnicos y referencias comerciales del precotizador preliminar",
  pacoApproval.approval_scope,
);

const sourceIds = new Set(sourceManifest.sources.map((source) => source.source_id));
check("SOURCE_IDS_UNIQUE", sourceIds.size === sourceManifest.sources.length, `${sourceIds.size} ids`);
check(
  "SOURCES_HAVE_INTEGRITY_POINTER",
  sourceManifest.sources.every((source) => /^[a-f0-9]{64}$/.test(source.sha256 ?? "") || /^https:\/\//.test(source.url ?? "")),
  `${sourceManifest.sources.length} sources`,
);
check(
  "CALIBRATION_SOURCE_COVERAGE",
  calibrationCases.every((item) => sourceIds.has(item.source_id)),
  `${calibrationCases.length} cases`,
);

for (const [sourceId, sourcePath] of localSources) {
  const manifestSource = sourceManifest.sources.find((source) => source.source_id === sourceId);
  if (!manifestSource?.sha256) throw new Error(`SOURCE_WITH_HASH_NOT_FOUND:${sourceId}`);
  const observedHash = await sha256(sourcePath);
  const status = observedHash === manifestSource.sha256 ? "PASS" : "FAIL";
  localSourceVerification.push({
    source_id: sourceId,
    file_name: basename(sourcePath),
    expected_sha256: manifestSource.sha256,
    observed_sha256: observedHash,
    status,
  });
  check(`LOCAL_SOURCE_HASH_${sourceId}`, status === "PASS", `${basename(sourcePath)} ${status}`);
}

const solarProjects = historicalProjects.filter((row) => row.work_type_normalized === "INSTALACION FOTOVOLTAICA");
const maxHistoricalKwp = Math.max(...solarProjects.map((row) => row.capacity_kwp));
check("HISTORY_ROW_COUNT", historicalProjects.length === 20, `${historicalProjects.length}`);
check("HISTORY_SOLAR_COUNT", solarProjects.length === 18, `${solarProjects.length}`);
check("HISTORY_MAX_CAPACITY", Math.abs(maxHistoricalKwp - 54.825) < 0.0001, `${maxHistoricalKwp} kWp`);
check("NO_MATCHING_100_KWP_HISTORY", solarProjects.every((row) => row.capacity_kwp < 100), `${maxHistoricalKwp} kWp max`);
check(
  "NO_AUTOMATIC_INDUSTRIAL_INVESTMENT_TIER",
  model.investmentMxnPerKwp.every((tier) => tier.minKwp < 100)
    && model.industrialInvestmentPolicy === "TECHNICAL_COMMERCIAL_REVIEW_REQUIRED",
  model.industrialInvestmentPolicy,
);

check(
  "PACO_TECHNICAL_RANGES_MATCH",
  model.effectiveEnergyRateMxnPerKwh.min === 2.8
    && model.effectiveEnergyRateMxnPerKwh.max === 3.35
    && model.monthlyYieldKwhPerKwp.min === 120
    && model.monthlyYieldKwhPerKwp.max === 165
    && model.moduleWp.min === 620
    && model.moduleWp.max === 650
    && model.roofAreaM2PerKwp.min === 5.2
    && model.roofAreaM2PerKwp.max === 7.3,
  "rate/yield/module/area",
);

const underThirtyTier = model.investmentMxnPerKwp.find((tier) => tier.minKwp === 0);
const fromThirtyTier = model.investmentMxnPerKwp.find((tier) => tier.minKwp === 30);
check(
  "PACO_INVESTMENT_BANDS_MATCH",
  underThirtyTier?.min === 18000
    && underThirtyTier?.max === 29000
    && fromThirtyTier?.min === 17000
    && fromThirtyTier?.max === 24000,
  JSON.stringify({ underThirtyTier, fromThirtyTier }),
);
check(
  "COMMERCIAL_REFERENCES_ARE_NON_AUTOMATIC",
  model.commercialReferences.hiddenDefectsWarrantyMonths === 24
    && model.commercialReferences.cashDiscountPct.min === 3
    && model.commercialReferences.cashDiscountPct.max === 6
    && model.commercialReferences.installedModuleStartingPriceMxn === 11000
    && model.commercialReferences.contractualPriceRequiresCommercialValidation === true
    && model.commercialReferences.installationDateDependsOnMaterialsAndWorkSchedule === true
    && model.commercialReferences.automaticCommitmentsAllowed === false,
  JSON.stringify(model.commercialReferences),
);

function selectTier(capacityMax) {
  return [...model.investmentMxnPerKwp]
    .sort((left, right) => right.minKwp - left.minKwp)
    .find((tier) => capacityMax >= tier.minKwp);
}

const backtests = calibrationCases.map((item) => {
  const spend = item.monthly_consumption_kwh * item.effective_energy_rate_mxn_per_kwh;
  const target = item.coverage_pct_for_test / 100;
  const capacityMin = (spend / model.effectiveEnergyRateMxnPerKwh.max * target) / model.monthlyYieldKwhPerKwp.max;
  const capacityMax = (spend / model.effectiveEnergyRateMxnPerKwh.min * target) / model.monthlyYieldKwhPerKwp.min;
  const minimumTier = selectTier(capacityMin);
  const maximumTier = selectTier(capacityMax);
  const investmentMin = capacityMin * minimumTier.min;
  const investmentMax = capacityMax * maximumTier.max;
  const capacityPass = item.capacity_kwp >= capacityMin && item.capacity_kwp <= capacityMax;
  const investmentPass = item.installed_price_mxn_including_tax >= investmentMin
    && item.installed_price_mxn_including_tax <= investmentMax;
  const moduleDerivedCapacity = item.module_count * item.module_wp / 1000;
  return {
    case_id: item.case_id,
    source_id: item.source_id,
    input_monthly_spend_mxn: Number(spend.toFixed(2)),
    predicted_capacity_kwp: { min: Number(capacityMin.toFixed(3)), max: Number(capacityMax.toFixed(3)) },
    source_capacity_kwp: item.capacity_kwp,
    capacity_pass: capacityPass,
    predicted_investment_mxn: { min: Number(investmentMin.toFixed(2)), max: Number(investmentMax.toFixed(2)) },
    source_investment_mxn: item.installed_price_mxn_including_tax,
    investment_pass: investmentPass,
    module_derived_capacity_kwp: Number(moduleDerivedCapacity.toFixed(3)),
    source_review_flags: item.review_flags,
  };
});

check("BACKTEST_CASE_COUNT", backtests.length === 4, `${backtests.length}`);
check("BACKTEST_CAPACITY_ENVELOPE", backtests.every((item) => item.capacity_pass), `${backtests.filter((item) => item.capacity_pass).length}/4`);
check("BACKTEST_INVESTMENT_ENVELOPE", backtests.every((item) => item.investment_pass), `${backtests.filter((item) => item.investment_pass).length}/4`);
check(
  "SOURCE_INCONSISTENCIES_PRESERVED",
  calibrationCases.some((item) => item.review_flags.includes("SOURCE_CAPACITY_DIFFERS_FROM_MODULE_COUNT_TIMES_WATTAGE"))
    && calibrationCases.some((item) => item.review_flags.includes("BIMONTHLY_PRODUCTION_PERIOD_INFERRED_FROM_CONTEXT")),
  "Toyota capacity and bimonthly period flags retained",
);

const publicCalibrationText = JSON.stringify(calibrationCases);
check(
  "PUBLIC_CASES_ANONYMIZED",
  !/(portales|vallejo|toyota|cuellar|asian)/i.test(publicCalibrationText),
  "anonymous case ids only",
);
check(
  "RANGES_ORDERED",
  model.effectiveEnergyRateMxnPerKwh.min <= model.effectiveEnergyRateMxnPerKwh.max
    && model.monthlyYieldKwhPerKwp.min <= model.monthlyYieldKwhPerKwp.max
    && model.moduleWp.min <= model.moduleWp.max
    && model.roofAreaM2PerKwp.min <= model.roofAreaM2PerKwp.max
    && model.investmentMxnPerKwp.every((tier) => tier.min <= tier.max),
  "all min <= max",
);

const failed = checks.filter((item) => item.status === "FAIL");
const report = {
  generated_at: new Date().toISOString(),
  evidence_class: "local_source_audit",
  verdict: failed.length === 0 ? "PASS" : "FAIL",
  model_version: model.version,
  model_release_status: model.status,
  model_approval_required_by: model.modelApprovalRequiredBy,
  source_count: sourceManifest.sources.length,
  local_binary_sources_verified: localSourceVerification.length,
  historical_summary: {
    rows: historicalProjects.length,
    solar_rows: solarProjects.length,
    max_solar_capacity_kwp: maxHistoricalKwp,
    projects_at_or_above_100_kwp: solarProjects.filter((row) => row.capacity_kwp >= 100).length,
  },
  checks,
  backtests,
  local_source_verification: localSourceVerification,
  limitations: [
    "Four proposals are commercial proposals, not as-built evidence.",
    "No delivered historical project in the supplied workbook reaches 100 kWp.",
    "Paco approved the technical ranges and commercial references relayed on 2026-08-20.",
    "Projects at or above 100 kWp have no automatic investment range.",
    "Privacy approval, managed infrastructure, UAT and an explicit public release remain mandatory before live use.",
  ],
};

if (writeEvidence) {
  const evidenceDir = resolve(repoRoot, "docs/evidence");
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(resolve(evidenceDir, "M3-prequote-model-verification.json"), `${JSON.stringify(report, null, 2)}\n`);
}

for (const item of checks) process.stdout.write(`${item.status}\t${item.id}\t${item.details}\n`);
process.stdout.write(`PREQUOTE_MODEL_GATE_${report.verdict}\t${checks.length - failed.length}/${checks.length}\n`);
if (failed.length > 0) process.exitCode = 1;
