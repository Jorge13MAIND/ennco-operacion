import { z } from "zod";

import annexASource from "../../../data/suppression/anexo-a-2026-08-13.json";

const EXPECTED_SNAPSHOT_SHA256 = "8e986eff74dee10d3f619f7562ee6b7d18207c3c5e080cd82656cc0e88d46af1";

const sourceSchema = z.object({
  annex_id: z.literal("ENNCO-ANNEX-A-2026-08-13"),
  status: z.literal("IDENTITY_AND_DOMAIN_VERIFIED_ACCOUNT_BINDING_PENDING"),
  confirmed_at: z.iso.datetime({ offset: true }),
  scope_statement: z.literal("ONLY_THESE_THREE_COMPANIES_AS_OF_CONFIRMATION"),
  external_send_authorized: z.literal(false),
  entries: z.array(z.object({
    normalized_name: z.enum(["POSCO MPPC", "MPE PLASTIC", "TEJAS EL AGUILA"]),
    legal_name: z.string().trim().min(2).max(240),
    aliases: z.array(z.string().trim().min(2).max(240)).min(2).max(8),
    source_timestamp: z.iso.datetime({ offset: true }),
    domains: z.array(z.object({
      domain: z.string().trim().min(4).max(253),
    }).passthrough()).min(1).max(4),
  }).passthrough()).length(3),
}).passthrough();

export const annexADatabaseSnapshotSchema = z.object({
  annex_id: z.literal("ENNCO-ANNEX-A-2026-08-13"),
  snapshot_sha256: z.literal(EXPECTED_SNAPSHOT_SHA256),
  scope_statement: z.literal("ONLY_THESE_THREE_COMPANIES_AS_OF_CONFIRMATION"),
  status: z.literal("IDENTITY_AND_DOMAIN_VERIFIED_ACCOUNT_BINDING_PENDING"),
  external_send_authorized: z.literal(false),
  confirmed_at: z.iso.datetime({ offset: true }),
  entries: z.array(z.object({
    normalized_name: z.enum(["POSCO MPPC", "MPE PLASTIC", "TEJAS EL AGUILA"]),
    legal_name: z.string().trim().min(2).max(240),
    source_timestamp: z.iso.datetime({ offset: true }),
    aliases: z.array(z.string().trim().min(2).max(240)).min(2).max(8),
    domains: z.array(z.string().trim().min(4).max(253)).min(1).max(4),
  }).strict()).length(3),
}).strict();

export const annexAImportResultSchema = z.object({
  status: z.enum(["APPLIED", "DUPLICATE"]),
  manifest_id: z.uuid(),
  annex_id: z.literal("ENNCO-ANNEX-A-2026-08-13"),
  snapshot_sha256: z.literal(EXPECTED_SNAPSHOT_SHA256),
  entry_count: z.literal(3),
  alias_count: z.literal(12),
  domain_count: z.literal(6),
  matched_account_count: z.number().int().min(0).max(3),
  outreach_eligible_records: z.literal(0),
  release_state: z.literal("HOLD"),
}).strict();

export type AnnexADatabaseSnapshot = z.infer<typeof annexADatabaseSnapshotSchema>;

export function createFrozenAnnexADatabaseSnapshot(): AnnexADatabaseSnapshot {
  const source = sourceSchema.parse(annexASource);
  const snapshot = {
    annex_id: source.annex_id,
    snapshot_sha256: EXPECTED_SNAPSHOT_SHA256,
    scope_statement: source.scope_statement,
    status: source.status,
    external_send_authorized: source.external_send_authorized,
    confirmed_at: source.confirmed_at,
    entries: source.entries.map((entry) => ({
      normalized_name: entry.normalized_name,
      legal_name: entry.legal_name,
      source_timestamp: entry.source_timestamp,
      aliases: entry.aliases,
      domains: entry.domains.map((domain) => domain.domain),
    })),
  };
  return annexADatabaseSnapshotSchema.parse(snapshot);
}

export const ANNEX_A_DATABASE_SNAPSHOT_SHA256 = EXPECTED_SNAPSHOT_SHA256;
