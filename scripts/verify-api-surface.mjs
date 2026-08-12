import fs from "node:fs/promises";
import path from "node:path";

const repo = path.resolve(process.argv[2] ?? ".");

const inventory = [
  ["POST", "/api/v1/prequotes", "IMPLEMENTED_LOCAL"],
  ["GET", "/api/v1/prequotes/[folio]/pdf", "IMPLEMENTED_LOCAL"],
  ["POST", "/api/v1/events", "IMPLEMENTED_LOCAL"],
  ["POST", "/api/v1/unsubscribe", "IMPLEMENTED_LOCAL"],
  ["POST", "/api/v1/assistant/messages", "IMPLEMENTED_LOCAL_HOLD"],
  ["POST", "/api/v1/webhooks/gmail", "IMPLEMENTED_LOCAL_HOLD"],
  ["GET", "/api/v1/health", "IMPLEMENTED_LOCAL"],
  ["POST", "/api/v1/research/imports", "IMPLEMENTED_LOCAL_HOLD"],
  ["POST", "/api/v1/research/accounts", "IMPLEMENTED_LOCAL_HOLD"],
  ["POST", "/api/v1/research/accounts/[id]/evidence", "IMPLEMENTED_LOCAL_HOLD"],
  ["POST", "/api/v1/research/accounts/[id]/review", "IMPLEMENTED_LOCAL_HOLD"],
  ["POST", "/api/v1/research/accounts/[id]/contact-candidates", "IMPLEMENTED_LOCAL_HOLD"],
  ["POST", "/api/v1/research/contact-candidates/[id]/verify", "IMPLEMENTED_LOCAL_HOLD"],
  ["POST", "/api/v1/research/dedupe/[id]/resolve", "IMPLEMENTED_LOCAL_HOLD"],
  ["GET", "/api/v1/research/inventory/readiness", "IMPLEMENTED_LOCAL_HOLD"],
  ["POST", "/api/v1/research/inventory/snapshots", "IMPLEMENTED_LOCAL_HOLD"],
  ["POST", "/api/v1/leads", "DEFERRED_CONTRACT"],
  ["POST", "/api/v1/webhooks/meta", "DEFERRED_WHATSAPP_PHASE"],
];

const failures = [];
for (const [method, apiPath, state] of inventory) {
  if (state.startsWith("DEFERRED_")) continue;
  const routeFile = path.join(repo, "src/app", apiPath, "route.ts");
  let source;
  try {
    source = await fs.readFile(routeFile, "utf8");
  } catch {
    failures.push(`${method} ${apiPath}: ROUTE_MISSING`);
    continue;
  }
  if (!new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`, "u").test(source)) {
    failures.push(`${method} ${apiPath}: METHOD_MISSING`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}

const implemented = inventory.filter((item) => item[2].startsWith("IMPLEMENTED_")).length;
const deferred = inventory.length - implemented;
process.stdout.write(`API_SURFACE_PASS implemented=${implemented} deferred=${deferred} total=${inventory.length}\n`);
for (const [method, apiPath, state] of inventory) process.stdout.write(`${state}\t${method}\t${apiPath}\n`);
