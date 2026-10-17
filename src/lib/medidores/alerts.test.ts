import { describe, expect, it } from "vitest";

import { effectivePf, evaluateAlerts, isDubious, staleEvent, type EvalContext, type EvalReading } from "@/lib/medidores/alerts";

const site: EvalContext["site"] = { timezone: "America/Mexico_City", work_days: [1, 2, 3, 4, 5, 6], work_start: "07:00", work_end: "19:00", contracted_demand_kw: null, paro_cost_mxn_h: null };
const meter: EvalContext["meter"] = { kind: "ANALIZADOR", nominal_v_ln: 127, interval_minutes: 10, thresholds: {} };
/** Lecturas cada 10 min desde el lunes 5-oct-2026 00:00 de CDMX (06:00 UTC). */
function series(hours: number, f: (localHour: number, i: number) => Partial<EvalReading>): EvalReading[] {
  const start = Date.parse("2026-10-05T06:00:00Z");
  return Array.from({ length: hours * 6 }, (_, i) => {
    const ts = new Date(start + i * 600000).toISOString();
    const base: EvalReading = { ts, v_l1: 127, v_l2: 127, v_l3: 127, v_ln_min: 126, i_avg: 100, i_l1: 100, i_l2: 100, i_l3: 100, freq: 60, freq_min: 59.95,
      p_import_kw: 40, p_import_l1: 13, p_import_l2: 13, p_import_l3: 14, pf_l1: 0.97, pf_l2: 0.97, pf_l3: 0.97, p_export_kw: 0, thd_v_max: 2, thd_i_max: 10 };
    return { ...base, ...f(((i * 10) / 60) % 24, i) };
  });
}
const rules = (events: ReturnType<typeof evaluateAlerts>) => events.map((e) => `${e.rule}:${e.severity}`);

describe("alertas de medidores", () => {
  it("no avisa nada con una planta sana", () => {
    expect(evaluateAlerts({ meter, site, readings: series(24, () => ({})) })).toEqual([]);
  });

  it("ignora los artefactos del analizador (frecuencia de 50 Hz, THD imposible)", () => {
    const readings = series(24, (_, i) => (i === 50 ? { freq_min: 50, thd_v_max: 98, v_ln_min: 20 } : {}));
    expect(isDubious(readings[50]!)).toBe(true);
    expect(evaluateAlerts({ meter, site, readings })).toEqual([]);
  });

  it("un hueco profundo es urgente aunque dure una lectura", () => {
    const events = evaluateAlerts({ meter, site, readings: series(24, (_, i) => (i === 60 ? { v_ln_min: 86.8 } : {})) });
    expect(rules(events)).toEqual(["HUECO_TENSION:URGENTE"]);
    expect(events[0]!.message).toContain("86.8 V");
  });

  it("la tensión alta de noche solo cuenta si dura una hora", () => {
    const short = evaluateAlerts({ meter, site, readings: series(24, (h) => (h >= 1 && h < 1.5 ? { v_l1: 134, v_l2: 134, v_l3: 134 } : {})) });
    expect(short).toEqual([]);
    const long = evaluateAlerts({ meter, site, readings: series(24, (h) => (h >= 1 && h < 3 ? { v_l1: 134, v_l2: 134, v_l3: 134 } : {})) });
    expect(rules(long)).toEqual(["TENSION_FUERA:ATENCION"]);
  });

  it("exportación de noche apunta a la instalación del analizador", () => {
    const events = evaluateAlerts({ meter, site, readings: series(24, (h) => (h >= 21 ? { p_export_l2: 9, p_export_kw: 0 } : {})) });
    expect(rules(events)).toContain("EXPORTACION_NOCHE:ATENCION");
    expect(events.find((e) => e.rule === "EXPORTACION_NOCHE")!.message).toContain("polaridad de los TC");
  });

  it("el factor de potencia diario bajo es de atención, no urgente; el FP mezcla solo fases que consumen", () => {
    const readings = series(24, () => ({ pf_l1: 0.7, pf_l2: 0, pf_l3: 0.68, p_import_l2: 0 }));
    expect(effectivePf(readings[0]!)).toBeCloseTo(0.69, 2);
    expect(rules(evaluateAlerts({ meter, site, readings }))).toEqual(["FP_BAJO:ATENCION"]);
  });

  it("un día que envía más de lo que toma es informativo", () => {
    const events = evaluateAlerts({ meter, site: { ...site, work_days: [1, 2, 3, 4, 5] }, readings: series(24, (h) => (h >= 9 && h < 16 ? { p_import_kw: 0, p_export_kw: 50 } : { p_import_kw: 5 })) });
    expect(rules(events)).toContain("DIA_EXPORTADOR:INFO");
  });

  it("detecta un paro en horario de trabajo y lo pone en pesos; si exporta, es solar y no paro", () => {
    const paro = evaluateAlerts({ meter, site: { ...site, paro_cost_mxn_h: 12000 }, readings: series(24, (h) => (h >= 10 && h < 11 ? { p_import_kw: 2 } : {})) });
    const ev = paro.find((e) => e.rule === "PARO")!;
    expect(ev.severity).toBe("ATENCION");
    expect(ev.message).toContain("12,000");
    const solar = evaluateAlerts({ meter, site, readings: series(24, (h) => (h >= 10 && h < 11 ? { p_import_kw: 2, p_export_kw: 5 } : {})) });
    expect(solar.some((e) => e.rule === "PARO")).toBe(false);
  });

  it("demanda arriba de lo contratado es urgente", () => {
    const events = evaluateAlerts({ meter, site: { ...site, contracted_demand_kw: 50 }, readings: series(24, (_, i) => (i === 70 ? { p_import_max_kw: 61 } : {})) });
    expect(rules(events)).toEqual(["DEMANDA:URGENTE"]);
  });

  it("un evento que viene abierto de antes conserva su inicio", () => {
    const readings = series(6, () => ({ v_l1: 140, v_l2: 140, v_l3: 140 }));
    const events = evaluateAlerts({ meter, site, readings, lastReadingAt: readings.at(-1)!.ts, openEvents: [{ rule: "TENSION_FUERA", started_at: "2026-10-04T10:00:00.000Z" }] });
    expect(events[0]).toMatchObject({ rule: "TENSION_FUERA", severity: "URGENTE", started_at: "2026-10-04T10:00:00.000Z", ended_at: null });
  });

  it("inversor: falla urgente y aviso de medidor sin datos", () => {
    const inverter = { ...meter, kind: "INVERSOR" as const };
    const readings: EvalReading[] = [{ ts: "2026-10-05T18:00:00Z", pv_kw: 30, inverter_status: "NORMAL" }, { ts: "2026-10-05T18:15:00Z", pv_kw: 0, inverter_status: "FALLA" }];
    expect(rules(evaluateAlerts({ meter: inverter, site, readings }))).toEqual(["INVERSOR_FALLA:URGENTE"]);
    const stale = staleEvent({ name: "Línea 2", last_reading_at: "2026-10-05T18:00:00Z" }, "America/Mexico_City", new Date("2026-10-05T19:00:00Z"));
    expect(stale).toMatchObject({ rule: "SIN_DATOS", severity: "URGENTE", value: 60 });
  });
});
