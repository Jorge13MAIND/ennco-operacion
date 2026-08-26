import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseCsv } from "../src/lib/handoff/csv-roundtrip.ts";
import {
  canNormalizeDomain,
  canNormalizeLegalName,
  normalizeDomain,
} from "../src/lib/research/normalization.ts";

const DEFAULT_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCING_DIR = "data/imports/raw/sourcing-2026-08-26";
const OUTPUT_DIR = "data/imports/research/sourcing-2026-08-26";
const SEED_BATCH_PATH = "data/imports/research/company-directory-seed-batch.json";
const BUILDER_ID = "build-sourcing-batches-2026-08-26";
const SCHEMA_VERSION = "1.0.0";
const MAX_ROWS_PER_BATCH = 450;

// Fuentes congeladas (commit 29bf19a). El builder NO lee nada que no coincida.
const SOURCES = {
  tier1: { file: "tier1-top50.csv", sha256: "d696848a2b1be71ae0b8576d32406fd1d5ba923cca7826b639c6061ef4ba9f98" },
  profepa: { file: "profepa-gto-qro.csv", sha256: "f62c2383e138bd941fb03ec55f365aafc6b4b7ea5c3c4e21c946428f8e62c2ea" },
  parques: { file: "parques-industriales.csv", sha256: "96a7d890e03e4a43aa31f43b9d052d4e55cbb7d9a7dc3696c495fc874484be13" },
  denue: { file: "denue-gto-qro-manufactura-grande.csv", sha256: "7e7c1e7561b8dfdf43634e93881f07df3258c2fd18ecec0fa275bb3eeea4e88c" },
} as const;

// Dominios que nunca identifican a la empresa (el dedupe por dominio colapsaría
// empresas distintas sobre ellos).
const GENERIC_DOMAINS = new Set([
  "facebook.com", "instagram.com", "linkedin.com", "youtube.com", "x.com", "twitter.com",
  "google.com", "gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "yahoo.com.mx",
  "wixsite.com", "blogspot.com", "wordpress.com", "mercadolibre.com.mx", "linktr.ee",
]);

type BatchRow = {
  externalRecordId: string;
  sourceRow: number;
  rawFingerprint: string;
  legalName: string;
  primaryDomain: string | null;
  city: string | null;
  state: "GUANAJUATO" | "QUERETARO" | "OTHER" | "UNKNOWN";
  industrialPark: string | null;
  sector: string | null;
  sourceUrl: string | null;
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
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

function cleanText(value: string | undefined): string | null {
  const normalized = (value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function mapState(value: string | undefined): BatchRow["state"] {
  const normalized = (value ?? "").normalize("NFD").replace(/\p{M}+/gu, "").trim().toUpperCase();
  if (normalized === "GUANAJUATO") return "GUANAJUATO";
  if (normalized === "QUERETARO") return "QUERETARO";
  if (!normalized) return "UNKNOWN";
  return "OTHER";
}

function firstHttpUrl(value: string | undefined): string | null {
  for (const candidate of (value ?? "").split(";")) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    try {
      const parsed = new URL(trimmed);
      if (["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password) {
        return trimmed;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function corporateDomain(value: string | undefined): string | null {
  const raw = (value ?? "").trim().split(/\s+/u)[0] ?? "";
  if (!raw) return null;
  const candidates = [raw, raw.split("/")[0] ?? ""];
  for (const candidate of candidates) {
    if (candidate && canNormalizeDomain(candidate)) {
      const domain = normalizeDomain(candidate);
      const isGeneric = [...GENERIC_DOMAINS].some(
        (generic) => domain === generic || domain.endsWith(`.${generic}`),
      );
      return isGeneric ? null : domain;
    }
  }
  return null;
}

function requireLegalName(value: string | null, context: string): string {
  if (!value || !canNormalizeLegalName(value)) {
    throw new Error(`LEGAL_NAME_UNUSABLE en ${context}: ${JSON.stringify(value)}`);
  }
  return value;
}

function fingerprint(rawCells: Record<string, string>): string {
  return sha256(stableJson(rawCells));
}

async function loadSource(repo: string, source: { file: string; sha256: string }) {
  const filePath = path.join(repo, SOURCING_DIR, source.file);
  const buffer = await fs.readFile(filePath);
  if (sha256(buffer) !== source.sha256) {
    throw new Error(`La fuente ${source.file} no coincide con el SHA256 congelado`);
  }
  return parseCsv(buffer.toString("utf8"));
}

type BatchSpec = {
  slug: string;
  sourceName: string;
  sourceSha256: string;
  manifest: Record<string, unknown>;
  rows: BatchRow[];
  reconciliationExtra?: Record<string, unknown>;
};

function buildArtifact(spec: BatchSpec) {
  if (spec.rows.length < 1 || spec.rows.length > 500) {
    throw new Error(`Batch ${spec.slug} con ${spec.rows.length} filas fuera de rango [1, 500]`);
  }
  const identifierPattern = /^[a-z0-9][a-z0-9._:-]{0,199}$/u;
  const externalIds = new Set<string>();
  const sourceRows = new Set<number>();
  for (const row of spec.rows) {
    if (!identifierPattern.test(row.externalRecordId)) {
      throw new Error(`externalRecordId inválido en ${spec.slug}: ${row.externalRecordId}`);
    }
    if (externalIds.has(row.externalRecordId) || sourceRows.has(row.sourceRow)) {
      throw new Error(`Identidad de fila duplicada en ${spec.slug}: ${row.externalRecordId}`);
    }
    externalIds.add(row.externalRecordId);
    sourceRows.add(row.sourceRow);
  }
  const manifestSha256 = sha256(stableJson(spec.manifest));
  const request = {
    sourceName: spec.sourceName,
    sourceSha256: spec.sourceSha256,
    manifestSha256,
    rows: spec.rows,
  };
  const idempotencyKey = sha256(stableJson(request));
  return {
    schema_version: SCHEMA_VERSION,
    evidence_class: "historical_evidence",
    handling_class: "restricted_real_source_data",
    generated_from: { builder: BUILDER_ID, manifest: spec.manifest },
    destination: {
      endpoint: "/api/v1/research/imports",
      method: "POST",
      external_effects_executed: false,
      authorization_state: "RESEARCH_ONLY_HOLD",
      outreach_eligible_records: 0,
    },
    headers: { "Idempotency-Key": idempotencyKey },
    request,
    reconciliation: {
      source_records: spec.rows.length,
      contacts: 0,
      leads: 0,
      opportunities: 0,
      outreach_eligible_records: 0,
      ...spec.reconciliationExtra,
    },
    artifact_sha256: sha256(stableJson({ idempotencyKey, request })),
  };
}

async function build(repo: string) {
  const [tier1, profepa, parques, denue] = await Promise.all([
    loadSource(repo, SOURCES.tier1),
    loadSource(repo, SOURCES.profepa),
    loadSource(repo, SOURCES.parques),
    loadSource(repo, SOURCES.denue),
  ]);

  const specs: BatchSpec[] = [];

  specs.push({
    slug: "tier1-top50",
    sourceName: "ENNCO sourcing 2026-08-26 Tier 1 top 50",
    sourceSha256: SOURCES.tier1.sha256,
    manifest: { builder: BUILDER_ID, source_file: SOURCES.tier1.file, file_sha256: SOURCES.tier1.sha256, part: 1, parts: 1 },
    rows: tier1.rows.map((row, index) => ({
      externalRecordId: `tier1-20260826:${String(index + 1).padStart(3, "0")}`,
      sourceRow: index + 2,
      rawFingerprint: fingerprint(row),
      legalName: requireLegalName(cleanText(row.razon_social) ?? cleanText(row.empresa), `tier1 fila ${index + 2}`),
      primaryDomain: null,
      city: cleanText(row.municipio),
      state: mapState(row.estado),
      industrialPark: cleanText(row.parque_industrial),
      sector: cleanText([
        row.scian ? `SCIAN ${row.scian}` : "",
        row.actividad ?? "",
        row.estrato_personal ?? "",
      ].filter(Boolean).join(" · ")),
      sourceUrl: firstHttpUrl(row.source_urls),
    })),
  });

  // La CFE certifica sus propias subestaciones en el PNAA; la paraestatal no es
  // prospecto de venta de energía solar.
  const isCfeFacility = (name: string): boolean => {
    const flattened = name.normalize("NFD").replace(/\p{M}+/gu, "").toUpperCase();
    return flattened.startsWith("CFE ") || flattened.startsWith("CFE,")
      || flattened.includes("COMISION FEDERAL DE ELECTRICIDAD");
  };
  const profepaExcluded: { source_row: number; legal_name: string; marker: string }[] = [];
  const profepaRows: BatchRow[] = [];
  profepa.rows.forEach((row, index) => {
    const sourceRow = index + 2;
    const rawName = cleanText(row.razon_social) ?? "";
    if (isCfeFacility(rawName)) {
      profepaExcluded.push({
        source_row: sourceRow,
        legal_name: rawName.slice(0, 240),
        marker: "EXCLUIDO_PARAESTATAL_CFE",
      });
      return;
    }
    profepaRows.push({
      externalRecordId: `profepa-20260826:${String(sourceRow).padStart(3, "0")}`,
      sourceRow,
      rawFingerprint: fingerprint(row),
      legalName: requireLegalName(rawName, `profepa fila ${sourceRow}`),
      primaryDomain: null,
      city: cleanText(row.municipio),
      state: mapState(row.estado),
      industrialPark: null,
      sector: cleanText([
        row.giro_actividad ?? "",
        row.tipo_certificado
          ? `Certificado PNAA ${row.tipo_certificado} (${row.estatus_padron || "estatus no publicado"}, vigencia ${row.vigencia || "no publicada"})`
          : "",
      ].filter(Boolean).join(" · ")),
      sourceUrl: firstHttpUrl(row.source_url),
    });
  });
  specs.push({
    slug: "profepa-gto-qro",
    sourceName: "ENNCO sourcing 2026-08-26 PROFEPA PNAA GTO-QRO",
    sourceSha256: SOURCES.profepa.sha256,
    manifest: { builder: BUILDER_ID, source_file: SOURCES.profepa.file, file_sha256: SOURCES.profepa.sha256, part: 1, parts: 1 },
    reconciliationExtra: {
      excluded_cfe: profepaExcluded,
      source_rows_total: profepa.rows.length,
      ingestable_rows_total: profepaRows.length,
    },
    rows: profepaRows,
  });

  specs.push({
    slug: "parques-industriales",
    sourceName: "ENNCO sourcing 2026-08-26 parques industriales GTO-QRO",
    sourceSha256: SOURCES.parques.sha256,
    manifest: { builder: BUILDER_ID, source_file: SOURCES.parques.file, file_sha256: SOURCES.parques.sha256, part: 1, parts: 1 },
    rows: parques.rows.map((row, index) => ({
      externalRecordId: `parque-20260826:${String(index + 1).padStart(3, "0")}`,
      sourceRow: index + 2,
      rawFingerprint: fingerprint(row),
      legalName: requireLegalName(cleanText(row.empresa), `parques fila ${index + 2}`),
      primaryDomain: null,
      city: cleanText(row.municipio),
      state: mapState(row.estado ?? ""),
      industrialPark: cleanText(row.parque),
      sector: cleanText(row.giro),
      sourceUrl: firstHttpUrl(row.source_url),
    })),
  });

  const denueExcluded: { source_row: number; legal_name: string; marker: string }[] = [];
  const denueRows: BatchRow[] = [];
  denue.rows.forEach((row, index) => {
    const sourceRow = index + 2;
    const nameCandidate = cleanText(row.razon_social) ?? cleanText(row.nombre_unidad);
    if (!nameCandidate) {
      // El DENUE anonimiza algunos establecimientos; sin razón social no se
      // inventa identidad.
      denueExcluded.push({ source_row: sourceRow, legal_name: "", marker: "EXCLUIDO_SIN_RAZON_SOCIAL" });
      return;
    }
    const legalName = requireLegalName(nameCandidate, `denue fila ${sourceRow}`);
    const exclusion = cleanText(row.exclusion_anexo_a);
    if (exclusion) {
      denueExcluded.push({ source_row: sourceRow, legal_name: legalName, marker: exclusion });
      return;
    }
    denueRows.push({
      externalRecordId: `denue-20260826:${String(index + 1).padStart(4, "0")}`,
      sourceRow,
      rawFingerprint: fingerprint(row),
      legalName,
      primaryDomain: corporateDomain(row.www),
      city: cleanText(row.municipio),
      state: mapState(row.estado),
      industrialPark: null,
      sector: cleanText([
        row.scian_codigo ? `SCIAN ${row.scian_codigo}` : "",
        row.scian_descripcion ?? "",
        row.estrato_personal ?? "",
      ].filter(Boolean).join(" · ")),
      sourceUrl: firstHttpUrl(row.source_url),
    });
  });

  const parts = Math.ceil(denueRows.length / MAX_ROWS_PER_BATCH);
  for (let part = 0; part < parts; part += 1) {
    const slice = denueRows.slice(part * MAX_ROWS_PER_BATCH, (part + 1) * MAX_ROWS_PER_BATCH);
    const manifest = {
      builder: BUILDER_ID,
      source_file: SOURCES.denue.file,
      file_sha256: SOURCES.denue.sha256,
      part: part + 1,
      parts,
      source_rows: slice.map((row) => row.sourceRow),
    };
    specs.push({
      slug: `denue-manufactura-parte-${part + 1}`,
      sourceName: `ENNCO sourcing 2026-08-26 DENUE manufactura 101+ (parte ${part + 1}/${parts})`,
      // import_batches es único por (org, source_sha256): cada parte necesita un
      // sha propio y derivable solo de la fuente congelada.
      sourceSha256: sha256(stableJson({ file_sha256: SOURCES.denue.sha256, part: part + 1, parts, rows: slice })),
      manifest,
      reconciliationExtra: part === 0
        ? {
          excluded_anexo_a: denueExcluded,
          source_rows_total: denue.rows.length,
          ingestable_rows_total: denueRows.length,
        }
        : undefined,
      rows: slice,
    });
  }

  const artifacts = specs.map((spec) => ({ slug: spec.slug, artifact: buildArtifact(spec) }));

  const seedBatch = JSON.parse(await fs.readFile(path.join(repo, SEED_BATCH_PATH), "utf8"));
  const allSourceHashes = [
    seedBatch.request.sourceSha256,
    ...artifacts.map(({ artifact }) => artifact.request.sourceSha256),
  ];
  if (new Set(allSourceHashes).size !== allSourceHashes.length) {
    throw new Error("Colisión de sourceSha256 entre batches (import_batches es único por fuente)");
  }
  const allExternalIds = artifacts.flatMap(({ artifact }) =>
    artifact.request.rows.map((row: BatchRow) => row.externalRecordId),
  );
  if (new Set(allExternalIds).size !== allExternalIds.length) {
    throw new Error("externalRecordId repetido entre batches");
  }

  const index = {
    schema_version: SCHEMA_VERSION,
    builder: BUILDER_ID,
    post_order: [
      { order: 1, path: SEED_BATCH_PATH, note: "27 semillas del directorio (batch previo, aún sin ejecutar)" },
      ...artifacts.map(({ slug, artifact }, position) => ({
        order: position + 2,
        path: `${OUTPUT_DIR}/batch-${slug}.json`,
        source_name: artifact.request.sourceName,
        rows: artifact.request.rows.length,
        idempotency_key: artifact.headers["Idempotency-Key"],
      })),
    ],
    totals: {
      batches: artifacts.length,
      rows: artifacts.reduce((sum, { artifact }) => sum + artifact.request.rows.length, 0),
      excluded_anexo_a: denueExcluded.length,
      excluded_cfe: profepaExcluded.length,
    },
  };

  return { artifacts, index };
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const args = process.argv.slice(2);
const repoIndex = args.indexOf("--repo");
const repo = path.resolve(repoIndex >= 0 ? args[repoIndex + 1]! : DEFAULT_REPO);
const check = args.includes("--check");

const { artifacts, index } = await build(repo);
const outputs = [
  ...artifacts.map(({ slug, artifact }) => ({
    filePath: path.join(repo, OUTPUT_DIR, `batch-${slug}.json`),
    content: serialize(artifact),
  })),
  { filePath: path.join(repo, OUTPUT_DIR, "INDEX.json"), content: serialize(index) },
];

if (check) {
  for (const output of outputs) {
    const existing = await fs.readFile(output.filePath, "utf8");
    if (existing !== output.content) {
      throw new Error(`${path.relative(repo, output.filePath)} no coincide con las fuentes canónicas`);
    }
  }
  process.stdout.write(
    `SOURCING_BATCHES_PASS ${index.totals.batches} batches ${index.totals.rows} filas ` +
    `(${index.totals.excluded_anexo_a} anexo-a + ${index.totals.excluded_cfe} cfe excluidas) HOLD 0 eligible\n`,
  );
} else {
  await fs.mkdir(path.join(repo, OUTPUT_DIR), { recursive: true });
  for (const output of outputs) {
    await fs.writeFile(output.filePath, output.content, "utf8");
    process.stdout.write(`${path.relative(repo, output.filePath)}\n`);
  }
}
