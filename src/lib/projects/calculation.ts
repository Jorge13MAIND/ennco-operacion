import {
  calculateEngineering,
  engineeringInputSchema,
  type EngineeringInput,
} from "./engineering";
import type { CatalogEntry, JsonRecord } from "./types";
/** A browser's reviewed flag is never approval. Match every rule value to an approved immutable catalog revision. */
export function resolveEngineeringRules(
  input: EngineeringInput,
  catalogs: CatalogEntry[],
): { input: EngineeringInput; snapshots: JsonRecord[] } {
  const copy = structuredClone(input);
  const snapshots: JsonRecord[] = [];
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const v = value as JsonRecord;
    if ("reviewed" in v && "sourceRef" in v && "version" in v) {
      const entry = catalogs.find(
        (c) =>
          c.status === "APPROVED" &&
          String(c.version) === String(v.version) &&
          (c.id === v.sourceRef || c.sourceUrl === v.sourceRef) &&
          Object.keys(v)
            .filter((k) => !["reviewed", "sourceRef", "version"].includes(k))
            .every((k) => JSON.stringify(v[k]) === JSON.stringify(c.data[k])),
      );
      v.reviewed = Boolean(entry);
      if (entry)
        snapshots.push({
          id: entry.id,
          version: entry.version,
          category: entry.category,
          sourceUrl: entry.sourceUrl,
          sourceDate: entry.sourceDate,
          data: structuredClone(entry.data),
        });
    }
    Object.values(v).forEach(visit);
  }
  visit(copy);
  return { input: engineeringInputSchema.parse(copy), snapshots };
}
export function runReviewedCalculation(
  input: EngineeringInput,
  catalogs: CatalogEntry[],
) {
  const resolved = resolveEngineeringRules(input, catalogs);
  return { ...resolved, result: calculateEngineering(resolved.input) };
}
