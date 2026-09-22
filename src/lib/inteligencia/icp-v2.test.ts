import { describe, expect, it } from "vitest";

import { ICP_V2_VERSION, scoreAccountV2, type IcpV2Input } from "@/lib/inteligencia/icp-v2";

const base: IcpV2Input = {
  legal_name: "Hiho Wheel México", state: "Guanajuato", city: "Apaseo El Grande", sector: "automotive",
  primary_domain: "hihomexico.com.mx", tier: "1", contact_roles: ["Maintenance Manager", "Plant Manager"], has_hook: true,
};

describe("ICP v2", () => {
  it("una empresa del contrato, giro caro, dos hilos, gancho y tier 1 cae en banda A", () => {
    const s = scoreAccountV2(base);
    expect(s.band).toBe("A");
    expect(s.score).toBe(100);
    expect(s.missing).toEqual([]);
    expect(s.rubric_version).toBe(ICP_V2_VERSION);
  });

  it("fuera de los cuatro estados del contrato no se puntúa: devuelve cero, no un número que invite a contactarla", () => {
    const s = scoreAccountV2({ ...base, state: "Nuevo León" });
    expect(s.band).toBe("FUERA_DE_CONTRATO");
    expect(s.score).toBe(0);
  });

  it("sin gancho baja de banda, y el faltante queda anotado en vez de suponerse", () => {
    const s = scoreAccountV2({ ...base, has_hook: false });
    expect(s.score).toBe(75);
    expect(s.band).toBe("A");
    expect(s.missing).toContain("gancho");
  });

  it("un solo hilo y tier 2 la mandan a banda B", () => {
    const s = scoreAccountV2({ ...base, has_hook: false, tier: "2", contact_roles: ["Maintenance Manager"] });
    expect(s.band).toBe("B");
  });

  it("un corporativo global con compras centralizadas no va por correo frío aunque puntúe alto", () => {
    const s = scoreAccountV2({ ...base, legal_name: "HEINEKEN MÉXICO" });
    expect(s.strategic_account).toBe(true);
    expect(s.band).toBe("C");
    expect(s.score).toBe(70);
  });

  it("Michoacán de Ocampo cuenta como Michoacán", () => {
    expect(scoreAccountV2({ ...base, state: "Michoacán de Ocampo" }).band).not.toBe("FUERA_DE_CONTRATO");
  });

  it("sin contactos ni dominio no se rompe: puntúa bajo y lo dice", () => {
    const s = scoreAccountV2({ ...base, contact_roles: [], primary_domain: null, has_hook: false, tier: null, sector: null });
    expect(s.score).toBe(0);
    expect(s.band).toBe("C");
    expect(s.missing).toEqual(expect.arrayContaining(["sector", "contactos", "gancho", "tier", "dominio"]));
  });
});
