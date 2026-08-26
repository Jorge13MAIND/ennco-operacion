import { createHash } from "node:crypto";

export function canonicalizeAnnexA(source) {
  const entries = Array.isArray(source.entries) ? source.entries : [];
  return JSON.stringify({
    annex_id: source.annex_id,
    scope_statement: source.scope_statement,
    identity_verified_at: source.identity_verified_at,
    entries: [...entries]
      .sort((left, right) => left.normalized_name.localeCompare(right.normalized_name))
      .map((entry) => ({
        normalized_name: entry.normalized_name,
        legal_name: entry.legal_name,
        aliases: [...(entry.aliases ?? [])].sort(),
        source_timestamp: entry.source_timestamp,
        identity_resolution: entry.identity_resolution,
        domains: [...(entry.domains ?? [])]
          .sort((left, right) => left.domain.localeCompare(right.domain))
          .map((domain) => ({
            domain: domain.domain,
            usage: domain.usage,
            confidence: domain.confidence,
            source_url: domain.source_url,
          })),
        account_id: entry.account_id,
        account_binding_status: entry.account_binding_status,
        suppression_state: entry.suppression_state,
      })),
  });
}

export function annexASnapshotSha256(source) {
  return createHash("sha256").update(canonicalizeAnnexA(source)).digest("hex");
}
