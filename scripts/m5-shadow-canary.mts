import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { runAcceleratedShadowCanary, verifyAcceleratedCanary } from "../src/lib/canary/shadow.ts";

const repoArgument = process.argv.indexOf("--repo");
const repo = resolve(repoArgument >= 0 ? process.argv[repoArgument + 1] : ".");
const writeEvidence = process.argv.includes("--write-evidence");
const result = runAcceleratedShadowCanary();
const failures = verifyAcceleratedCanary(result);
const report = { ...result, verificationFailures: failures };

if (writeEvidence) {
  await writeFile(resolve(repo, "docs/evidence/M5-accelerated-canary.json"), `${JSON.stringify(report, null, 2)}\n`);
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;

