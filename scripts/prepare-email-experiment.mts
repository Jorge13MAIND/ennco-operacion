import { readFile, writeFile } from "node:fs/promises";
import { prepareEmailExperiment } from "../src/lib/correos/experiment.ts";
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: node --experimental-strip-types scripts/prepare-email-experiment.mts input.json output.json");
const result = prepareEmailExperiment(JSON.parse(await readFile(input, "utf8")));
await writeFile(output, JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ state: result.state, A: result.cohorts.A.length, B: result.cohorts.B.length, held: result.held.length, launch_allowed: false }));
