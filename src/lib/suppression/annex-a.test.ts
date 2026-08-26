import { describe, expect, it } from "vitest";

import {
  ANNEX_A_DATABASE_SNAPSHOT_SHA256,
  annexAImportResultSchema,
  createFrozenAnnexADatabaseSnapshot,
} from "@/lib/suppression/annex-a";

describe("frozen Annex A database snapshot", () => {
  it("binds exactly the confirmed 3 companies, 12 aliases and 6 domains", () => {
    const snapshot = createFrozenAnnexADatabaseSnapshot();
    expect(snapshot.snapshot_sha256).toBe(ANNEX_A_DATABASE_SNAPSHOT_SHA256);
    expect(snapshot.entries).toHaveLength(3);
    expect(snapshot.entries.flatMap((entry) => entry.aliases)).toHaveLength(12);
    expect(snapshot.entries.flatMap((entry) => entry.domains)).toHaveLength(6);
    expect(snapshot.external_send_authorized).toBe(false);
    expect(snapshot.entries.map((entry) => entry.normalized_name).sort()).toEqual([
      "MPE PLASTIC", "POSCO MPPC", "TEJAS EL AGUILA",
    ]);
  });

  it("does not accept a response that claims outreach eligibility", () => {
    expect(annexAImportResultSchema.safeParse({
      status: "APPLIED",
      manifest_id: "11111111-1111-4111-8111-111111111111",
      annex_id: "ENNCO-ANNEX-A-2026-08-13",
      snapshot_sha256: ANNEX_A_DATABASE_SNAPSHOT_SHA256,
      entry_count: 3,
      alias_count: 12,
      domain_count: 6,
      matched_account_count: 3,
      outreach_eligible_records: 1,
      release_state: "READY_FOR_CANARY",
    }).success).toBe(false);
  });
});
