#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "@playwright/test";

const repoIndex = process.argv.indexOf("--repo");
const repoRoot = resolve(repoIndex >= 0 ? process.argv[repoIndex + 1] : ".");
const baseUrlIndex = process.argv.indexOf("--base-url");
const baseUrl = baseUrlIndex >= 0 ? process.argv[baseUrlIndex + 1] : "http://127.0.0.1:3108";
const evidenceDir = resolve(repoRoot, "docs/evidence");
await mkdir(evidenceDir, { recursive: true });

const browser = await chromium.launch();
try {
  const captures = [
    { name: "campaigns-desktop", path: "/operacion/campanas", heading: "Campañas", width: 1440, height: 1000 },
    { name: "campaigns-mobile", path: "/operacion/campanas", heading: "Campañas", width: 390, height: 844 },
    { name: "roadmap-desktop", path: "/operacion/roadmap", heading: "Roadmap E2E", width: 1440, height: 1000 },
  ];
  for (const capture of captures) {
    const page = await browser.newPage({ viewport: { width: capture.width, height: capture.height } });
    await page.goto(`${baseUrl}${capture.path}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1, name: capture.heading }).waitFor();
    if (capture.path.endsWith("campanas")) {
      await page.getByText("0/30 gates live").waitFor();
      await page.getByText("0 destinatarios reales").waitFor();
    } else {
      await page.getByText("M6. Primer correo").waitFor();
    }
    await page.screenshot({
      path: resolve(evidenceDir, `M6-${capture.name}.png`),
      fullPage: true,
    });
    await page.close();
  }
  process.stdout.write(`M6_BROWSER_EVIDENCE_PASS captures=${captures.length}\n`);
} finally {
  await browser.close();
}
