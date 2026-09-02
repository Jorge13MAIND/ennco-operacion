import { describe, expect, it } from "vitest";

import { directLaneVariantForRole } from "@/lib/correos/roles";

describe("direct lane variant by role", () => {
  it.each([
    ["Purchasing Manager", "COMPRAS"],
    ["Jefe de Compras Indirectas", "COMPRAS"],
    ["Coordinador de Seguridad e Higiene", "SEGURIDAD"],
    ["EHS Manager", "SEGURIDAD"],
    ["Seguridad, higiene y mantenimiento", "SEGURIDAD"],
    ["Gerente de Mantenimiento", "MANTENIMIENTO"],
    ["Plant Manager", "MANTENIMIENTO"],
    ["Ingeniero Eléctrico", "MANTENIMIENTO"],
    ["Director General", "DIRECCION"],
    ["CEO", "DIRECCION"],
    ["", "DIRECCION"],
    [null, "DIRECCION"],
  ])("maps %s → %s", (role, expected) => {
    expect(directLaneVariantForRole(role)).toBe(expected);
  });
});
