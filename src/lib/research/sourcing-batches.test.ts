import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ingestResearchBatchRpcSchema } from "@/lib/research/contracts";

const REPO = process.cwd();
const OUTPUT_DIR = path.join(REPO, "data/imports/research/sourcing-2026-08-26");
const SEED_BATCH = path.join(REPO, "data/imports/research/company-directory-seed-batch.json");
const ORGANIZATION_ID = "e0000000-0000-4000-8000-000000000001";

type Artifact = {
  headers: { "Idempotency-Key": string };
  destination: {
    endpoint: string;
    external_effects_executed: boolean;
    authorization_state: string;
    outreach_eligible_records: number;
  };
  request: {
    sourceName: string;
    sourceSha256: string;
    manifestSha256: string;
    rows: { externalRecordId: string; sourceRow: number; legalName: string }[];
  };
  reconciliation: Record<string, unknown>;
};

function loadJson(filePath: string): Artifact {
  return JSON.parse(readFileSync(filePath, "utf8")) as Artifact;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const index = JSON.parse(readFileSync(path.join(OUTPUT_DIR, "INDEX.json"), "utf8"));
const batchFiles = readdirSync(OUTPUT_DIR).filter((name) => name.startsWith("batch-")).sort();
const artifacts = batchFiles.map((name) => ({ name, artifact: loadJson(path.join(OUTPUT_DIR, name)) }));
const seed = loadJson(SEED_BATCH);
const everyBatch = [{ name: "company-directory-seed-batch.json", artifact: seed }, ...artifacts];

describe("batches de sourcing 2026-08-26 para /api/v1/research/imports", () => {
  it("el INDEX enumera exactamente los artefactos existentes, semillas incluidas", () => {
    expect(artifacts).toHaveLength(6);
    expect(index.post_order).toHaveLength(everyBatch.length);
    const indexed = index.post_order.map((entry: { path: string }) => path.basename(entry.path)).sort();
    expect(indexed).toEqual(everyBatch.map(({ name }) => name).sort());
  });

  it.each(everyBatch)("$name valida contra el contrato zod real de la ruta", ({ artifact }) => {
    const parsed = ingestResearchBatchRpcSchema.safeParse({
      organizationId: ORGANIZATION_ID,
      ...artifact.request,
      idempotencyKey: artifact.headers["Idempotency-Key"],
    });
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
    expect(artifact.request.rows.length).toBeGreaterThanOrEqual(1);
    expect(artifact.request.rows.length).toBeLessThanOrEqual(500);
  });

  it.each(everyBatch)("$name permanece research-only sin efectos externos", ({ artifact }) => {
    expect(artifact.destination.endpoint).toBe("/api/v1/research/imports");
    expect(artifact.destination.external_effects_executed).toBe(false);
    expect(artifact.destination.authorization_state).toBe("RESEARCH_ONLY_HOLD");
    expect(artifact.destination.outreach_eligible_records).toBe(0);
    expect(artifact.reconciliation.contacts).toBe(0);
    expect(artifact.reconciliation.leads).toBe(0);
    expect(artifact.reconciliation.opportunities).toBe(0);
  });

  it("las llaves de idempotencia derivan del request canónico", () => {
    for (const { artifact } of everyBatch) {
      const expected = createHash("sha256").update(stableJson(artifact.request)).digest("hex");
      expect(artifact.headers["Idempotency-Key"]).toBe(expected);
    }
  });

  it("cada batch tiene sourceSha256 propio (import_batches es único por fuente)", () => {
    const hashes = everyBatch.map(({ artifact }) => artifact.request.sourceSha256);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("los externalRecordId no chocan entre batches", () => {
    const ids = everyBatch.flatMap(({ artifact }) => artifact.request.rows.map((row) => row.externalRecordId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("los totales cuadran contra sus fuentes congeladas", () => {
    const bySlug = Object.fromEntries(artifacts.map(({ name, artifact }) => [name, artifact]));
    expect(bySlug["batch-tier1-top50.json"]!.request.rows).toHaveLength(50);
    expect(bySlug["batch-profepa-gto-qro.json"]!.request.rows).toHaveLength(65);
    expect(bySlug["batch-parques-industriales.json"]!.request.rows).toHaveLength(422);
    const denueTotal = artifacts
      .filter(({ name }) => name.startsWith("batch-denue-"))
      .reduce((sum, { artifact }) => sum + artifact.request.rows.length, 0);
    expect(denueTotal).toBe(1_294);
    expect(index.totals.rows).toBe(50 + 65 + 422 + 1_294);
  });

  it("las exclusiones quedan conciliadas con su marcador, nunca en silencio", () => {
    const profepa = artifacts.find(({ name }) => name === "batch-profepa-gto-qro.json")!.artifact;
    const cfe = profepa.reconciliation.excluded_cfe as { marker: string }[];
    expect(cfe).toHaveLength(19);
    expect(cfe.every((entry) => entry.marker === "EXCLUIDO_PARAESTATAL_CFE")).toBe(true);

    const denue = artifacts.find(({ name }) => name === "batch-denue-manufactura-parte-1.json")!.artifact;
    const excluded = denue.reconciliation.excluded_anexo_a as { legal_name: string; marker: string }[];
    const markers = excluded.map((entry) => `${entry.marker}:${entry.legal_name}`).sort();
    expect(markers).toEqual([
      "EXCLUIDO_ANEXO_A:LAPROBA EL AGUILA",
      "EXCLUIDO_ANEXO_A:POSCO MPPC",
      "EXCLUIDO_SIN_RAZON_SOCIAL:",
    ]);
  });
});
