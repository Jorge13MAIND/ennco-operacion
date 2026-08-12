import fs from "node:fs";
import path from "node:path";

export const ENTERPRISE_REQUIREMENTS = [
  { id: "ENT-001", name: "SAST automatizado" },
  { id: "ENT-002", name: "DAST automatizado" },
  { id: "ENT-003", name: "SBOM por release" },
  { id: "ENT-004", name: "WCAG 2.2 AA" },
  { id: "ENT-005", name: "Pruebas de performance y carga" },
  { id: "ENT-006", name: "SLO y error budget instrumentados" },
  { id: "ENT-007", name: "Identidad, secretos y proveedores de produccion" },
  { id: "ENT-008", name: "Atribucion y comision auditables" },
  { id: "ENT-009", name: "Evidencia contractual de lead no falsificable" },
];

export const OPEN_RISK_STATUSES = new Set([
  "OPEN",
  "OPEN_EXTERNAL",
  "BLOCKED_EXTERNAL",
  "MITIGATING",
]);

const allowedRiskStatuses = new Set([
  ...OPEN_RISK_STATUSES,
  "MITIGATED_LOCAL",
  "VERIFIED",
  "VERIFIED_LOCAL",
]);
const allowedSourceStatuses = new Set([
  "VERIFIED_SOURCE",
  "PARTIAL",
  "UNKNOWN",
  "BLOCKED_EXTERNAL",
  "DEFERRED",
]);
const allowedDeliveryStatuses = new Set([
  "NOT_STARTED",
  "IN_PROGRESS",
  "BLOCKED",
  "EVIDENCE_READY",
  "ACCEPTED",
  "REJECTED",
]);
const requiredColumns = [
  "id",
  "record_type",
  "source",
  "requirement",
  "priority",
  "component",
  "owner",
  "test",
  "evidence",
  "evidence_locator",
  "gate",
  "delivery_status",
  "source_status",
  "next_action",
];

export function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const next = input[index + 1];
    if (quoted && character === '"' && next === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if (character === "\n" && !quoted) {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV_UNTERMINATED_QUOTE");
  row.push(field);
  rows.push(row);
  return rows;
}

function insideRepo(repo, candidate) {
  const relative = path.relative(repo, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function locatorPath(locator) {
  const withoutAnchor = locator.split("#", 1)[0].trim();
  return withoutAnchor.replace(/:\d+(?:[-,]\d+)*$/, "");
}

function validateEvidenceLocator(repo, record, failures) {
  const locators = record.evidence_locator.split(";").map((value) => value.trim()).filter(Boolean);
  if (locators.length === 0) {
    failures.push(`EVIDENCE_LOCATOR_EMPTY_${record.id}`);
    return;
  }

  for (const locator of locators) {
    const candidateText = locatorPath(locator);
    const candidate = path.resolve(path.isAbsolute(candidateText) ? candidateText : path.join(repo, candidateText));
    if (!insideRepo(repo, candidate)) {
      failures.push(`EVIDENCE_NOT_REPO_LOCAL_${record.id}`);
      continue;
    }
    if (!fs.existsSync(candidate)) {
      failures.push(`EVIDENCE_FILE_MISSING_${record.id}`);
      continue;
    }
    const realCandidate = fs.realpathSync(candidate);
    if (!insideRepo(repo, realCandidate)) {
      failures.push(`EVIDENCE_SYMLINK_OUTSIDE_REPO_${record.id}`);
      continue;
    }
    const stat = fs.statSync(realCandidate);
    if (!stat.isFile() || stat.size === 0) {
      failures.push(`EVIDENCE_FILE_EMPTY_OR_NOT_FILE_${record.id}`);
      continue;
    }
    if (path.extname(realCandidate).toLowerCase() === ".json") {
      try {
        JSON.parse(fs.readFileSync(realCandidate, "utf8"));
      } catch {
        failures.push(`EVIDENCE_JSON_INVALID_${record.id}`);
      }
    }
  }
}

export function validateRtm({ text, repo }) {
  const failures = [];
  let rows;
  try {
    rows = parseCsv(text.trim());
  } catch (error) {
    return {
      status: "FAIL",
      rows: 0,
      columns: 0,
      checklist_coverage: "0/47",
      unique_ids: 0,
      source_status_counts: {},
      delivery_status_counts: {},
      enterprise_requirements: [],
      enterprise_gap_count: ENTERPRISE_REQUIREMENTS.length,
      failures: [error instanceof Error ? error.message : "CSV_PARSE_FAILED"],
    };
  }

  const headers = rows[0] ?? [];
  const dataRows = rows.slice(1);
  const records = dataRows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
  const checklist = records.filter((record) => record.record_type === "ARRANQUE_CHECKLIST");
  const ids = records.map((record) => record.id);

  if (headers.length !== requiredColumns.length) failures.push(`EXPECTED_${requiredColumns.length}_COLUMNS_GOT_${headers.length}`);
  for (const column of requiredColumns) {
    if (!headers.includes(column)) failures.push(`MISSING_COLUMN_${column}`);
  }
  dataRows.forEach((values, index) => {
    if (values.length !== headers.length) failures.push(`ROW_${index + 2}_COLUMN_COUNT_${values.length}`);
  });
  if (records.length < 75) failures.push(`EXPECTED_AT_LEAST_75_ROWS_GOT_${records.length}`);
  if (checklist.length !== 47) failures.push(`EXPECTED_47_CHECKLIST_ROWS_GOT_${checklist.length}`);
  if (!records.some((record) => record.id === "AVA-001")) failures.push("AVA_AUTHORITY_REQUIREMENT_MISSING");
  if (new Set(ids).size !== ids.length) failures.push("DUPLICATE_IDS");

  for (const record of records) {
    for (const column of requiredColumns) {
      if (!record[column]?.trim()) failures.push(`EMPTY_${column}_${record.id || "UNKNOWN"}`);
    }
    if (!allowedSourceStatuses.has(record.source_status)) failures.push(`INVALID_SOURCE_STATUS_${record.id}`);
    if (!allowedDeliveryStatuses.has(record.delivery_status)) failures.push(`INVALID_DELIVERY_STATUS_${record.id}`);
    if (!new Set(["P0", "P1", "P2"]).has(record.priority)) failures.push(`INVALID_PRIORITY_${record.id}`);
    if (!/^M[0-9]$/.test(record.gate)) failures.push(`INVALID_GATE_${record.id}`);

    if (record.source_status === "BLOCKED_EXTERNAL" && record.delivery_status !== "BLOCKED") {
      failures.push(`BLOCKED_EXTERNAL_MUST_BE_BLOCKED_${record.id}`);
    }
    if (["UNKNOWN", "BLOCKED_EXTERNAL"].includes(record.source_status)
      && ["EVIDENCE_READY", "ACCEPTED"].includes(record.delivery_status)) {
      failures.push(`UNVERIFIED_SOURCE_CANNOT_BE_READY_${record.id}`);
    }
    if (record.delivery_status === "ACCEPTED" && record.source_status !== "VERIFIED_SOURCE") {
      failures.push(`ACCEPTED_REQUIRES_VERIFIED_SOURCE_${record.id}`);
    }
    if (record.record_type === "PROGRAM_REQUIREMENT" && record.delivery_status === "EVIDENCE_READY"
      && record.source_status !== "VERIFIED_SOURCE") {
      failures.push(`PROGRAM_READY_REQUIRES_VERIFIED_SOURCE_${record.id}`);
    }
    if (record.delivery_status === "EVIDENCE_READY") validateEvidenceLocator(repo, record, failures);
  }

  const enterpriseRequirements = ENTERPRISE_REQUIREMENTS.map((requirement) => {
    const record = records.find((candidate) => candidate.id === requirement.id);
    if (!record) failures.push(`MISSING_ENTERPRISE_REQUIREMENT_${requirement.id}`);
    return {
      ...requirement,
      tracked: Boolean(record),
      delivery_status: record?.delivery_status ?? "MISSING",
      source_status: record?.source_status ?? "MISSING",
      gate: record?.gate ?? "MISSING",
    };
  });
  const enterpriseGapCount = enterpriseRequirements.filter((requirement) => !["EVIDENCE_READY", "ACCEPTED"].includes(requirement.delivery_status)).length;

  const sourceStatusCounts = Object.fromEntries(
    [...allowedSourceStatuses].map((status) => [status, checklist.filter((record) => record.source_status === status).length]),
  );
  const deliveryStatusCounts = Object.fromEntries(
    [...allowedDeliveryStatuses].map((status) => [status, records.filter((record) => record.delivery_status === status).length]),
  );

  return {
    status: failures.length === 0 ? "PASS" : "FAIL",
    rows: records.length,
    columns: headers.length,
    checklist_coverage: `${checklist.length}/47`,
    unique_ids: new Set(ids).size,
    source_status_counts: sourceStatusCounts,
    delivery_status_counts: deliveryStatusCounts,
    enterprise_requirements: enterpriseRequirements,
    enterprise_gap_count: enterpriseGapCount,
    failures,
  };
}

export function parseRiskRegister(text) {
  const failures = [];
  const records = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!/^\| R-\d+ \|/.test(line)) continue;
    const columns = line.trim().slice(1, -1).split("|").map((value) => value.trim());
    if (columns.length !== 7) {
      failures.push(`RISK_ROW_${index + 1}_COLUMN_COUNT_${columns.length}`);
      continue;
    }
    const [id, priority, risk, trigger, mitigation, owner, status] = columns;
    records.push({ id, priority, risk, trigger, mitigation, owner, status, line: index + 1 });
  }

  const ids = records.map((record) => record.id);
  if (records.length === 0) failures.push("RISK_REGISTER_EMPTY");
  if (new Set(ids).size !== ids.length) failures.push("RISK_REGISTER_DUPLICATE_IDS");
  for (const record of records) {
    if (!/^R-\d{3}$/.test(record.id)) failures.push(`RISK_ID_INVALID_${record.id}`);
    if (!new Set(["P0", "P1", "P2"]).has(record.priority)) failures.push(`RISK_PRIORITY_INVALID_${record.id}`);
    if (!allowedRiskStatuses.has(record.status)) failures.push(`RISK_STATUS_INVALID_${record.id}`);
    if (!record.risk || !record.trigger || !record.mitigation || !record.owner) failures.push(`RISK_FIELD_EMPTY_${record.id}`);
  }

  const openRecords = records.filter((record) => OPEN_RISK_STATUSES.has(record.status));
  const openCounts = {
    P0: openRecords.filter((record) => record.priority === "P0").length,
    P1: openRecords.filter((record) => record.priority === "P1").length,
    P2: openRecords.filter((record) => record.priority === "P2").length,
  };
  const statusCounts = Object.fromEntries(
    [...allowedRiskStatuses].map((status) => [status, records.filter((record) => record.status === status).length]),
  );
  return {
    status: failures.length === 0 ? "PASS" : "FAIL",
    records,
    open_records: openRecords,
    open_counts: openCounts,
    status_counts: statusCounts,
    failures,
  };
}
