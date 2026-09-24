import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Email = { subject: string; body: string };
const draft = JSON.parse(readFileSync(new URL("../../../data/campaigns/ennco-v5-email-draft.json", import.meta.url), "utf8")) as {
  status: string; channel: string; control: { campaign_id: string; day_offsets: number[];
    unchanged_for_existing_enrollments: boolean; new_cohort_release: string };
  experiment: { only_changed_element: string }; variant_B_initial_by_profile: Record<string, Email>;
};

describe("ENNCO V5 email draft release checks", () => {
  it("holds the live V4 control and existing enrollments until claims are reviewed", () => {
    expect(draft.status).toBe("DRAFT_BLOCKED_V4_FACT_AND_VOICE_REVIEW");
    expect(draft.channel).toBe("EMAIL_ONLY");
    expect(draft.control.campaign_id).toBe("b0f23483-33ad-4435-a174-ad20a3527d5d");
    expect(draft.control.day_offsets).toEqual([0, 2, 4, 6]);
    expect(draft.control.unchanged_for_existing_enrollments).toBe(true);
    expect(draft.control.new_cohort_release).toMatch(/^HOLD:/u);
    expect(draft.experiment.only_changed_element).toContain("mensaje inicial");
    expect(Object.keys(draft.variant_B_initial_by_profile).sort()).toEqual(["COMPRAS", "DIRECCION", "MANTENIMIENTO", "SEGURIDAD"]);
  });
  it("keeps the challenger to approved service categories and one question", () => {
    for (const email of Object.values(draft.variant_B_initial_by_profile)) {
      expect(email.subject).toContain("{{first_name}}");
      expect(email.body).toContain("{{first_name}}");
      expect(email.body.split(/\s+/u).length).toBeLessThanOrEqual(120);
      expect((email.body.match(/\?/gu) ?? []).length).toBe(1);
      expect(email.body).not.toMatch(/\b(llamada|llamar|reuni[oó]n|ahorr[oa]s?|deduc|descuento|garanti[az]|sin costo|gratis|nom[- ]?\d+|reporte|termograf[ií]a|dron)/iu);
      expect(email.body).not.toMatch(/[<>]|[—–]/u);
    }
  });
});
