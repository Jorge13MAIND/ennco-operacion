import { describe, expect, it } from "vitest";

import { getSyntheticLeadInventoryPage, matchesStage, parseLeadQuery, share, stageLabel } from "@/lib/leads/inventory-page";

describe("filtros de leads", () => {
  it("sin parámetros: vista por contacto, todo, página 1", () => {
    expect(parseLeadQuery(undefined)).toEqual({ vista: "contactos", lista: null, ola: null, grupo: null, estado: null, tier: null, sector: null, campana: null, etapa: "todos", q: "", pagina: 1 });
  });
  it("descarta valores inválidos y acepta los válidos", () => {
    const query = parseLeadQuery({ vista: "mapa", etapa: "TOQUE_9", tier: "x", pagina: "0", lista: "todas", grupo: "A_MANTENIMIENTO", estado: "queretaro", ola: "3", campana: "no" });
    expect(query.vista).toBe("contactos");
    expect(query.etapa).toBe("todos");
    expect(query.tier).toBeNull();
    expect(query.pagina).toBe(1);
    expect(query.lista).toBeNull();
    expect(query.grupo).toBe("A_MANTENIMIENTO");
    expect(query.estado).toBe("queretaro");
    expect(query.ola).toBe("3");
    expect(query.campana).toBeNull();
  });
  it("PENDIENTE junta sin enviar y en cola; ENVIADO cualquier toque", () => {
    expect(matchesStage({ stage: "SIN_ENVIAR", last_touch: null }, "PENDIENTE")).toBe(true);
    expect(matchesStage({ stage: "EN_COLA", last_touch: null }, "PENDIENTE")).toBe(true);
    expect(matchesStage({ stage: "REBOTO", last_touch: 1 }, "PENDIENTE")).toBe(false);
    expect(matchesStage({ stage: "TOQUE_3", last_touch: 3 }, "ENVIADO")).toBe(true);
    expect(matchesStage({ stage: "TOQUE_3", last_touch: 3 }, "TOQUE_2")).toBe(false);
  });
});

describe("franja de porcentajes", () => {
  it("se calcula sobre el filtro, no sobre la etapa", () => {
    const page = getSyntheticLeadInventoryPage(new Date("2026-09-15T20:00:00.000Z"), { etapa: "RESPONDIO" });
    expect(page.inventory.rows).toHaveLength(1);
    expect(page.inventory.stats.total).toBe(4);
    expect(share(page.inventory.stats.toque_1, page.inventory.stats.total)).toBeCloseTo(0.75, 5);
    expect(share(0, 0)).toBeNull();
  });
  it("la vista por empresa agrupa el mismo filtro", () => {
    const page = getSyntheticLeadInventoryPage(new Date("2026-09-15T20:00:00.000Z"), { vista: "empresas", lista: "LANZAMIENTO_SEPTIEMBRE" });
    expect(page.inventory.rows).toHaveLength(0);
    expect(page.inventory.companies).toHaveLength(2);
    expect(page.inventory.stats.total).toBe(2);
  });
  it("etiqueta la etapa en español", () => {
    expect(stageLabel({ stage: "TOQUE_2", last_touch: 2 })).toBe("Toque 2 enviado");
    expect(stageLabel({ stage: "RESPONDIO", last_touch: 1 })).toBe("Respondieron");
    expect(stageLabel({ stage: "SIN_ENVIAR", last_touch: null })).toBe("Sin enviar");
  });
});
