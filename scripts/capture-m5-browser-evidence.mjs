#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "@playwright/test";

const repoIndex = process.argv.indexOf("--repo");
const repoRoot = resolve(repoIndex >= 0 ? process.argv[repoIndex + 1] : ".");
const baseUrlIndex = process.argv.indexOf("--base-url");
const baseUrl = baseUrlIndex >= 0 ? process.argv[baseUrlIndex + 1] : "http://127.0.0.1:3107";
const evidenceDir = resolve(repoRoot, "docs/evidence");
await mkdir(evidenceDir, { recursive: true });

const browser = await chromium.launch();
try {
  const captures = [
    { name: "roadmap-desktop", width: 1440, height: 1000 },
    { name: "roadmap-mobile", width: 390, height: 844 },
  ];
  for (const capture of captures) {
    const page = await browser.newPage({ viewport: { width: capture.width, height: capture.height } });
    await page.goto(`${baseUrl}/operacion/roadmap`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1, name: "Roadmap E2E" }).waitFor();
    await page.getByText("Shadow canary").waitFor();
    await page.screenshot({
      path: resolve(evidenceDir, `M5-${capture.name}.png`),
      fullPage: true,
    });
    await page.close();
  }
  process.stdout.write(`M5_BROWSER_EVIDENCE_PASS captures=${captures.length}\n`);
} finally {
  await browser.close();
}

