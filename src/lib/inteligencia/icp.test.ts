import { describe, expect, it } from "vitest";

import { ICP_RUBRIC_VERSION, parseEmployeeBand, parseScian, scoreAccount, type IcpAccountInput } from "./icp";

const steeringmex: IcpAccountInput = {
  legal_name: "STEERINGMEX",
  state: "QUERETARO",
  city: "El Marqués",
  industrial_park: "FINSA",
  sector: "SCIAN 336330 · Fabricación de partes de sistemas de dirección y de suspensión para vehículos automotrices · 251 y más personas",
  primary_domain: null,
  profepa_certified: true,
};

describe("parseo del padrón", () => {
  it("extrae el SCIAN de la cadena real del sourcing", () => {
    expect(parseScian(steeringmex.sector)).toBe("336330");
    expect(parseScian("sin codigo")).toBeNull();
    expect(parseScian(null)).toBeNull();
  });

  it("extrae la banda de personal ocupado de DENUE", () => {
    expect(parseEmployeeBand(steeringmex.sector)).toBe("251+");
    expect(parseEmployeeBand("SCIAN 326 · plásticos · 101 a 250 personas")).toBe("101-250");
    expect(parseEmployeeBand("SCIAN 326 · plásticos · 51 a 100 personas")).toBe("51-100");
    expect(parseEmployeeBand("SCIAN 326 · plásticos · 11 a 30 personas")).toBe("MENOR");
    expect(parseEmployeeBand("sin banda")).toBe("DESCONOCIDO");
  });
});

describe("puntuación ICP", () => {
  it("una cuenta Tier 1 real llega a banda A con todos los factores", () => {
    const result = scoreAccount(steeringmex);

    expect(result.score).toBe(100);
    expect(result.band).toBe("A");
    expect(result.rubric_version).toBe(ICP_RUBRIC_VERSION);
    expect(result.missing).toEqual([]);
    expect(result.contract_only_state).toBe(false);
  });

  it("el estado es compuerta: fuera del contrato devuelve cero sin importar lo demás", () => {
    const result = scoreAccount({ ...steeringmex, state: "NUEVO LEON" });

    expect(result.score).toBe(0);
    expect(result.band).toBe("FUERA_DE_CONTRATO");
    expect(result.factors).toHaveLength(1);
  });

  it("marca los estados que el contrato incluye pero investigación todavía no", () => {
    const jalisco = scoreAccount({ ...steeringmex, state: "JALISCO" });

    expect(jalisco.band).toBe("A");
    expect(jalisco.contract_only_state).toBe(true);
  });

  it("acepta Michoacán con y sin el sufijo del nombre oficial", () => {
    expect(scoreAccount({ ...steeringmex, state: "MICHOACAN" }).band).toBe("A");
    expect(scoreAccount({ ...steeringmex, state: "Michoacán de Ocampo" }).band).toBe("A");
  });

  it("sin evidencia suma cero y lo deja anotado, nunca lo asume", () => {
    const result = scoreAccount({
      legal_name: "SIN DATOS SA DE CV",
      state: "GUANAJUATO",
      city: null,
      industrial_park: null,
      sector: null,
      primary_domain: null,
      profepa_certified: null,
    });

    expect(result.score).toBe(0);
    expect(result.band).toBe("D");
    expect(result.missing).toEqual(expect.arrayContaining(["tamaño", "profepa", "scian", "parque", "ciudad"]));
  });

  it("PROFEPA es la señal dominante frente a la manufactura no intensiva", () => {
    const conProfepa = scoreAccount({ ...steeringmex, sector: "SCIAN 311 · alimentos · 101 a 250 personas", profepa_certified: true });
    const sinProfepa = scoreAccount({ ...steeringmex, sector: "SCIAN 311 · alimentos · 101 a 250 personas", profepa_certified: false });

    expect(conProfepa.score - sinProfepa.score).toBe(25);
  });

  it("distingue giro intensivo de manufactura general y de no manufactura", () => {
    const puntos = (sector: string) =>
      scoreAccount({ ...steeringmex, sector }).factors.find((f) => f.key === "giro")?.points;

    expect(puntos("SCIAN 327 · minerales · 251 y más personas")).toBe(25);
    expect(puntos("SCIAN 311 · alimentos · 251 y más personas")).toBe(12);
    expect(puntos("SCIAN 461 · comercio · 251 y más personas")).toBe(0);
  });

  it("nunca produce una puntuación fuera de 0 a 100", () => {
    const casos: IcpAccountInput[] = [
      steeringmex,
      { ...steeringmex, profepa_certified: false, sector: null, city: null, industrial_park: null },
      { ...steeringmex, state: "COAHUILA" },
    ];

    for (const caso of casos) {
      const { score } = scoreAccount(caso);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});
