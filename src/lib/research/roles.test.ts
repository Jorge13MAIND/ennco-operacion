import { describe, expect, it } from "vitest";

import {
  calculateAccountRoleCoverage,
  classifyRoleTitle,
  normalizeRoleTitle,
} from "@/lib/research/roles";

describe("research buyer role taxonomy", () => {
  it.each([
    ["Director General", "CEO"],
    ["Chief Executive Officer", "CEO"],
    ["Gerente de Planta", "PLANT_DIRECTOR"],
    ["Plant Manager", "PLANT_DIRECTOR"],
    ["Jefa de Mantenimiento", "MAINTENANCE"],
    ["Maintenance Director", "MAINTENANCE"],
    ["Gerente de Compras", "PROCUREMENT"],
    ["Strategic Sourcing Manager", "PROCUREMENT"],
    ["Ingeniería de procesos", "OTHER"],
  ] as const)("classifies %s as %s", (title, expected) => {
    expect(classifyRoleTitle(title)).toBe(expected);
  });

  it("normalizes Spanish accents and punctuation", () => {
    expect(normalizeRoleTitle("  Dirección, de MANTENIMIENTO  ")).toBe("direccion de mantenimiento");
  });

  it("calculates verified coverage and exposes missing role categories", () => {
    const coverage = calculateAccountRoleCoverage(["account-a", "account-b"], [
      { accountId: "account-a", category: "CEO", verified: true },
      { accountId: "account-a", category: "MAINTENANCE", verified: true },
      { accountId: "account-a", category: "PROCUREMENT", verified: false },
      { accountId: "account-b", category: "OTHER", verified: true },
    ]);
    expect(coverage[0]).toMatchObject({
      verifiedTargetContacts: 2,
      presentCategories: ["CEO", "MAINTENANCE"],
      missingCategories: ["PLANT_DIRECTOR", "PROCUREMENT"],
    });
    expect(coverage[1]?.verifiedTargetContacts).toBe(0);
  });

  it("fails closed for duplicate accounts or a contact outside the inventory", () => {
    expect(() => calculateAccountRoleCoverage(["account-a", "account-a"], [])).toThrow("DUPLICATE_ACCOUNT_ID");
    expect(() => calculateAccountRoleCoverage(["account-a"], [
      { accountId: "account-b", category: "CEO", verified: true },
    ])).toThrow("CONTACT_ACCOUNT_NOT_IN_INVENTORY");
  });
});
