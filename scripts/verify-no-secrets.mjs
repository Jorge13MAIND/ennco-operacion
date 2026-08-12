#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const binaryExtensions = new Set([
  ".avif", ".docx", ".gif", ".ico", ".jpeg", ".jpg", ".opus", ".pdf", ".png", ".pptx", ".webp", ".xls", ".xlsm", ".xlsx", ".zip",
]);

const tracked = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
  encoding: "utf8",
}).split("\0").filter(Boolean);

const tokenPrefixes = [
  ["g", "h", "o", "_"].join(""),
  ["g", "h", "p", "_"].join(""),
  ["github", "_pat", "_"].join(""),
  ["xox", "b", "-"].join(""),
  ["xox", "p", "-"].join(""),
  ["sb", "_secret", "_"].join(""),
  ["sk", "_live", "_"].join(""),
  ["AK", "IA"].join(""),
];

const sensitiveNames = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "RESEND_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_KMS_KEY_NAME",
  "GMAIL_CLIENT_SECRET",
];

const findings = [];
for (const file of tracked) {
  if (binaryExtensions.has(extname(file).toLowerCase())) continue;

  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const prefixHit = tokenPrefixes.some((prefix) => {
      const offset = line.indexOf(prefix);
      if (offset < 0) return false;
      const suffix = line.slice(offset + prefix.length).match(/^[A-Za-z0-9_\-]{16,}/)?.[0];
      return Boolean(suffix);
    });

    const privateKeyWords = [[66, 69, 71, 73, 78], [80, 82, 73, 86, 65, 84, 69], [75, 69, 89]]
      .map((codes) => String.fromCharCode(...codes));
    const privateKeyMarker = privateKeyWords.every((part) => line.includes(part));
    const assignmentHit = sensitiveNames.some((name) => {
      const match = line.match(new RegExp(`^\\s*${name}\\s*[:=]\\s*["']?([^\\s"']+)`));
      if (!match?.[1]) return false;
      const value = match[1];
      return !value.includes("${{") && !value.startsWith("process.env") && !/^(example|placeholder|changeme|unknown)$/i.test(value);
    });

    if (prefixHit || privateKeyMarker || assignmentHit) {
      findings.push({ file, line: index + 1, rule: prefixHit ? "TOKEN_PREFIX" : privateKeyMarker ? "PRIVATE_KEY" : "SECRET_ASSIGNMENT" });
    }
  });
}

if (findings.length > 0) {
  process.stderr.write(`${JSON.stringify({ status: "FAIL", findings }, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({ status: "PASS", filesScanned: tracked.length, findings: 0 })}\n`);
