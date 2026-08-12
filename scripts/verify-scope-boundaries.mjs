#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(process.argv[2] ?? ".");
const roots = [".github", "data", "public", "scripts", "src", "supabase", "tests"];
const textExtensions = new Set([
  ".css", ".csv", ".html", ".js", ".json", ".mjs", ".mts", ".sql", ".ts", ".tsx", ".txt", ".yml", ".yaml",
]);
const forbidden = [
  { code: "MEST_OUT_OF_SCOPE_REFERENCE", pattern: /\bmest\b/iu },
];
const scannerAllowlist = new Set(["scripts/verify-scope-boundaries.mjs"]);
const findings = [];
let scannedFiles = 0;

function walk(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolute);
      continue;
    }
    if (!entry.isFile() || !textExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    const relativePath = path.relative(repo, absolute);
    scannedFiles += 1;
    if (scannerAllowlist.has(relativePath)) continue;
    const text = fs.readFileSync(absolute, "utf8");
    for (const rule of forbidden) {
      if (rule.pattern.test(text)) findings.push({ code: rule.code, path: relativePath });
    }
  }
}

for (const root of roots) walk(path.join(repo, root));

const result = {
  status: findings.length === 0 ? "PASS" : "FAIL",
  scanned_files: scannedFiles,
  roots,
  excluded_documentation: true,
  scanner_allowlist: [...scannerAllowlist],
  rationale: "Governance documentation may name an excluded system; product code, data, tests and automation may not include it.",
  findings,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (findings.length > 0) process.exitCode = 1;
