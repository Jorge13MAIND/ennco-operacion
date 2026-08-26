#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

import { chromium } from "@playwright/test";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function percentile(values, ratio) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)] ?? null;
}

async function collectFiles(root, paths) {
  const files = [];
  for (const path of paths) {
    const absolute = resolve(root, path);
    const entries = await readdir(absolute, { withFileTypes: true }).catch(() => null);
    if (!entries) {
      files.push(absolute);
      continue;
    }
    for (const entry of entries) {
      const child = resolve(absolute, entry.name);
      if (entry.isDirectory()) files.push(...await collectFiles(root, [relative(root, child)]));
      else files.push(child);
    }
  }
  return files.sort();
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function installObservers(page) {
  await page.addInitScript(() => {
    globalThis.__M31_VITALS__ = { cls: 0, lcp: null };
    globalThis.__M31_CSP__ = [];
    addEventListener("securitypolicyviolation", (event) => {
      globalThis.__M31_CSP__.push({ blockedUri: event.blockedURI, directive: event.effectiveDirective });
    });
    try {
      new PerformanceObserver((list) => {
        const last = list.getEntries().at(-1);
        if (last) globalThis.__M31_VITALS__.lcp = last.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) globalThis.__M31_VITALS__.cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      globalThis.__M31_VITALS__ = { cls: null, lcp: null };
    }
  });
}

async function pageMetrics(page) {
  return page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    cspViolations: globalThis.__M31_CSP__ ?? [],
    vitals: globalThis.__M31_VITALS__ ?? { cls: null, lcp: null },
  }));
}

const repo = resolve(argument("--repo", "."));
const baseUrl = new URL(argument("--base-url", "http://127.0.0.1:3101"));
const evidenceDir = resolve(repo, argument("--evidence-dir", "evidence/m31-ux-redesign"));
const afterDir = resolve(evidenceDir, "after");
if (baseUrl.protocol !== "http:" || !["localhost", "127.0.0.1", "::1"].includes(baseUrl.hostname)) {
  throw new Error("M31_BROWSER_GATE_LOCAL_ONLY");
}
if (!evidenceDir.startsWith(`${repo}/`)) throw new Error("M31_EVIDENCE_DIR_OUTSIDE_REPO");

const sourcePaths = [
  "next.config.ts",
  "src/app/layout.tsx",
  "src/app/globals.css",
  "src/app/page.tsx",
  "src/app/diagnostico/page.tsx",
  "src/app/ingreso/page.tsx",
  "src/app/operacion/layout.tsx",
  "src/app/operacion/page.tsx",
  "src/components/OperationsNav.tsx",
  "src/components/PortalTable.tsx",
  "src/components/PortalTableFilter.tsx",
  "src/components/PrequoteForm.tsx",
  "src/components/SiteHeader.tsx",
  "scripts/m23-load-gate.k6.js",
  "scripts/m31-ux-browser-gate.mjs",
  "src/styles",
  "public/brand",
  "public/media",
];
const sourceFiles = (await collectFiles(repo, sourcePaths))
  .filter((path) => ![".DS_Store"].includes(path.split("/").at(-1)))
  .filter((path) => [".tsx", ".ts", ".css", ".svg", ".json", ".avif", ".webp", ".js", ".mjs"].includes(extname(path)));
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async (path) => [relative(repo, path), await sha256(path)])));
const sourceFingerprint = createHash("sha256")
  .update(Object.entries(sourceHashes).map(([path, hash]) => `${hash}  ${path}`).join("\n"))
  .digest("hex");
const baselineFiles = await collectFiles(repo, ["evidence/m31-ux-redesign/before"]);
const baselineHashes = Object.fromEntries(await Promise.all(baselineFiles.map(async (path) => [relative(repo, path), await sha256(path)])));

const viewports = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "mobile-390", width: 390, height: 844 },
];
const surfaces = [
  { name: "home", path: "/" },
  { name: "diagnostic", path: "/diagnostico", completeDiagnostic: true },
  { name: "identity", path: "/ingreso" },
  { name: "control-room", path: "/operacion" },
  { name: "responses", path: "/operacion/respuestas" },
];

await mkdir(afterDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const surfaceResults = [];
const runtimeFailures = [];
const externalRequests = [];

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === baseUrl.origin) return route.continue();
      externalRequests.push(url.origin);
      return route.abort("blockedbyclient");
    });
    for (const surface of surfaces) {
      const page = await context.newPage();
      await installObservers(page);
      page.on("console", (message) => {
        if (message.type() === "error") runtimeFailures.push(`${viewport.name}:${surface.name}:console:${message.text()}`);
      });
      page.on("requestfailed", (request) => {
        const url = new URL(request.url());
        if (request.method() === "GET" && url.searchParams.has("_rsc")) return;
        if (url.origin !== baseUrl.origin) return;
        runtimeFailures.push(`${viewport.name}:${surface.name}:request:${request.method()} ${request.url()}`);
      });
      const response = await page.goto(new URL(surface.path, baseUrl).href, { waitUntil: "domcontentloaded" });
      if (!response?.ok()) runtimeFailures.push(`${viewport.name}:${surface.name}:status:${response?.status() ?? "NO_RESPONSE"}`);
      await page.evaluate(() => document.fonts.ready);
      if (surface.completeDiagnostic) {
        await page.getByRole("button", { name: "Generar referencia" }).click();
        await page.getByText(/ENN-PRE-/).waitFor();
      }
      await page.waitForTimeout(250);
      const metrics = await pageMetrics(page);
      surfaceResults.push({ viewport: viewport.name, surface: surface.name, ...metrics });
      await page.locator("main#main-content").focus();
      await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
      await page.screenshot({ fullPage: true, path: resolve(afterDir, `${viewport.name}-${surface.name}.png`) });
      await page.close();
    }
    await context.close();
  }

  const mobileProfiles = [];
  for (const path of ["/", "/operacion"]) {
    const samples = [];
    for (let run = 1; run <= 5; run += 1) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      await installObservers(page);
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
      await page.goto(new URL(path, baseUrl).href, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(500);
      samples.push({ run, ...(await pageMetrics(page)).vitals });
      await context.close();
    }
    const lcpValues = samples.map((sample) => sample.lcp).filter(Number.isFinite);
    mobileProfiles.push({ path, samples, lcpP75Ms: percentile(lcpValues, 0.75), sampleCount: lcpValues.length });
  }

  const reducedContext = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1280, height: 800 } });
  const reducedPage = await reducedContext.newPage();
  await reducedPage.goto(baseUrl.href, { waitUntil: "domcontentloaded" });
  const reducedMotionDurationMs = await reducedPage.locator(".button").first().evaluate((element) => {
    const duration = getComputedStyle(element).transitionDuration;
    return duration.split(",").reduce((max, value) => {
      const trimmed = value.trim();
      const milliseconds = trimmed.endsWith("ms") ? Number.parseFloat(trimmed) : Number.parseFloat(trimmed) * 1_000;
      return Math.max(max, milliseconds);
    }, 0);
  });
  await reducedContext.close();

  const failures = [
    ...runtimeFailures,
    ...[...new Set(externalRequests)].map((origin) => `EXTERNAL_REQUEST:${origin}`),
    ...surfaceResults.filter((result) => result.scrollWidth > result.clientWidth + 1)
      .map((result) => `HORIZONTAL_OVERFLOW:${result.viewport}:${result.surface}`),
    ...surfaceResults.flatMap((result) => result.cspViolations.map((violation) => `CSP:${result.viewport}:${result.surface}:${violation.directive}`)),
    ...surfaceResults.filter((result) => Number.isFinite(result.vitals.cls) && result.vitals.cls > 0.1)
      .map((result) => `CLS_BUDGET:${result.viewport}:${result.surface}:${result.vitals.cls}`),
    ...mobileProfiles.filter((profile) => profile.sampleCount !== 5 || profile.lcpP75Ms === null || profile.lcpP75Ms > 2_500)
      .map((profile) => `LCP_BUDGET:${profile.path}:${profile.lcpP75Ms ?? "UNKNOWN"}`),
    ...(reducedMotionDurationMs > 0.02 ? [`REDUCED_MOTION:${reducedMotionDurationMs}`] : []),
  ];
  if (surfaceResults.length !== viewports.length * surfaces.length) failures.push("SURFACE_MATRIX_INCOMPLETE");

  const captureFiles = await collectFiles(repo, ["evidence/m31-ux-redesign/after"]);
  const captureHashes = Object.fromEntries(await Promise.all(
    captureFiles.map(async (path) => [relative(repo, path), await sha256(path)]),
  ));

  const report = {
    schemaVersion: "1.0.0",
    evidenceClass: "LOCAL_WORKTREE_VISUAL_QA",
    baselineCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
    sourceTreeClean: false,
    sourceFingerprint,
    sourceHashes,
    baselineHashes,
    captureHashes,
    generatedAt: new Date().toISOString(),
    externalSideEffects: 0,
    matrix: { viewports: viewports.length, surfaces: surfaces.length, captures: surfaceResults.length },
    surfaceResults,
    mobileProfiles,
    reducedMotionDurationMs,
    status: failures.length === 0 ? "PASS_LOCAL" : "FAIL",
    releaseEligible: false,
    failures,
    limitations: [
      "La evidencia está ligada al fingerprint exacto del frontend del worktree, no a un commit limpio.",
      "Chromium automatizado no sustituye auditoría humana con tecnología asistiva ni revisión en dispositivos físicos.",
      "Las métricas se obtienen sobre build productivo local con red y CPU simuladas, no en staging ni producción.",
    ],
  };
  await writeFile(resolve(evidenceDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ status: report.status, sourceFingerprint, matrix: report.matrix, mobileProfiles, failures }, null, 2)}\n`);
  if (failures.length > 0) process.exitCode = 1;
} finally {
  await browser.close();
}
