import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_PATH = "data/imports/research/company-directory-seed-batch.json";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseArgs(argv) {
  const args = { repo: DEFAULT_REPO, check: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--repo") {
      args.repo = path.resolve(argv[index + 1]);
      index += 1;
    } else if (argv[index] === "--check") {
      args.check = true;
    } else {
      throw new Error(`Argumento no reconocido: ${argv[index]}`);
    }
  }
  return args;
}

function stateValue(value) {
  const normalized = String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toUpperCase();
  if (normalized === "GUANAJUATO") return "GUANAJUATO";
  if (normalized === "QUERETARO") return "QUERETARO";
  if (!normalized || normalized === "POR VERIFICAR") return "UNKNOWN";
  return "OTHER";
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function failClosedSourceAssertions(directory) {
  if (directory.length !== 27) throw new Error(`Se esperaban 27 semillas y llegaron ${directory.length}`);
  if (directory.some((row) => row.commercial_state !== "RESEARCH_SEED" || row.outreach_eligible !== false)) {
    throw new Error("La fuente dejó de ser research-only o contiene elegibilidad comercial");
  }
  if (new Set(directory.map((row) => row.record_id)).size !== directory.length) {
    throw new Error("La fuente contiene record_id duplicado");
  }
}

async function build(repo) {
  const manifestPath = path.join(repo, "data/imports/manifest.json");
  const directoryPath = path.join(repo, "data/imports/normalized/company_directory.json");
  const manifestBytes = await fs.readFile(manifestPath);
  const directoryBytes = await fs.readFile(directoryPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const directory = JSON.parse(directoryBytes.toString("utf8"));
  failClosedSourceAssertions(directory);
  if (sha256(directoryBytes) !== manifest.datasets.directoryJson.sha256) {
    throw new Error("El directorio normalizado no coincide con el manifest canónico");
  }

  const rows = directory.map((row) => ({
    externalRecordId: row.record_id,
    sourceRow: row.source_row,
    rawFingerprint: row.raw_row_fingerprint,
    legalName: row.company_name_normalized,
    primaryDomain: null,
    city: row.municipality_normalized,
    state: stateValue(row.state_normalized),
    industrialPark: row.industrial_park_normalized,
    sector: row.sector_note_normalized,
    sourceUrl: row.source_url,
  }));
  const request = {
    sourceName: "ENNCO company directory seed",
    sourceSha256: manifest.sources.directory.source_sha256,
    manifestSha256: sha256(manifestBytes),
    rows,
  };
  const idempotencyKey = sha256(stableJson(request));
  const quarantineCount = directory.filter((row) => row.quarantine_status !== "CLEAR_FOR_RESEARCH").length;
  return {
    schema_version: "1.0.0",
    evidence_class: "historical_evidence",
    handling_class: "restricted_real_source_data",
    generated_from: {
      manifest_path: "data/imports/manifest.json",
      directory_path: "data/imports/normalized/company_directory.json",
      directory_sha256: manifest.datasets.directoryJson.sha256,
    },
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
      source_records: directory.length,
      clear_for_research: directory.length - quarantineCount,
      quarantined_at_source: quarantineCount,
      contacts: 0,
      leads: 0,
      opportunities: 0,
      outreach_eligible_records: 0,
    },
    artifact_sha256: sha256(stableJson({ idempotencyKey, request })),
  };
}

const args = parseArgs(process.argv.slice(2));
const artifact = await build(args.repo);
const output = `${JSON.stringify(artifact, null, 2)}\n`;
const outputPath = path.join(args.repo, OUTPUT_PATH);
if (args.check) {
  const existing = await fs.readFile(outputPath, "utf8");
  if (existing !== output) throw new Error(`${OUTPUT_PATH} no coincide con las fuentes canónicas`);
  process.stdout.write(`RESEARCH_SEED_BATCH_PASS ${artifact.reconciliation.source_records}/27 HOLD 0 eligible\n`);
} else {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, output, "utf8");
  process.stdout.write(`${OUTPUT_PATH}\n`);
}
