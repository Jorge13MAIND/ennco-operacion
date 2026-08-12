#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "@playwright/test";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const repo = resolve(argument("--repo", "."));
const baseUrl = new URL(argument("--base-url", "http://127.0.0.1:3100"));
const evidenceDir = resolve(repo, argument("--evidence-dir", "evidence/m23-frontend"));
const sourceSnapshotPath = resolve(repo, argument("--source-snapshot", "evidence/m23-frontend/source.json"));
if (!['localhost', '127.0.0.1', '::1'].includes(baseUrl.hostname) || baseUrl.protocol !== "http:") {
  throw new Error("M23_BROWSER_GATE_LOCAL_ONLY");
}
if (!evidenceDir.startsWith(`${repo}/`)) throw new Error("M23_EVIDENCE_DIR_OUTSIDE_REPO");

const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: repo, encoding: "utf8" }).trim();
const sourceSnapshot = JSON.parse(await readFile(sourceSnapshotPath, "utf8"));
if (sourceSnapshot?.status !== "PASS"
  || sourceSnapshot?.source_commit !== commit
  || sourceSnapshot?.source_tree !== tree
  || sourceSnapshot?.source_tree_clean !== true
  || sourceSnapshot?.execution_context !== "local") {
  throw new Error("M23_SOURCE_SNAPSHOT_INVALID");
}
const viewports = [
  { name: "desktop-wide", width: 1440, height: 900 },
  { name: "desktop-standard", width: 1280, height: 720 },
  { name: "tablet", width: 834, height: 1194 },
  { name: "mobile-iphone", width: 393, height: 852 },
  { name: "mobile-android", width: 412, height: 915 },
];
const surfaces = [
  { name: "home", path: "/" },
  { name: "diagnostic", path: "/diagnostico" },
  { name: "privacy", path: "/privacidad" },
  { name: "identity", path: "/ingreso" },
  { name: "control-room", path: "/operacion" },
];

function percentile(values, value) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)] ?? null;
}

async function installPerformanceObservers(page) {
  await page.addInitScript(() => {
    globalThis.__M23_VITALS__ = { cls: 0, lcp: null };
    globalThis.__M23_CSP_VIOLATIONS__ = [];
    addEventListener("securitypolicyviolation", (event) => {
      globalThis.__M23_CSP_VIOLATIONS__.push({
        blocked_uri: event.blockedURI,
        directive: event.effectiveDirective,
        disposition: event.disposition,
      });
    });
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries.at(-1);
        if (last) globalThis.__M23_VITALS__.lcp = last.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) globalThis.__M23_VITALS__.cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      globalThis.__M23_VITALS__ = { cls: null, lcp: null };
    }
  });
}

async function collectPageMetrics(page) {
  return page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    const vitals = globalThis.__M23_VITALS__ ?? { cls: null, lcp: null };
    return {
      document: {
        client_width: document.documentElement.clientWidth,
        scroll_width: document.documentElement.scrollWidth,
        horizontal_overflow_px: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      },
      navigation_ms: navigation ? {
        response_start: navigation.responseStart,
        dom_content_loaded: navigation.domContentLoadedEventEnd,
        load: navigation.loadEventEnd,
      } : null,
      web_vitals: {
        fcp_ms: fcp?.startTime ?? null,
        lcp_ms: vitals.lcp,
        cls: vitals.cls,
      },
      csp_violations: globalThis.__M23_CSP_VIOLATIONS__ ?? [],
    };
  });
}

await mkdir(evidenceDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const surfaceResults = [];
const runtimeFailures = [];
const externalAttempts = [];

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === baseUrl.origin) return route.continue();
      externalAttempts.push(url.origin);
      return route.abort("blockedbyclient");
    });
    for (const surface of surfaces) {
      const page = await context.newPage();
      await installPerformanceObservers(page);
      page.on("console", (message) => {
        if (message.type() === "error") runtimeFailures.push(`${viewport.name}:${surface.name}:console:${message.text()}`);
      });
      page.on("requestfailed", (request) => {
        if (request.method() === "GET" && new URL(request.url()).searchParams.has("_rsc")) return;
        runtimeFailures.push(`${viewport.name}:${surface.name}:request:${request.method()} ${request.url()}`);
      });
      const response = await page.goto(new URL(surface.path, baseUrl).href, { waitUntil: "domcontentloaded" });
      if (!response?.ok()) runtimeFailures.push(`${viewport.name}:${surface.name}:status:${response?.status() ?? "NO_RESPONSE"}`);
      await page.waitForTimeout(300);
      surfaceResults.push({ viewport: viewport.name, surface: surface.name, ...(await collectPageMetrics(page)) });
      if (surface.name === "diagnostic") {
        await page.getByRole("button", { name: "Generar referencia" }).click();
        await page.getByText(/ENN-PRE-/).waitFor();
        await page.screenshot({ fullPage: true, path: resolve(evidenceDir, `${viewport.name}-diagnostic-result.png`) });
      }
      if (surface.name === "control-room") {
        await page.screenshot({ fullPage: true, path: resolve(evidenceDir, `${viewport.name}-control-room.png`) });
      }
      await page.close();
    }
    await context.close();
  }

  const mobileLcpRuns = [];
  for (let run = 1; run <= 5; run += 1) {
    const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
    const page = await context.newPage();
    await installPerformanceObservers(page);
    const session = await context.newCDPSession(page);
    await session.send("Network.enable");
    await session.send("Network.setCacheDisabled", { cacheDisabled: true });
    await session.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: 1_600_000 / 8,
      uploadThroughput: 750_000 / 8,
      connectionType: "cellular3g",
    });
    await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.goto(new URL("/operacion", baseUrl).href, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
    const metrics = await collectPageMetrics(page);
    mobileLcpRuns.push({ run, ...metrics.web_vitals });
    await context.close();
  }

  const lcpValues = mobileLcpRuns.map((run) => run.lcp_ms).filter((value) => Number.isFinite(value));
  const mobileLcpP75 = percentile(lcpValues, 0.75);
  const failures = [
    ...runtimeFailures,
    ...externalAttempts.map((origin) => `external-request:${origin}`),
    ...surfaceResults.filter((result) => result.document.horizontal_overflow_px > 1)
      .map((result) => `overflow:${result.viewport}:${result.surface}:${result.document.horizontal_overflow_px}`),
    ...surfaceResults.flatMap((result) => result.csp_violations
      .map((violation) => `csp:${result.viewport}:${result.surface}:${violation.directive}:${violation.blocked_uri}`)),
  ];
  if (surfaceResults.length !== viewports.length * surfaces.length) failures.push("surface-matrix-incomplete");
  if (lcpValues.length !== 5) failures.push("mobile-lcp-samples-incomplete");
  if (mobileLcpP75 === null || mobileLcpP75 > 2_500) failures.push(`mobile-lcp-p75-budget:${mobileLcpP75 ?? "UNKNOWN"}`);

  const report = {
    schema_version: "1.0.0",
    requirement_ids: ["ENT-004", "ENT-005"],
    evidence_class: "synthetic_demo",
    baseline_commit: commit,
    baseline_tree: tree,
    source_snapshot: {
      path: sourceSnapshotPath.slice(repo.length + 1),
      status: sourceSnapshot.status,
      execution_context: sourceSnapshot.execution_context,
    },
    generated_at: new Date().toISOString(),
    external_side_effects: 0,
    matrix: { surfaces: surfaces.length, viewports: viewports.length, captures: viewports.length * 2 },
    surface_results: surfaceResults,
    mobile_portal_profile: {
      viewport_css_px: { width: 412, height: 915 },
      latency_ms: 150,
      download_bps: 1_600_000,
      upload_bps: 750_000,
      cpu_slowdown: 4,
      samples: mobileLcpRuns,
      lcp_p75_ms: mobileLcpP75,
      budget_lcp_p75_ms: 2_500,
    },
    status: failures.length === 0 ? "PASS_LOCAL" : "FAIL",
    failures,
    limitations: [
      "Chromium automation is not a human WCAG conformance audit or assistive-technology certification.",
      "The 320 CSS pixel reflow test is the deterministic equivalent of a 1280 CSS pixel viewport at 400 percent zoom; actual browser zoom and physical-device review remain required before public release.",
      "Performance uses a production build on localhost with simulated mobile network and CPU; it does not prove managed database, queue, storage, provider, staging or production capacity.",
      "Generated PDF reading order and contrast require a separate document accessibility review.",
    ],
  };
  await writeFile(resolve(evidenceDir, "browser-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== "PASS_LOCAL") process.exitCode = 1;
} finally {
  await browser.close();
}
