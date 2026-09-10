import { describe, expect, it } from "vitest";

import {
  buildWeeklyRecommendations, deliveryFailRate, funnelStages, periodDelta, weeklyVerdict, type DirectLaneStats,
} from "@/lib/correos/stats";
import { getSyntheticDirectLaneStatsPage, parseStatsRange, statsWindows } from "@/lib/correos/stats-page";

function stats(funnel: Partial<DirectLaneStats["funnel"]>): DirectLaneStats {
  return {
    since: "2026-09-07T06:00:00.000Z", until: "2026-09-09T18:00:00.000Z", campaign_id: null,
    funnel: { enrolled: 0, reached: 0, sends: 0, failed: 0, bounced_enrollments: 0, replied: 0, positive: 0, unsubscribed: 0, tracked: 0, opened: 0, leads: 0, ...funnel },
    by: {},
  };
}

describe("tasa de fallos de entrega", () => {
  it("no cuenta el rebote dos veces: el mensaje BOUNCED ya está en failed", () => {
    // La semana del 8-sep: 13 enviados, 1 rebote. Antes se sumaba también la
    // inscripción rebotada y salía 2/13; la tasa real es 1 de 14 intentos.
    const f = stats({ sends: 12, failed: 1, bounced_enrollments: 1 }).funnel;
    expect(deliveryFailRate(f)).toBeCloseTo(1 / 13, 5);
  });
  it("es nula sin intentos", () => {
    expect(deliveryFailRate(stats({}).funnel)).toBeNull();
  });
});

describe("veredicto de los viernes", () => {
  it("sin envíos no decide nada", () => {
    expect(weeklyVerdict(stats({})).level).toBe("neutral");
  });
  it("un rebote aislado en una semana chica vigila, no frena", () => {
    const verdict = weeklyVerdict(stats({ sends: 12, failed: 1, bounced_enrollments: 1, reached: 12 }));
    expect(verdict.level).toBe("warn");
    expect(verdict.title).toBe("Vigilar la entrega");
    expect(buildWeeklyRecommendations(stats({ sends: 12, failed: 1, bounced_enrollments: 1, reached: 12 }), null).some((l) => l.startsWith("FRENO"))).toBe(false);
  });
  it("frena con muestra suficiente, dos fallos o más y tasa sobre 2%", () => {
    const verdict = weeklyVerdict(stats({ sends: 60, failed: 3, reached: 60 }));
    expect(verdict.level).toBe("critical");
    expect(buildWeeklyRecommendations(stats({ sends: 60, failed: 3, reached: 60 }), null).some((l) => l.startsWith("FRENO"))).toBe(true);
  });
  it("con menos de 20 envíos limpios pide más muestra", () => {
    expect(weeklyVerdict(stats({ sends: 13, reached: 13 })).title).toBe("Muestra insuficiente");
  });
  it("continúa con 20 envíos o más y entrega limpia", () => {
    expect(weeklyVerdict(stats({ sends: 40, failed: 0, reached: 40 })).level).toBe("good");
  });
});

describe("embudo y variaciones", () => {
  it("encadena la conversión de cada etapa contra la anterior", () => {
    const stages = funnelStages(stats({ enrolled: 100, reached: 80, replied: 8, positive: 4, leads: 1 }).funnel);
    expect(stages.map((s) => s.key)).toEqual(["enrolled", "reached", "replied", "positive", "leads"]);
    expect(stages[0]!.ofPrevious).toBeNull();
    expect(stages[1]!.ofPrevious).toBeCloseTo(0.8, 5);
    expect(stages[2]!.ofPrevious).toBeCloseTo(0.1, 5);
    expect(stages[4]!.ofPrevious).toBeCloseTo(0.25, 5);
  });
  it("la variación sabe si subió, bajó o quedó igual, y calla sin periodo anterior", () => {
    expect(periodDelta(13, 7)).toEqual({ diff: 6, direction: "up" });
    expect(periodDelta(3, 9)).toEqual({ diff: -6, direction: "down" });
    expect(periodDelta(4, 4)).toEqual({ diff: 0, direction: "flat" });
    expect(periodDelta(4, null)).toBeNull();
  });
});

describe("ventanas y selección de campaña", () => {
  const now = new Date("2026-09-09T18:00:00.000Z"); // miércoles, semana del lunes 7
  it("la semana empieza el lunes CDMX y la anterior termina donde empieza ésta", () => {
    const w = statsWindows("semana", now, "2026-09-08T15:13:00.000Z");
    expect(w.current.since).toBe("2026-09-07T06:00:00.000Z");
    expect(w.previous).toEqual({ since: "2026-08-31T06:00:00.000Z", until: "2026-09-07T06:00:00.000Z" });
    expect(w.lifetime.since).toBe("2026-09-08T15:13:00.000Z");
  });
  it("toda la campaña no tiene periodo anterior", () => {
    expect(statsWindows("campana", now, "2026-09-08T15:13:00.000Z").previous).toBeNull();
  });
  it("un rango desconocido cae a la semana", () => {
    expect(parseStatsRange("ayer")).toBe("semana");
    expect(parseStatsRange("30")).toBe("30");
  });
  it("por defecto elige la campaña en marcha y 'todas' la deja en blanco", () => {
    const page = getSyntheticDirectLaneStatsPage(now);
    expect(page.selected?.state).toBe("RUNNING");
    expect(getSyntheticDirectLaneStatsPage(now, { campana: "todas" }).selected).toBeNull();
    expect(getSyntheticDirectLaneStatsPage(now, { rango: "campana" }).previous).toBeNull();
  });
});
