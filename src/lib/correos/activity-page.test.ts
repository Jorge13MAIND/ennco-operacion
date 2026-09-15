import { describe, expect, it } from "vitest";

import {
  activityWindow, getSyntheticDirectLaneActivityPage, kindKey, parseActivityQuery, todayCdmx,
} from "@/lib/correos/activity-page";

describe("filtros de actividad", () => {
  it("sin parámetros: semana en curso, todos los tipos y estados", () => {
    const query = parseActivityQuery(undefined);
    expect(query).toEqual({ rango: "semana", buzon: null, tipo: "todos", estado: "todos", campana: null, q: "" });
  });
  it("ignora valores que no existen y recorta el texto", () => {
    const query = parseActivityQuery({ rango: "ayer", tipo: "TOUCH_9", estado: "LOST", buzon: "no-es-uuid", q: ` ${"x".repeat(100)} ` });
    expect(query.rango).toBe("semana");
    expect(query.tipo).toBe("todos");
    expect(query.estado).toBe("todos");
    expect(query.buzon).toBeNull();
    expect(query.q).toHaveLength(80);
  });
  it("acepta un toque concreto, un buzón y una campaña por uuid", () => {
    const query = parseActivityQuery({ tipo: "TOUCH_3", estado: "BOUNCED", buzon: "b4e55606-d413-45cf-a847-bfe18e0644a5", campana: "f68282ce-dbe4-44f1-84c0-2d467a3d5206", rango: "hoy" });
    expect(query).toMatchObject({ tipo: "TOUCH_3", estado: "BOUNCED", rango: "hoy" });
    expect(query.buzon).toBe("b4e55606-d413-45cf-a847-bfe18e0644a5");
    expect(query.campana).toBe("f68282ce-dbe4-44f1-84c0-2d467a3d5206");
  });
});

describe("ventana del periodo", () => {
  // 15-sep-2026 20:00 UTC = 14:00 CDMX (martes)
  const now = new Date("2026-09-15T20:00:00.000Z");
  it("hoy empieza a medianoche CDMX", () => {
    expect(todayCdmx(now)).toBe("2026-09-15");
    expect(activityWindow("hoy", now).since).toBe("2026-09-15T06:00:00.000Z");
  });
  it("semana empieza el lunes CDMX", () => {
    expect(activityWindow("semana", now).since).toBe("2026-09-14T06:00:00.000Z");
  });
  it("30 días y todo terminan ahora", () => {
    expect(activityWindow("30", now).until).toBe(now.toISOString());
    expect(new Date(activityWindow("todo", now).since).getTime()).toBeLessThan(new Date(activityWindow("30", now).since).getTime());
  });
});

describe("ejemplo sintético", () => {
  it("devuelve filas, conteos y opciones con la misma forma que la lectura real", () => {
    const page = getSyntheticDirectLaneActivityPage(new Date("2026-09-15T20:00:00.000Z"));
    expect(page.evidenceClass).toBe("synthetic_demo");
    expect(page.activity.total).toBe(page.activity.rows.length);
    expect(page.activity.rows.length).toBeGreaterThan(0);
    expect(page.activity.options.mailboxes.length).toBeGreaterThan(0);
    const kinds = page.activity.by.kind.reduce((sum, item) => sum + item.count, 0);
    expect(kinds).toBe(page.activity.total);
  });
  it("filtra por tipo en memoria igual que la base", () => {
    const all = getSyntheticDirectLaneActivityPage(new Date("2026-09-15T20:00:00.000Z"));
    const touches = getSyntheticDirectLaneActivityPage(new Date("2026-09-15T20:00:00.000Z"), { tipo: "TOUCH" });
    expect(touches.activity.rows.every((row) => row.kind === "TOUCH")).toBe(true);
    expect(touches.activity.total).toBeLessThanOrEqual(all.activity.total);
    const first = all.activity.rows.find((row) => row.kind === "TOUCH");
    if (first) expect(kindKey(first)).toBe(`TOUCH_${first.touch_number}`);
  });
});
