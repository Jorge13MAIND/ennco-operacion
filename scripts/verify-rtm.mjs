import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(process.argv[2] ?? ".");
const rtmPath = path.join(repo, "docs/01-requirements-traceability.csv");
const text = fs.readFileSync(rtmPath, "utf8").trim();

function parseCsv(input) {
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
  row.push(field);
  rows.push(row);
  return rows;
}

const rows = parseCsv(text);
const headers = rows[0];
const records = rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]])));
const requiredColumns = [
  "id",
  "record_type",
  "requirement",
  "priority",
  "owner",
  "test",
  "evidence",
  "evidence_locator",
  "gate",
  "delivery_status",
  "source_status",
  "next_action",
];
const allowedSourceStatuses = new Set(["VERIFIED_SOURCE", "PARTIAL", "UNKNOWN", "BLOCKED_EXTERNAL", "DEFERRED"]);
const allowedDeliveryStatuses = new Set([
  "NOT_STARTED",
  "IN_PROGRESS",
  "BLOCKED",
  "EVIDENCE_READY",
  "ACCEPTED",
  "REJECTED",
]);
const checklist = records.filter((record) => record.record_type === "ARRANQUE_CHECKLIST");
const ids = records.map((record) => record.id);
const failures = [];

if (headers.length !== 14) failures.push(`EXPECTED_14_COLUMNS_GOT_${headers.length}`);
if (records.length !== 75) failures.push(`EXPECTED_75_ROWS_GOT_${records.length}`);
if (checklist.length !== 47) failures.push(`EXPECTED_47_CHECKLIST_ROWS_GOT_${checklist.length}`);
if (!records.some((record) => record.id === "AVA-001")) failures.push("AVA_AUTHORITY_REQUIREMENT_MISSING");
if (new Set(ids).size !== ids.length) failures.push("DUPLICATE_IDS");

for (const record of records) {
  for (const column of requiredColumns) {
    if (!record[column]?.trim()) failures.push(`EMPTY_${column}_${record.id}`);
  }
  if (!allowedSourceStatuses.has(record.source_status)) failures.push(`INVALID_SOURCE_STATUS_${record.id}`);
  if (!allowedDeliveryStatuses.has(record.delivery_status)) failures.push(`INVALID_DELIVERY_STATUS_${record.id}`);
}

const statusCounts = Object.fromEntries(
  [...allowedSourceStatuses].map((status) => [status, checklist.filter((record) => record.source_status === status).length]),
);
const result = {
  status: failures.length === 0 ? "PASS" : "FAIL",
  rows: records.length,
  columns: headers.length,
  checklist_coverage: `${checklist.length}/47`,
  unique_ids: new Set(ids).size,
  source_status_counts: statusCounts,
  failures,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
