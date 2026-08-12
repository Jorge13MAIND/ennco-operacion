import { createHash } from "node:crypto";

function canonicalize(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("CANONICAL_JSON_NON_FINITE_NUMBER");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== "object") throw new Error("CANONICAL_JSON_UNSUPPORTED_VALUE");
  if (ancestors.has(value)) throw new Error("CANONICAL_JSON_CYCLE");

  const prototype = Object.getPrototypeOf(value) as object | null;
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new Error("CANONICAL_JSON_UNSUPPORTED_OBJECT");
  }

  ancestors.add(value);
  let result: string;
  if (Array.isArray(value)) {
    result = `[${value.map((item) => canonicalize(item, ancestors)).join(",")}]`;
  } else {
    const record = value as Record<string, unknown>;
    result = `{${Object.keys(record).sort().map((key) => {
      const item = record[key];
      if (item === undefined) throw new Error("CANONICAL_JSON_UNDEFINED_VALUE");
      return `${JSON.stringify(key)}:${canonicalize(item, ancestors)}`;
    }).join(",")}}`;
  }
  ancestors.delete(value);
  return result;
}

export function canonicalResearchJson(value: unknown): string {
  return canonicalize(value, new WeakSet<object>());
}

export function researchSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertNamespacePart(value: string, code: string, maximumLength: number): string {
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (!normalized
    || normalized.length > maximumLength
    || !/^[a-z0-9][a-z0-9._:-]*$/u.test(normalized)) {
    throw new Error(code);
  }
  return normalized;
}

export function buildResearchChecksum(scope: string, payload: unknown): string {
  const normalizedScope = assertNamespacePart(scope, "RESEARCH_CHECKSUM_SCOPE_INVALID", 100);
  return researchSha256(canonicalResearchJson({
    namespace: "ennco.research.checksum.v1",
    scope: normalizedScope,
    payload,
  }));
}

export function buildResearchIdempotencyKey(input: {
  action: string;
  organizationId: string;
  naturalKey: string;
  payload: unknown;
}): string {
  const action = assertNamespacePart(input.action, "RESEARCH_IDEMPOTENCY_ACTION_INVALID", 100);
  const naturalKey = input.naturalKey.normalize("NFKC").trim().toLowerCase();
  if (!naturalKey || naturalKey.length > 500 || /[\u0000-\u001f\u007f]/u.test(naturalKey)) {
    throw new Error("RESEARCH_IDEMPOTENCY_NATURAL_KEY_INVALID");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(input.organizationId)) {
    throw new Error("RESEARCH_IDEMPOTENCY_ORGANIZATION_INVALID");
  }
  return researchSha256(canonicalResearchJson({
    namespace: "ennco.research.idempotency.v1",
    action,
    organizationId: input.organizationId,
    naturalKey,
    payload: input.payload,
  }));
}
