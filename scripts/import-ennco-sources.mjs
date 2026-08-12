import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = "1.0.0";
const DEFAULT_REPO = "/Users/Jorge/dev/ennco-revenue-platform";
const DEFAULT_ARTIFACT_TOOL_ROOT =
  "/Users/Jorge/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool";
const SOURCE_DEFINITIONS = {
  historicalProjects: {
    id: "historical_projects",
    path: "/Users/Jorge/Downloads/clientes....xlsx",
    sheet: "Hoja1",
    range: "D7:I28",
    dataStartRow: 9,
  },
  companyDirectory: {
    id: "company_directory_seed",
    path: "/Users/Jorge/Downloads/Directorio_Empresas_Corredor_Leon_Queretaro.xlsx",
    sheet: "Directorio corredor",
    range: "A1:H28",
    dataStartRow: 2,
    summarySheet: "Resumen",
    summaryRange: "A1:B8",
  },
};

function parseArgs(argv) {
  const args = {
    repo: DEFAULT_REPO,
    artifactToolRoot: process.env.ENNCO_ARTIFACT_TOOL_ROOT ?? DEFAULT_ARTIFACT_TOOL_ROOT,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--repo") {
      args.repo = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--artifact-tool-root") {
      args.artifactToolRoot = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Argumento no reconocido: ${argv[index]}`);
    }
  }
  return args;
}

function normalizeWhitespace(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function normalizedKey(value) {
  const text = normalizeWhitespace(value);
  if (!text) return null;
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\b(SA|S DE RL|DE CV|SAPI|SOCIEDAD ANONIMA)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, "")
    .trim();
}

function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function sha256Text(text) {
  return sha256Buffer(Buffer.from(text, "utf8"));
}

async function sha256File(filePath) {
  return sha256Buffer(await fs.readFile(filePath));
}

function deterministicId(prefix, ...parts) {
  return `${prefix}_${sha256Text(parts.join("|" )).slice(0, 20)}`;
}

function excelSerialToIso(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const epoch = Date.UTC(1899, 11, 30);
  return new Date(epoch + Math.trunc(value) * 86_400_000).toISOString().slice(0, 10);
}

function round(value, decimals = 2) {
  const scale = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
}

function quartiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  const lower = sorted.slice(0, midpoint);
  const upper = sorted.slice(sorted.length % 2 === 0 ? midpoint : midpoint + 1);
  return { q1: median(lower), q3: median(upper) };
}

function levenshtein(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const saved = previous[rightIndex];
      const substitution = diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        substitution,
      );
      diagonal = saved;
    }
  }
  return previous[right.length];
}

function similarity(left, right) {
  const maxLength = Math.max(left.length, right.length);
  return maxLength === 0 ? 1 : 1 - levenshtein(left, right) / maxLength;
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const serialized = Array.isArray(value) ? value.join("|") : String(value);
  return /[",\r\n]/.test(serialized) ? `"${serialized.replaceAll('"', '""')}"` : serialized;
}

function toCsv(records, columns) {
  const lines = [columns.join(",")];
  for (const record of records) {
    lines.push(columns.map((column) => csvEscape(record[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

async function loadArtifactToolVersion(artifactToolRoot) {
  const packagePath = path.join(artifactToolRoot, "package.json");
  const packageJson = JSON.parse(await fs.readFile(packagePath, "utf8"));
  return packageJson.version;
}

async function inspectSource(definition, artifactTool) {
  const { FileBlob, SpreadsheetFile } = artifactTool;
  const sourceBuffer = await fs.readFile(definition.path);
  const sourceStat = await fs.stat(definition.path);
  const sourceHash = sha256Buffer(sourceBuffer);
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(definition.path));
  const sheet = workbook.worksheets.getItem(definition.sheet);
  const range = sheet.getRange(definition.range);
  const extracted = {
    schema_version: SCHEMA_VERSION,
    source_id: definition.id,
    source_file: definition.path,
    source_sha256: sourceHash,
    source_size_bytes: sourceBuffer.byteLength,
    source_mtime_utc: sourceStat.mtime.toISOString(),
    ranges: [
      {
        sheet: definition.sheet,
        range: definition.range,
        values: range.values,
        formulas: range.formulas,
      },
    ],
  };

  if (definition.summarySheet && definition.summaryRange) {
    const summaryRange = workbook.worksheets
      .getItem(definition.summarySheet)
      .getRange(definition.summaryRange);
    extracted.ranges.push({
      sheet: definition.summarySheet,
      range: definition.summaryRange,
      values: summaryRange.values,
      formulas: summaryRange.formulas,
    });
  }

  return { sourceBuffer, sourceHash, sourceStat, extracted };
}

function normalizeHistoricalProjects(extracted) {
  const table = extracted.ranges[0];
  const rows = table.values.slice(2);
  const formulaRows = table.formulas.slice(2);

  const preliminary = rows.map((row, index) => {
    const sourceRow = SOURCE_DEFINITIONS.historicalProjects.dataStartRow + index;
    const capacityRaw = row[4];
    const capacityWp = typeof capacityRaw === "number" ? capacityRaw : null;
    const salesMxn = typeof row[1] === "number" ? round(row[1], 2) : null;
    const workType = normalizeWhitespace(row[5]);
    const isPhotovoltaic = workType === "INSTALACION FOTOVOLTAICA";
    const salePerKwp = isPhotovoltaic && capacityWp > 0
      ? round(salesMxn / (capacityWp / 1000), 2)
      : null;

    return {
      record_id: deterministicId(
        "hist",
        extracted.source_sha256,
        SOURCE_DEFINITIONS.historicalProjects.sheet,
        sourceRow,
      ),
      source_sha256: extracted.source_sha256,
      source_sheet: SOURCE_DEFINITIONS.historicalProjects.sheet,
      source_row: sourceRow,
      project_name_raw: row[0] ?? null,
      project_name_normalized: normalizeWhitespace(row[0]),
      project_key: normalizedKey(row[0]),
      sales_mxn: salesMxn,
      payment_date_excel_serial: typeof row[2] === "number" ? row[2] : null,
      payment_date_iso: excelSerialToIso(row[2]),
      zone_raw: row[3] ?? null,
      zone_normalized: normalizeWhitespace(row[3]),
      capacity_raw_value: capacityRaw ?? null,
      capacity_raw_header: "TAMAÑO kWp",
      capacity_wp: capacityWp,
      capacity_kwp: capacityWp === null ? null : round(capacityWp / 1000, 3),
      capacity_formula: formulaRows[index]?.[4] || null,
      capacity_normalization_rule: capacityWp === null
        ? "not_applicable_for_non_pv_work"
        : "source_value_interpreted_as_wp_then_divided_by_1000_for_kwp",
      work_type_raw: row[5] ?? null,
      work_type_normalized: workType,
      sale_per_kwp_mxn: salePerKwp,
      model_calibration_status: isPhotovoltaic ? "candidate_pending_qa" : "not_applicable",
      commercial_state: "HISTORICAL_EVIDENCE",
      qa_flags: [],
    };
  });

  const ratios = preliminary
    .map((record) => record.sale_per_kwp_mxn)
    .filter((value) => typeof value === "number");
  const { q1, q3 } = quartiles(ratios);
  const upperFence = q3 + 1.5 * (q3 - q1);

  for (const record of preliminary) {
    if (!record.payment_date_iso) record.qa_flags.push("missing_payment_date");
    if (record.capacity_wp === null) record.qa_flags.push("capacity_not_applicable");
    if (record.sale_per_kwp_mxn !== null && record.sale_per_kwp_mxn > upperFence) {
      record.qa_flags.push("sale_per_kwp_high_outlier_review");
      record.model_calibration_status = "manual_review_excluded";
    } else if (record.model_calibration_status === "candidate_pending_qa") {
      record.model_calibration_status = "candidate_preserved_not_approved";
    }
  }

  return {
    records: preliminary,
    qa: {
      sale_per_kwp_q1_mxn: round(q1, 2),
      sale_per_kwp_q3_mxn: round(q3, 2),
      sale_per_kwp_upper_fence_mxn: round(upperFence, 2),
      outlier_method: "Tukey upper fence Q3 + 1.5 * IQR",
    },
  };
}

function normalizeCompanyDirectory(extracted) {
  const rows = extracted.ranges[0].values.slice(1);
  const records = rows.map((row, index) => {
    const sourceRow = SOURCE_DEFINITIONS.companyDirectory.dataStartRow + index;
    const rawValues = row.map((value) => normalizeWhitespace(value));
    const [sourceNumber, company, municipality, state, park, address, sector, sourceUrl] = row;
    const locationNeedsVerification = [municipality, state, park, address]
      .some((value) => normalizeWhitespace(value)?.toUpperCase() === "POR VERIFICAR");
    const sourceMissing = !normalizeWhitespace(sourceUrl);
    const qaFlags = [];
    if (sourceMissing) qaFlags.push("missing_source_url");
    if (locationNeedsVerification) qaFlags.push("location_verification_required");
    if (!normalizeWhitespace(sector)) qaFlags.push("missing_sector");

    return {
      record_id: deterministicId(
        "company",
        extracted.source_sha256,
        SOURCE_DEFINITIONS.companyDirectory.sheet,
        sourceRow,
      ),
      source_sha256: extracted.source_sha256,
      source_sheet: SOURCE_DEFINITIONS.companyDirectory.sheet,
      source_row: sourceRow,
      source_number: typeof sourceNumber === "number" ? sourceNumber : Number(sourceNumber),
      company_name_raw: company ?? null,
      company_name_normalized: normalizeWhitespace(company),
      company_key: normalizedKey(company),
      municipality_raw: municipality ?? null,
      municipality_normalized: normalizeWhitespace(municipality),
      state_raw: state ?? null,
      state_normalized: normalizeWhitespace(state),
      industrial_park_raw: park ?? null,
      industrial_park_normalized: normalizeWhitespace(park),
      address_raw: address ?? null,
      address_normalized: normalizeWhitespace(address),
      sector_note_raw: sector ?? null,
      sector_note_normalized: normalizeWhitespace(sector),
      source_url: normalizeWhitespace(sourceUrl),
      research_status: "UNVERIFIED_SEED",
      commercial_state: "RESEARCH_SEED",
      outreach_eligible: false,
      quarantine_status: "CLEAR_FOR_RESEARCH",
      quarantine_reason: null,
      duplicate_candidate_group: null,
      qa_flags: qaFlags,
      raw_row_fingerprint: sha256Text(JSON.stringify(rawValues)),
    };
  });

  const explicitlyFlagged = records.filter((record) =>
    record.sector_note_normalized?.toLowerCase().includes("duplicado"),
  );

  const duplicatePairs = [];
  for (const flagged of explicitlyFlagged) {
    const candidates = records
      .filter((record) => record.record_id !== flagged.record_id)
      .map((record) => ({
        record,
        score: similarity(flagged.company_key ?? "", record.company_key ?? ""),
      }))
      .sort((left, right) => right.score - left.score);
    const best = candidates[0];
    if (best && best.score >= 0.75) {
      const groupId = deterministicId("dup", flagged.record_id, best.record.record_id);
      for (const record of [flagged, best.record]) {
        record.quarantine_status = "QUARANTINED";
        record.quarantine_reason = "possible_duplicate_requires_human_resolution";
        record.duplicate_candidate_group = groupId;
        if (!record.qa_flags.includes("possible_duplicate")) record.qa_flags.push("possible_duplicate");
      }
      duplicatePairs.push({
        duplicate_candidate_group: groupId,
        left_record_id: best.record.record_id,
        left_company: best.record.company_name_normalized,
        right_record_id: flagged.record_id,
        right_company: flagged.company_name_normalized,
        similarity_score: round(best.score, 4),
        resolution_status: "UNKNOWN_REQUIRES_HUMAN_REVIEW",
      });
    }
  }

  for (const record of records) {
    if (record.qa_flags.includes("location_verification_required") && record.quarantine_status !== "QUARANTINED") {
      record.quarantine_status = "QUARANTINED";
      record.quarantine_reason = "incomplete_location_requires_human_verification";
    }
  }

  const quarantine = records
    .filter((record) => record.quarantine_status === "QUARANTINED")
    .map((record) => ({
      record_id: record.record_id,
      source_row: record.source_row,
      source_number: record.source_number,
      company_name: record.company_name_normalized,
      quarantine_reason: record.quarantine_reason,
      duplicate_candidate_group: record.duplicate_candidate_group,
      qa_flags: record.qa_flags,
      resolution_status: "UNKNOWN_REQUIRES_HUMAN_REVIEW",
    }));

  return { records, quarantine, duplicatePairs };
}

function historicalStats(records, qa) {
  const pv = records.filter((record) => record.work_type_normalized === "INSTALACION FOTOVOLTAICA");
  const maintenance = records.filter((record) => record.work_type_normalized === "MANTENIMIENTO ELECTRICO");
  const projectKeys = records.map((record) => record.project_key);
  return {
    source_records: records.length,
    photovoltaic_records: pv.length,
    maintenance_records: maintenance.length,
    total_sales_mxn: round(records.reduce((sum, record) => sum + (record.sales_mxn ?? 0), 0), 2),
    photovoltaic_sales_mxn: round(pv.reduce((sum, record) => sum + (record.sales_mxn ?? 0), 0), 2),
    maintenance_sales_mxn: round(maintenance.reduce((sum, record) => sum + (record.sales_mxn ?? 0), 0), 2),
    payment_dates_present: records.filter((record) => record.payment_date_iso).length,
    payment_dates_missing: records.filter((record) => !record.payment_date_iso).length,
    capacity_wp_total: records.reduce((sum, record) => sum + (record.capacity_wp ?? 0), 0),
    capacity_kwp_total: round(records.reduce((sum, record) => sum + (record.capacity_kwp ?? 0), 0), 3),
    exact_duplicate_project_keys: projectKeys.length - new Set(projectKeys).size,
    manual_review_outliers: records.filter((record) => record.model_calibration_status === "manual_review_excluded").length,
    manual_review_project_names: records
      .filter((record) => record.model_calibration_status === "manual_review_excluded")
      .map((record) => record.project_name_normalized),
    ...qa,
  };
}

function directoryStats(records, quarantine, duplicatePairs, extracted) {
  const providedSummary = Object.fromEntries(
    extracted.ranges[1].values.slice(1).map(([label, count]) => [String(label), Number(count)]),
  );
  return {
    source_records: records.length,
    source_urls_present: records.filter((record) => record.source_url).length,
    source_urls_missing: records.filter((record) => !record.source_url).length,
    location_verification_required: records.filter((record) =>
      record.qa_flags.includes("location_verification_required"),
    ).length,
    quarantined_records: quarantine.length,
    possible_duplicate_pairs: duplicatePairs.length,
    outreach_eligible_records: records.filter((record) => record.outreach_eligible).length,
    provided_summary: providedSummary,
  };
}

function buildQaReport({ artifactToolVersion, sources, historical, directory }) {
  const historicalStatsValue = historical.stats;
  const directoryStatsValue = directory.stats;
  const duplicate = directory.duplicatePairs[0];
  const outliers = historicalStatsValue.manual_review_project_names.join(", ") || "ninguno";
  const duplicateText = duplicate
    ? `${duplicate.left_company} / ${duplicate.right_company}, similitud ${duplicate.similarity_score}`
    : "ninguno";

  return `# QA de importación de fuentes ENNCO\n\n` +
    `## Estado\n\n` +
    `PASS para extracción y normalización reproducible. Los registros en cuarentena permanecen bloqueados para outreach y requieren resolución humana.\n\n` +
    `## Herramienta y alcance\n\n` +
    `- Lector obligatorio: \`@oai/artifact-tool\` ${artifactToolVersion}.\n` +
    `- Se conservaron copias binarias exactas y extracciones de valores y fórmulas.\n` +
    `- Sólo se normalizaron rangos tabulares declarados. Las hojas gráficas permanecen preservadas dentro del XLSX raw.\n` +
    `- No se generaron contactos, leads, oportunidades ni pipeline.\n\n` +
    `## Fuentes congeladas\n\n` +
    `| Fuente | SHA256 | Tamaño | Rango estructurado |\n` +
    `|---|---|---:|---|\n` +
    `| clientes....xlsx | ${sources.historical.source_sha256} | ${sources.historical.source_size_bytes} bytes | Hoja1!D7:I28 |\n` +
    `| Directorio_Empresas_Corredor_Leon_Queretaro.xlsx | ${sources.directory.source_sha256} | ${sources.directory.source_size_bytes} bytes | Directorio corredor!A1:H28; Resumen!A1:B8 |\n\n` +
    `## Histórico de proyectos\n\n` +
    `- Registros: ${historicalStatsValue.source_records}.\n` +
    `- Ventas totales: $${historicalStatsValue.total_sales_mxn.toFixed(2)} MXN.\n` +
    `- Fotovoltaicos: ${historicalStatsValue.photovoltaic_records}; mantenimiento eléctrico: ${historicalStatsValue.maintenance_records}.\n` +
    `- Fechas presentes: ${historicalStatsValue.payment_dates_present}; faltantes: ${historicalStatsValue.payment_dates_missing}.\n` +
    `- Capacidad normalizada: ${historicalStatsValue.capacity_wp_total} Wp = ${historicalStatsValue.capacity_kwp_total} kWp.\n` +
    `- Duplicados exactos por clave de proyecto: ${historicalStatsValue.exact_duplicate_project_keys}.\n` +
    `- Outliers de venta por kWp para revisión manual: ${outliers}. Se preservan, pero quedan excluidos de calibración automática.\n\n` +
    `### Corrección de unidad\n\n` +
    `La fuente etiqueta la columna como \`TAMAÑO kWp\`, pero las fórmulas son multiplicaciones de cantidad de paneles por potencia nominal, por ejemplo \`=4*620\` y \`=85*645\`. Por ello, la capa normalizada conserva el valor como \`capacity_wp\` y deriva \`capacity_kwp = capacity_wp / 1000\`. El valor raw, encabezado y fórmula quedan preservados.\n\n` +
    `## Directorio de empresas\n\n` +
    `- Registros fuente: ${directoryStatsValue.source_records}.\n` +
    `- URLs presentes: ${directoryStatsValue.source_urls_present}; faltantes: ${directoryStatsValue.source_urls_missing}.\n` +
    `- Filas con ubicación marcada \"Por verificar\": ${directoryStatsValue.location_verification_required}.\n` +
    `- Registros en cuarentena: ${directoryStatsValue.quarantined_records}.\n` +
    `- Posible duplicado: ${duplicateText}.\n` +
    `- Registros habilitados para outreach: ${directoryStatsValue.outreach_eligible_records}.\n\n` +
    `Todos los registros permanecen en \`RESEARCH_SEED\`. La existencia de una empresa en el directorio no prueba elegibilidad, contacto verificado, interés, lead o pipeline.\n\n` +
    `## Bloqueos humanos\n\n` +
    `- Resolver las cinco filas marcadas \"Por verificar\".\n` +
    `- Resolver si WELDCOAT y HEWELDCOAT son la misma entidad, alias o empresas distintas.\n` +
    `- Verificar las ${directoryStatsValue.source_urls_missing} empresas sin URL fuente.\n` +
    `- Conciliar contra Anexo A antes de habilitar cualquier registro para outreach.\n` +
    `- Validar con Paco los proyectos excluidos de calibración automática.\n`;
}

const { repo, artifactToolRoot } = parseArgs(process.argv.slice(2));
const generatedAtUtc = new Date().toISOString();
const artifactTool = await import(
  pathToFileURL(path.join(artifactToolRoot, "dist/artifact_tool.mjs")).href
);
const artifactToolVersion = await loadArtifactToolVersion(artifactToolRoot);
const historicalSource = await inspectSource(SOURCE_DEFINITIONS.historicalProjects, artifactTool);
const directorySource = await inspectSource(SOURCE_DEFINITIONS.companyDirectory, artifactTool);

const historical = normalizeHistoricalProjects(historicalSource.extracted);
historical.stats = historicalStats(historical.records, historical.qa);
const directory = normalizeCompanyDirectory(directorySource.extracted);
directory.stats = directoryStats(
  directory.records,
  directory.quarantine,
  directory.duplicatePairs,
  directorySource.extracted,
);

const rawDefinitions = [
  { key: "historical", definition: SOURCE_DEFINITIONS.historicalProjects, inspected: historicalSource },
  { key: "directory", definition: SOURCE_DEFINITIONS.companyDirectory, inspected: directorySource },
];
const manifestSources = {};

for (const source of rawDefinitions) {
  const rawBase = path.join(
    repo,
    "data/imports/raw",
    source.definition.id,
    source.inspected.sourceHash,
  );
  const rawWorkbook = path.join(rawBase, path.basename(source.definition.path));
  const rawExtract = path.join(rawBase, "extracted.json");
  await fs.mkdir(rawBase, { recursive: true });
  await fs.copyFile(source.definition.path, rawWorkbook);
  await writeJson(rawExtract, source.inspected.extracted);
  manifestSources[source.key] = {
    source_id: source.definition.id,
    source_path: source.definition.path,
    source_sha256: source.inspected.sourceHash,
    source_size_bytes: source.inspected.sourceBuffer.byteLength,
    source_mtime_utc: source.inspected.sourceStat.mtime.toISOString(),
    raw_workbook: path.relative(repo, rawWorkbook),
    raw_extraction: path.relative(repo, rawExtract),
    structured_ranges: source.inspected.extracted.ranges.map(({ sheet, range }) => ({ sheet, range })),
  };
}

const outputs = {
  historicalJson: "data/imports/normalized/historical_projects.json",
  historicalCsv: "data/imports/normalized/historical_projects.csv",
  directoryJson: "data/imports/normalized/company_directory.json",
  directoryCsv: "data/imports/normalized/company_directory.csv",
  quarantineJson: "data/imports/quarantine/company_directory_quarantine.json",
  quarantineCsv: "data/imports/quarantine/company_directory_quarantine.csv",
  duplicateCandidatesJson: "data/imports/quarantine/duplicate_candidates.json",
};

const historicalColumns = Object.keys(historical.records[0]);
const directoryColumns = Object.keys(directory.records[0]);
const quarantineColumns = Object.keys(directory.quarantine[0]);

await writeJson(path.join(repo, outputs.historicalJson), historical.records);
await writeText(path.join(repo, outputs.historicalCsv), toCsv(historical.records, historicalColumns));
await writeJson(path.join(repo, outputs.directoryJson), directory.records);
await writeText(path.join(repo, outputs.directoryCsv), toCsv(directory.records, directoryColumns));
await writeJson(path.join(repo, outputs.quarantineJson), directory.quarantine);
await writeText(path.join(repo, outputs.quarantineCsv), toCsv(directory.quarantine, quarantineColumns));
await writeJson(path.join(repo, outputs.duplicateCandidatesJson), directory.duplicatePairs);

const datasetManifest = {};
for (const [key, relativePath] of Object.entries(outputs)) {
  datasetManifest[key] = {
    path: relativePath,
    sha256: await sha256File(path.join(repo, relativePath)),
  };
}

const manifest = {
  schema_version: SCHEMA_VERSION,
  generated_at_utc: generatedAtUtc,
  reader: {
    name: "@oai/artifact-tool",
    version: artifactToolVersion,
  },
  rules: {
    source_preservation: "binary_copy_plus_values_and_formulas_extraction",
    unit_normalization: "source_header_kWp_interpreted_as_Wp_from_panel_count_times_panel_wattage",
    directory_semantics: "research_seed_only_no_contacts_no_pipeline",
    outreach_eligibility: "false_until_annex_a_and_contact_verification",
    quarantine: "human_resolution_required_before_operational_use",
  },
  sources: manifestSources,
  datasets: datasetManifest,
  reconciliations: {
    historical: historical.stats,
    directory: directory.stats,
  },
};

await writeJson(path.join(repo, "data/imports/manifest.json"), manifest);
await writeText(
  path.join(repo, "docs/data-import-qa.md"),
  buildQaReport({
    artifactToolVersion,
    sources: manifestSources,
    historical,
    directory,
  }),
);

process.stdout.write(`${JSON.stringify({
  status: "PASS",
  repo,
  artifact_tool_version: artifactToolVersion,
  manifest: "data/imports/manifest.json",
  historical: historical.stats,
  directory: directory.stats,
}, null, 2)}\n`);
