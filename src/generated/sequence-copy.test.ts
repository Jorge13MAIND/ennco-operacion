import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import bundled from "@/generated/direct-lane-sequence-v1.json";

/**
 * data/campaigns/direct-lane-sequence-v1.json es la fuente que congelan los
 * gates; src/generated/ es la copia que empaqueta Next para la ruta de crear
 * campana. Si divergen, la campana se crearia con un copy distinto al
 * aprobado. build:direct-lane-sequence escribe las dos.
 */
describe("copia empaquetada del copy", () => {
  it("es identica a data/campaigns/direct-lane-sequence-v1.json", () => {
    const canonical = JSON.parse(readFileSync(resolve(process.cwd(), "data/campaigns/direct-lane-sequence-v1.json"), "utf8"));
    expect(bundled).toEqual(canonical);
  });
});
