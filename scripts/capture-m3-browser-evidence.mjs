#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const repoIndex = process.argv.indexOf("--repo");
const repoRoot = resolve(repoIndex >= 0 ? process.argv[repoIndex + 1] : ".");
const baseUrlIndex = process.argv.indexOf("--base-url");
const baseUrl = baseUrlIndex >= 0 ? process.argv[baseUrlIndex + 1] : "http://localhost:3000";
const evidenceDir = resolve(repoRoot, "docs/evidence");
await mkdir(evidenceDir, { recursive: true });

const browser = await chromium.launch();
try {
  const viewports = [
    { name: "desktop", width: 1440, height: 1100 },
    { name: "mobile", width: 390, height: 844 },
  ];
  let pdfUrl;

  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    await page.goto(`${baseUrl}/diagnostico`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Generar referencia" }).click();
    await page.getByText(/ENN-PRE-/).waitFor();
    await page.screenshot({
      path: resolve(evidenceDir, `M3-diagnostic-${viewport.name}.png`),
      fullPage: true,
    });
    pdfUrl ??= await page.getByRole("link", { name: "Descargar PDF" }).getAttribute("href");
    await page.close();
  }

  const privacyPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await privacyPage.goto(`${baseUrl}/privacidad`, { waitUntil: "domcontentloaded" });
  await privacyPage.getByRole("heading", { level: 1, name: "Aviso de privacidad integral" }).waitFor();
  await privacyPage.screenshot({
    path: resolve(evidenceDir, "M3-privacy-draft-desktop.png"),
    fullPage: true,
  });
  await privacyPage.close();

  if (!pdfUrl) throw new Error("M3_PDF_URL_NOT_FOUND");
  const response = await fetch(new URL(pdfUrl, baseUrl));
  if (!response.ok || response.headers.get("content-type") !== "application/pdf") {
    throw new Error(`M3_PDF_FETCH_FAILED:${response.status}`);
  }
  const pdfBytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(resolve(evidenceDir, "M3-prequote-reference-synthetic.pdf"), pdfBytes);
  process.stdout.write(`M3_BROWSER_EVIDENCE_PASS ${viewports.length} diagnostic viewports 1 privacy viewport ${pdfBytes.length} PDF bytes\n`);
} finally {
  await browser.close();
}
