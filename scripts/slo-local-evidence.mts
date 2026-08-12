import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  calculateEnterpriseSloSnapshotSha256,
  ENTERPRISE_SLI_CODES,
  evaluateEnterpriseSloSnapshot,
  type EnterpriseSliCode,
  type EnterpriseSloSnapshot,
} from "../src/lib/slo/enterprise-slo.ts";

const repoArgument = process.argv.indexOf("--repo");
const repo = resolve(repoArgument >= 0 ? process.argv[repoArgument + 1] : ".");
const sourceArgument = process.argv.indexOf("--source-commit");
const requestedSource = sourceArgument >= 0 ? process.argv[sourceArgument + 1] : "HEAD";
const writeEvidence = process.argv.includes("--write-evidence");

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]));
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function windows(code: EnterpriseSliCode) {
  const latency = code === "CRITICAL_ALERT_LATENCY" ? 60_000
    : code === "REPLY_SYNC_LATENCY" ? 180_000 : null;
  const evaluatedAt = "2026-08-12T12:00:00.000-06:00";
  return [
    { kind: "SHORT" as const, startedAt: "2026-08-12T11:00:00.000-06:00" },
    { kind: "LONG" as const, startedAt: "2026-08-12T06:00:00.000-06:00" },
    { kind: "MONTH_TO_DATE" as const, startedAt: "2026-08-01T00:00:00.000-06:00" },
  ].map((window) => ({
    ...window,
    endedAt: evaluatedAt,
    collectedAt: evaluatedAt,
    totalEvents: 100_000,
    badEvents: 0,
    observedP95Ms: latency,
    sourceReference: `contract-only synthetic fixture ${code}`,
    querySha256: createHash("sha256").update(`fixture:${code}:${window.kind}`).digest("hex"),
  }));
}

function fixture(sourceCommitSha: string, sourceTreeSha: string): EnterpriseSloSnapshot {
  return {
    schemaVersion: "1.0.0",
    evidenceClass: "synthetic_demo",
    environment: "local",
    evaluatedAt: "2026-08-12T12:00:00.000-06:00",
    sourceCommitSha,
    sourceTreeSha,
    collector: "M023 local contract self-test",
    collectorVersion: "1.0.0",
    series: ENTERPRISE_SLI_CODES.flatMap((code) => {
      const dimensions = code === "PUBLIC_AVAILABILITY" ? ["CAPTURE", "PORTAL"] as const : ["ALL"] as const;
      return dimensions.map((dimension) => ({ code, dimension, windows: windows(code) }));
    }),
  };
}

function replaceWindow(
  snapshot: EnterpriseSloSnapshot,
  code: EnterpriseSliCode,
  kind: "SHORT" | "LONG" | "MONTH_TO_DATE",
  values: Record<string, unknown>,
): EnterpriseSloSnapshot {
  return {
    ...snapshot,
    series: snapshot.series.map((series) => series.code !== code ? series : {
      ...series,
      windows: series.windows.map((window) => window.kind !== kind ? window : { ...window, ...values }),
    }),
  } as EnterpriseSloSnapshot;
}

const head = git(["rev-parse", "HEAD"]);
const sourceCommitSha = git(["rev-parse", requestedSource]);
const sourceTreeSha = git(["rev-parse", `${sourceCommitSha}^{tree}`]);
const worktreeClean = git(["status", "--porcelain"]) === "";
const base = fixture(sourceCommitSha, sourceTreeSha);
const synthetic = evaluateEnterpriseSloSnapshot(base);
const missingSeries = evaluateEnterpriseSloSnapshot({ ...base, series: base.series.slice(0, 6) });
const stale = evaluateEnterpriseSloSnapshot(replaceWindow(base, "PUBLIC_AVAILABILITY", "SHORT", {
  collectedAt: "2026-08-12T11:40:00.000-06:00",
}));
const reordered = { ...base, series: [...base.series].reverse().map((series) => ({ ...series, windows: [...series.windows].reverse() })) };
const drifted = replaceWindow(base, "PUBLIC_AVAILABILITY", "SHORT", { badEvents: 1 });

const checks = [
  { id: "EXACT_SIX_SLI_AND_SEVEN_SERIES", pass: ENTERPRISE_SLI_CODES.length === 6 && base.series.length === 7 },
  { id: "SYNTHETIC_NEVER_LIVE", pass: synthetic.status === "UNKNOWN" && synthetic.featureFreeze && synthetic.reasonCodes.includes("SLO_NON_LIVE_EVIDENCE") },
  { id: "MISSING_SERIES_FAILS_CLOSED", pass: missingSeries.status === "UNKNOWN" && missingSeries.featureFreeze },
  { id: "STALE_TELEMETRY_FAILS_CLOSED", pass: stale.status === "UNKNOWN" && stale.reasonCodes.includes("SLO_TELEMETRY_STALE") },
  { id: "CANONICAL_ORDER_STABLE", pass: calculateEnterpriseSloSnapshotSha256(base) === calculateEnterpriseSloSnapshotSha256(reordered) },
  { id: "MATERIAL_DRIFT_CHANGES_SHA", pass: calculateEnterpriseSloSnapshotSha256(base) !== calculateEnterpriseSloSnapshotSha256(drifted) },
];
const failed = checks.filter((check) => !check.pass);
if (failed.length > 0) throw new Error(`M023_LOCAL_CONTRACT_FAILED:${failed.map((check) => check.id).join(",")}`);

const reportWithoutSha = {
  schema_version: "1.0.0",
  generated_at: new Date().toISOString(),
  local_contract_status: "PASS",
  operational_slo_status: "UNKNOWN",
  feature_freeze: true,
  evidence_class: "synthetic_demo",
  external_side_effects: 0,
  live_telemetry_records: 0,
  source_binding: {
    requested_commit_sha: sourceCommitSha,
    source_tree_sha: sourceTreeSha,
    head_sha: head,
    source_commit_is_head: sourceCommitSha === head,
    worktree_clean_before_capture: worktreeClean,
    status: sourceCommitSha === head && worktreeClean ? "BOUND" : "BLOCKED_UNCOMMITTED_OR_NON_HEAD",
  },
  canonical_fixture_snapshot_sha256: synthetic.snapshotSha256,
  canonical_sli_codes: ENTERPRISE_SLI_CODES,
  required_series: base.series.map((series) => `${series.code}:${series.dimension}`).sort(),
  windows: {
    short_seconds: 3600,
    long_seconds: 21600,
    monthly_timezone: "America/Mexico_City",
  },
  checks,
  limitations: [
    "Synthetic fixtures validate only the local contract and never satisfy an operational SLO.",
    "No managed telemetry, live denominator, provider alert delivery or burn-rate alert was observed.",
    "Production and managed staging remain UNKNOWN until a separately authorized collector supplies fresh live evidence.",
  ],
};
const report = { ...reportWithoutSha, report_sha256: sha256(reportWithoutSha) };

if (writeEvidence) {
  if (!worktreeClean || sourceCommitSha !== head) throw new Error("M023_EVIDENCE_REQUIRES_CLEAN_HEAD_SOURCE_COMMIT");
  const outputPath = resolve(repo, `docs/evidence/M9-slo-local-${sourceCommitSha.slice(0, 7)}.json`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${outputPath}\n`);
} else {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
