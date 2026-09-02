import { describe, expect, it } from "vitest";

import {
  APOLLO_TITLE_QUERIES,
  CANDIDATES_PER_ACCOUNT,
  ENRICH_LIMIT_PER_RUN,
  emptySummary,
  isUsableEmail,
  partitionByDomain,
  selectCandidates,
  titlesFor,
  type ApolloPersonLike,
} from "./apollo-leads";
import { classifyRoleTitle } from "./roles";

const persona = (id: string, title: string, first = "Juan", last = "Pérez"): ApolloPersonLike => ({
  id, first_name: first, last_name: last, title,
});

describe("selección de candidatos", () => {
  it("se queda con una persona por categoría objetivo", () => {
    const seleccion = selectCandidates([
      persona("1", "Gerente de Mantenimiento"),
      persona("2", "Jefe de Mantenimiento", "Ana", "López"),
      persona("3", "Director General", "Luis", "Ortega"),
    ]);

    expect(seleccion).toHaveLength(2);
    expect(seleccion.map((c) => c.roleCategory).sort()).toEqual(["CEO", "MAINTENANCE"]);
  });

  it("descarta los cargos que la base clasificaría como OTHER", () => {
    const seleccion = selectCandidates([
      persona("1", "Analista de Marketing"),
      persona("2", "Recepcionista"),
    ]);

    expect(seleccion).toEqual([]);
  });

  it("reconoce seguridad e higiene, que antes caía en OTHER", () => {
    const seleccion = selectCandidates([persona("1", "Coordinador de Seguridad e Higiene")]);

    expect(seleccion).toHaveLength(1);
    expect(seleccion[0]?.roleCategory).toBe("SAFETY");
  });

  it("nunca devuelve más de un candidato por categoría objetivo", () => {
    const gente = Array.from({ length: 30 }, (_, i) => persona(String(i), "Gerente de Compras"));

    expect(selectCandidates(gente)).toHaveLength(1);
  });

  it("respeta el tope de candidatos por cuenta", () => {
    const seleccion = selectCandidates([
      persona("1", "Director General"),
      persona("2", "Gerente de Planta"),
      persona("3", "Jefe de Mantenimiento"),
      persona("4", "Gerente de Compras"),
      persona("5", "Coordinador de Seguridad e Higiene"),
    ]);

    expect(seleccion.length).toBeLessThanOrEqual(CANDIDATES_PER_ACCOUNT);
    expect(seleccion).toHaveLength(5);
  });

  it("ignora personas sin cargo o sin nombre utilizable", () => {
    expect(selectCandidates([persona("1", "")])).toEqual([]);
    expect(selectCandidates([{ id: "2", first_name: "", last_name: "", title: "Director General" }])).toEqual([]);
  });
});

describe("correos utilizables", () => {
  it("acepta un correo verificado", () => {
    expect(isUsableEmail("juan.perez@empresa.com.mx", "verified")).toBe(true);
  });

  it("rechaza el marcador de Apollo cuando el correo no está liberado", () => {
    expect(isUsableEmail("email_not_unlocked@domain.com", "verified")).toBe(false);
  });

  it("rechaza vacíos, dominios .invalid y estados malos", () => {
    expect(isUsableEmail(null, "verified")).toBe(false);
    expect(isUsableEmail("prueba@ejemplo.invalid", "verified")).toBe(false);
    expect(isUsableEmail("juan@empresa.com", "bounced")).toBe(false);
    expect(isUsableEmail("sin-arroba", "verified")).toBe(false);
  });
});

describe("cuentas consultables", () => {
  it("separa las que tienen dominio de las que no", () => {
    const { buscables, sinDominio } = partitionByDomain([
      { id: "a", legal_name: "CON DOMINIO", primary_domain: "empresa.com.mx" },
      { id: "b", legal_name: "SIN DOMINIO", primary_domain: null },
      { id: "c", legal_name: "DOMINIO BASURA", primary_domain: "  " },
    ]);

    expect(buscables.map((a) => a.id)).toEqual(["a"]);
    expect(sinDominio.map((a) => a.id)).toEqual(["b", "c"]);
  });
});

describe("consultas de cargos", () => {
  it("no repite cargos entre categorías y respeta el tope de Apollo", () => {
    const titles = titlesFor(["CEO", "PLANT_DIRECTOR", "MAINTENANCE", "PROCUREMENT", "SAFETY"]);

    expect(new Set(titles).size).toBe(titles.length);
    expect(titles.length).toBeLessThanOrEqual(30);
  });

  it("cada categoría objetivo tiene cargos que buscar", () => {
    for (const [categoria, cargos] of Object.entries(APOLLO_TITLE_QUERIES)) {
      expect(cargos.length, categoria).toBeGreaterThan(0);
    }
  });
});

describe("paridad con el clasificador de la base", () => {
  /**
   * app.upsert_contact_candidate rechaza el alta si la categoría enviada no
   * coincide con app.research_role_category sobre el mismo cargo. Si estas dos
   * implementaciones se separan, cada escritura falla. Estos casos son los
   * mismos que verifica la migración M043 del lado de PostgreSQL.
   */
  const casos: Array<[string, string]> = [
    ["Coordinador de Seguridad e Higiene", "SAFETY"],
    ["EHS Manager", "SAFETY"],
    ["Gerente de Mantenimiento", "MAINTENANCE"],
    ["Director General", "CEO"],
    ["Jefe de Compras", "PROCUREMENT"],
    ["Gerente de Planta", "PLANT_DIRECTOR"],
    ["Analista de Marketing", "OTHER"],
  ];

  it.each(casos)("clasifica %s como %s, igual que la base", (cargo, esperado) => {
    expect(classifyRoleTitle(cargo)).toBe(esperado);
  });

  it("mantenimiento gana cuando el cargo mezcla seguridad y mantenimiento", () => {
    // Coincide con el orden de precedencia de app.research_role_category:
    // PROCUREMENT y MAINTENANCE se evalúan antes que SAFETY.
    expect(classifyRoleTitle("Gerente de Mantenimiento y Seguridad Industrial")).toBe("MAINTENANCE");
  });
});

describe("resumen de corrida", () => {
  it("arranca en ceros y declara el presupuesto de enriquecimiento", () => {
    const resumen = emptySummary(10);

    expect(resumen.accountsRequested).toBe(10);
    expect(resumen.candidatesWritten).toBe(0);
    expect(resumen.enrichBudgetLimit).toBe(ENRICH_LIMIT_PER_RUN);
  });
});
