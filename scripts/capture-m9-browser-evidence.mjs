#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "@playwright/test";

const repoIndex = process.argv.indexOf("--repo");
const repoRoot = resolve(repoIndex >= 0 ? process.argv[repoIndex + 1] : ".");
const baseUrlIndex = process.argv.indexOf("--base-url");
const baseUrl = baseUrlIndex >= 0 ? process.argv[baseUrlIndex + 1] : "http://localhost:3109";
const evidenceDir = resolve(repoRoot, "docs/evidence");
await mkdir(evidenceDir, { recursive: true });

const browser = await chromium.launch();
try {
  const captures = [
    { name: "delivery-desktop", path: "/operacion/entrega", heading: "Hardening y entrega", width: 1440, height: 1100 },
    { name: "delivery-mobile", path: "/operacion/entrega", heading: "Hardening y entrega", width: 390, height: 844 },
    { name: "roadmap-desktop", path: "/operacion/roadmap", heading: "Roadmap E2E", width: 1440, height: 1100 },
  ];
  for (const capture of captures) {
    const page = await browser.newPage({ viewport: { width: capture.width, height: capture.height } });
    await page.goto(`${baseUrl}${capture.path}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1, name: capture.heading }).waitFor();
    if (capture.path.endsWith("entrega")) {
      await page.getByText("6/6 criterios locales").waitFor();
      await page.getByText("0 aceptaciones").waitFor();
    } else {
      await page.getByText("M9. Hardening y entrega").waitFor();
    }
    await page.screenshot({ path: resolve(evidenceDir, `M9-${capture.name}.png`), fullPage: true });
    await page.close();
  }
  process.stdout.write(`M9_BROWSER_EVIDENCE_PASS captures=${captures.length}\n`);
} finally {
  await browser.close();
}
