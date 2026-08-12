import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { renderSequenceTouch } from "@/lib/release/render";

const sequence = JSON.parse(readFileSync(resolve(process.cwd(), "data/campaigns/sequence-draft-v1.json"), "utf8"));
const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "data/release/fixtures/first-send-synthetic-v1.json"), "utf8"));

describe("first send deterministic render", () => {
  it("renders exactly five synthetic accounts without unresolved tokens", () => {
    expect(fixture.evidence_class).toBe("synthetic_demo");
    expect(fixture.external_send_allowed).toBe(false);
    expect(fixture.recipients).toHaveLength(5);
    expect(new Set(fixture.recipients.map((recipient: { account_id: string }) => recipient.account_id)).size).toBe(5);

    const rendered = fixture.recipients.map((recipient: Record<string, string>) => renderSequenceTouch(
      sequence,
      1,
      recipient.variant!,
      {
        first_name: recipient.first_name!,
        company: recipient.account!,
        observed_signal: recipient.observed_signal!,
        source_name: recipient.source_name!,
      },
    ));

    expect(rendered).toHaveLength(5);
    for (const message of rendered) {
      expect(message.subject).not.toContain("{{");
      expect(message.body).not.toContain("{{");
      expect(message.body).toContain("Francisco Cuellar");
    }
  });

  it("fails closed when required personalization is missing", () => {
    expect(() => renderSequenceTouch(sequence, 1, "executive", {
      first_name: "Ana",
      company: "Planta Sintética",
      observed_signal: "",
      source_name: "fixture local",
    })).toThrow("MISSING_RENDER_VALUE:observed_signal");
  });
});
