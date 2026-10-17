import { describe, expect, it } from "vitest";

import { DEMO_IDS, demoMeterView, demoOverview } from "@/lib/medidores/demo";
import { meterInsights } from "@/lib/medidores/insights";
import { meterViewSchema, overviewSchema } from "@/lib/medidores/model";

const NOW = new Date("2026-10-16T18:00:00Z");

describe("ejemplo y lectura automática", () => {
  it("el ejemplo cumple los mismos esquemas que la base", () => {
    expect(overviewSchema.safeParse(demoOverview(NOW)).success).toBe(true);
    const view = demoMeterView(DEMO_IDS.general, NOW)!;
    expect(meterViewSchema.safeParse(view).success).toBe(true);
    expect(view.series.length).toBeGreaterThan(100);
    expect(view.series.length).toBeLessThanOrEqual(721);
  });

  it("la lectura explica energía, factor de potencia, tensión y lo que encontraron las alertas", () => {
    const view = demoMeterView(DEMO_IDS.general, NOW)!;
    const titles = meterInsights(view).map((i) => i.title);
    expect(titles).toEqual(expect.arrayContaining(["Qué se midió", "Energía", "Factor de potencia bajo", "Tensión", "Desbalance de corriente"]));
    const pf = meterInsights(view).find((i) => i.title === "Factor de potencia bajo")!;
    expect(pf.tone).toBe("atencion");
    expect(pf.body).toContain("banco de capacitores");
  });

  it("sin lecturas pide cargar datos", () => {
    const view = demoMeterView(DEMO_IDS.general, NOW, "2020-01-01T00:00:00Z", "2020-01-02T00:00:00Z")!;
    expect(meterInsights(view)[0]!.title).toBe("Sin lecturas en este periodo");
  });
});
