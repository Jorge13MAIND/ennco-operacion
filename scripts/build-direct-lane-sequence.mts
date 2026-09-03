/**
 * Genera data/campaigns/direct-lane-sequence-v1.json a partir del copy
 * aprobado en docs/external/secuencia-ennco-copy.md.
 *
 * Determinista: mismo markdown → mismo JSON (salvo generated_at, que se
 * conserva si el contenido no cambió). Falla si el copy viola una regla dura.
 *
 *   node --experimental-strip-types scripts/build-direct-lane-sequence.mts
 *   node --experimental-strip-types scripts/build-direct-lane-sequence.mts --check
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DIRECT_LANE_DAY_OFFSETS,
  directLaneSequenceSchema,
  validateDirectLaneSequence,
  type DirectLaneSequence,
} from "../src/lib/correos/sequence.ts";

const root = resolve(import.meta.dirname, "..");
const sourcePath = resolve(root, "docs/external/secuencia-ennco-copy.md");
const targetPath = resolve(root, "data/campaigns/direct-lane-sequence-v1.json");
const checkOnly = process.argv.includes("--check");

// El copy del 3-sep invirtio la jerarquia: antes era "## Toque" con "### variante"
// dentro; ahora es "# Perfil X · <variante>" con "## Toque" dentro. Se acepta el
// nombre del perfil tal como aparece en el encabezado, en minusculas.
const variantByHeading: Record<string, { key: DirectLaneSequence["variants"][number]["key"]; label: string }> = {
  "dirección general": { key: "DIRECCION", label: "Dirección general" },
  "mantenimiento y planta": { key: "MANTENIMIENTO", label: "Mantenimiento y planta" },
  "seguridad e higiene": { key: "SEGURIDAD", label: "Seguridad e higiene" },
  compras: { key: "COMPRAS", label: "Compras" },
};

const markdown = readFileSync(sourcePath, "utf8");
const sourceSha256 = createHash("sha256").update(markdown).digest("hex");
const lines = markdown.split("\n");

type Collected = { touch: number; day: number; variant: string; subject: string; body: string };
const collected: Collected[] = [];
let currentTouch: { touch: number; day: number } | null = null;
let currentVariant: string | null = null;
let currentSubject: string | null = null;

for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index] ?? "";
  if (/^# Segunda vuelta/u.test(line)) break;
  // "# Perfil A · Dirección general" abre una variante y sus 8 toques.
  const variantMatch = /^# Perfil [A-Z] · (.+)$/u.exec(line);
  if (variantMatch) {
    currentVariant = variantMatch[1]!.trim().toLocaleLowerCase("es-MX");
    currentTouch = null;
    currentSubject = null;
    continue;
  }
  const touchMatch = /^## Toque (\d) — día (\d+)/u.exec(line);
  if (touchMatch && currentVariant) {
    currentTouch = { touch: Number(touchMatch[1]), day: Number(touchMatch[2]) };
    currentSubject = null;
    continue;
  }
  const subjectMatch = /^\*\*Asunto:\*\*\s*(.+)$/u.exec(line);
  if (subjectMatch && currentTouch && currentVariant) {
    currentSubject = subjectMatch[1]!.trim();
    continue;
  }
  if (line.trim() === "```" && currentTouch && currentVariant && currentSubject) {
    const bodyLines: string[] = [];
    index += 1;
    while (index < lines.length && (lines[index] ?? "").trim() !== "```") {
      bodyLines.push(lines[index] ?? "");
      index += 1;
    }
    collected.push({
      touch: currentTouch.touch,
      day: currentTouch.day,
      variant: currentVariant,
      subject: currentSubject,
      body: bodyLines.join("\n").trim(),
    });
    currentSubject = null;
  }
}

const variants = Object.entries(variantByHeading).map(([heading, meta]) => {
  const touches = collected
    .filter((item) => item.variant === heading)
    .sort((left, right) => left.touch - right.touch)
    .map((item) => ({ touch_number: item.touch, day_offset: item.day, subject: item.subject, body: item.body }));
  if (touches.length !== 8) {
    throw new Error(`Variante "${meta.label}": se esperaban 8 toques y se encontraron ${touches.length}`);
  }
  return { key: meta.key, label: meta.label, touches };
});

const previous = existsSync(targetPath) ? JSON.parse(readFileSync(targetPath, "utf8")) as Partial<DirectLaneSequence> : null;
const candidate: DirectLaneSequence = directLaneSequenceSchema.parse({
  schema_version: "1.0.0",
  source: "docs/external/secuencia-ennco-copy.md",
  source_sha256: sourceSha256,
  generated_at: previous?.source_sha256 === sourceSha256 && previous.generated_at ? previous.generated_at : new Date().toISOString(),
  sender_name: "Francisco Cuellar",
  sender_title: "Director General, ENNCO",
  day_offsets: [...DIRECT_LANE_DAY_OFFSETS],
  variants,
});

const problems = validateDirectLaneSequence(candidate);
if (problems.length > 0) {
  console.error("El copy viola reglas duras:");
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}

const serialized = `${JSON.stringify(candidate, null, 2)}\n`;
if (checkOnly) {
  const current = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";
  if (current !== serialized) {
    console.error("direct-lane-sequence-v1.json está desactualizado respecto al markdown. Corre build:direct-lane-sequence.");
    process.exit(1);
  }
  console.log(`DIRECT_LANE_SEQUENCE_PASS ${candidate.variants.length} variantes × 8 toques`);
} else {
  writeFileSync(targetPath, serialized);
  console.log(`Escrito ${targetPath}: ${candidate.variants.length} variantes × 8 toques, fuente ${sourceSha256.slice(0, 12)}`);
}
