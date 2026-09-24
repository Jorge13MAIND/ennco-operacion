import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Email = { subject: string; body: string };
type Profile = { A: Email; B: Email; followup: Email };
const draft = JSON.parse(readFileSync(new URL("../../../data/campaigns/ennco-v5-email-draft.json", import.meta.url), "utf8")) as {
  status: string; channel: string; touches: number[]; profiles: Record<string, Profile>;
};

describe("ENNCO V5 email draft release checks", () => {
  it("remains a two-touch, email-only draft until business review", () => {
    expect(draft.status).toBe("DRAFT_REQUIRES_JORGE_VOICE_AND_PACO_FACT_REVIEW");
    expect(draft.channel).toBe("EMAIL_ONLY");
    expect(draft.touches).toEqual([0, 3]);
    expect(Object.keys(draft.profiles).sort()).toEqual(["COMPRAS", "DIRECCION", "MANTENIMIENTO", "SEGURIDAD"]);
  });
  it("avoids unsupported claims, calls, and multiple questions", () => {
    for (const profile of Object.values(draft.profiles)) {
      for (const email of [profile.A, profile.B, profile.followup]) {
        expect(email.subject).toContain("{{first_name}}");
        expect(email.body).toContain("{{first_name}}");
        expect(email.body.split(/\s+/u).length).toBeLessThanOrEqual(120);
        expect((email.body.match(/\?/gu) ?? []).length).toBe(1);
        expect(email.body).not.toMatch(/\b(llamada|llamar|reuni[oó]n|ahorr[oa]s?|deduc|descuento|garanti[az]|sin costo|gratis|nom[- ]?\d+)/iu);
        expect(email.body).not.toMatch(/[<>]|[—–]/u);
      }
    }
  });
});
