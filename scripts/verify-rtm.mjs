import fs from "node:fs";
import path from "node:path";

import { validateRtm } from "./lib/governance.mjs";

const repo = path.resolve(process.argv[2] ?? ".");
const rtmPath = path.join(repo, "docs/01-requirements-traceability.csv");
const result = validateRtm({ text: fs.readFileSync(rtmPath, "utf8"), repo });

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.failures.length > 0) process.exitCode = 1;
