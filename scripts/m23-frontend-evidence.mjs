#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const repo = resolve(argument("--repo", "."));
const evidenceDir = resolve(repo, argument("--evidence-dir", "evidence/m23-frontend"));
if (!evidenceDir.startsWith(`${repo}/`)) throw new Error("M23_EVIDENCE_DIR_OUTSIDE_REPO");

const paths = {
  source: resolve(evidenceDir, "source.json"),
  browser: resolve(evidenceDir, "browser-report.json"),
  k6: resolve(evidenceDir, "k6-summary.json"),
  playwright: resolve(evidenceDir, "playwright.log"),
};
const source = readJson(paths.source);
const browser = readJson(paths.browser);
const k6 = readJson(paths.k6);
const playwright = readFileSync(paths.playwright, "utf8");

const failures = [];
if (source.status !== "PASS" || source.source_tree_clean !== true || source.execution_context !== "local") {
  failures.push("SOURCE_SNAPSHOT_INVALID");
}
if (browser.status !== "PASS_LOCAL"
  || browser.baseline_commit !== source.source_commit
  || browser.baseline_tree !== source.source_tree
  || browser.failures?.length !== 0) failures.push("BROWSER_REPORT_INVALID");
if ((k6.metrics?.http_req_failed?.value ?? 1) !== 0
  || (k6.metrics?.dropped_iterations?.count ?? 1) !== 0
  || (k6.metrics?.checks?.fails ?? 1) !== 0
  || (k6.metrics?.http_req_duration?.["p(95)"] ?? Infinity) >= 800) failures.push("LOAD_REPORT_INVALID");
const playwrightMatch = playwright.match(/(\d+) passed/);
if (!playwrightMatch || Number(playwrightMatch[1]) < 131 || !playwright.includes("4 skipped")) {
  failures.push("PLAYWRIGHT_REPORT_INVALID");
}

const report = {
  schema_version: "1.0.0",
  requirement_ids: ["ENT-004", "ENT-005"],
  evidence_class: "synthetic_demo",
  source_commit: source.source_commit,
  source_tree: source.source_tree,
  source_tree_clean_before_capture: true,
  local_gate_status: failures.length === 0 ? "PASS_LOCAL" : "FAIL",
  requirement_status: "EXTEND",
  release_eligible: false,
  external_side_effects: 0,
  artifacts: Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, {
    path: path.slice(repo.length + 1),
    sha256: sha256(path),
  }])),
  metrics: {
    playwright_passed: playwrightMatch ? Number(playwrightMatch[1]) : null,
    playwright_skipped: 4,
    browser_surface_viewport_matrix: browser.surface_results?.length ?? null,
    browser_runtime_failures: browser.failures?.length ?? null,
    mobile_portal_lcp_p75_ms: browser.mobile_portal_profile?.lcp_p75_ms ?? null,
    mobile_portal_cls_max: Math.max(...(browser.mobile_portal_profile?.samples ?? []).map((sample) => sample.cls ?? Infinity)),
    load_requests: k6.metrics?.http_reqs?.count ?? null,
    load_rps: k6.metrics?.http_reqs?.rate ?? null,
    load_p95_ms: k6.metrics?.http_req_duration?.["p(95)"] ?? null,
    load_errors: k6.metrics?.http_req_failed?.value ?? null,
    load_dropped_iterations: k6.metrics?.dropped_iterations?.count ?? null,
  },
  failures,
  limitations: [
    "Local Chromium automation is not a human WCAG conformance or assistive-technology audit.",
    "The smoke load run does not satisfy the required five-minute release load gate.",
    "Localhost does not prove managed database, queue, storage, provider, staging or production capacity.",
    "Generated PDF reading order and contrast remain pending manual review.",
  ],
};
writeFileSync(resolve(evidenceDir, "manifest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
