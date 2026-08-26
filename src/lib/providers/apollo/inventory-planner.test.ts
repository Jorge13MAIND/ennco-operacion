import { describe, expect, it } from "vitest";

import { buildApolloInventoryPlan } from "@/lib/providers/apollo/inventory-planner";

const hash = "a".repeat(64);

function account(index: number, tier: "TIER_1" | "TIER_2" = "TIER_2") {
  return {
    canonicalId: `account-${index}`,
    legalName: `Industrial ${index}`,
    primaryDomain: `industrial-${index}.example`,
    state: index % 2 === 0 ? "GUANAJUATO" as const : "QUERETARO" as const,
    tier,
    evidenceComplete: true as const,
    dedupeClear: true as const,
    sourceUrl: `https://industrial-${index}.example/evidence`,
  };
}

function people(index: number) {
  return [
    {
      apolloPersonId: `person-${index}-plant`,
      accountCanonicalId: `account-${index}`,
      fullName: `Persona Planta ${index}`,
      roleTitle: "Gerente de planta",
      email: null,
      emailStatus: "unknown" as const,
    },
    {
      apolloPersonId: `person-${index}-maintenance`,
      accountCanonicalId: `account-${index}`,
      fullName: `Persona Mantenimiento ${index}`,
      roleTitle: "Gerente de mantenimiento",
      email: null,
      emailStatus: "unknown" as const,
    },
  ];
}

describe("buildApolloInventoryPlan", () => {
  it("prepara 150 empresas y 300 contactos sin autorización comercial", () => {
    const accounts = Array.from({ length: 150 }, (_, index) => account(index, index < 25 ? "TIER_1" : "TIER_2"));
    const plan = buildApolloInventoryPlan({
      accounts,
      people: accounts.flatMap((_, index) => people(index)),
      suppression: { normalizedNames: [], domains: [], manifestSha256: hash },
      observedAt: "2026-08-25T18:00:00-06:00",
    });

    expect(plan.state).toBe("RESEARCH_READY");
    expect(plan.accounts).toHaveLength(150);
    expect(plan.contacts).toHaveLength(300);
    expect(plan.budget.planned_email_reveals).toBe(300);
    expect(plan.external_send_allowed).toBe(false);
    expect(plan.outreach_eligible_records).toBe(0);
  });

  it("elimina Anexo A antes de seleccionar cuentas y contactos", () => {
    const plan = buildApolloInventoryPlan({
      accounts: [account(1), { ...account(2), legalName: "POSCO MPPC", primaryDomain: "poscomppc.com.mx" }],
      people: [...people(1), ...people(2)],
      suppression: {
        normalizedNames: ["POSCO MPPC"],
        domains: ["poscomppc.com.mx"],
        manifestSha256: hash,
      },
      observedAt: "2026-08-25T18:00:00-06:00",
    });

    expect(plan.accounts.map((item) => item.legal_name)).not.toContain("POSCO MPPC");
    expect(plan.contacts.some((item) => item.account_canonical_id === "account-2")).toBe(false);
    expect(plan.rejected.suppressed_accounts).toBe(1);
    expect(plan.state).toBe("EXTEND");
  });

  it("rechaza roles repetidos, contactos huérfanos y emails no verificados", () => {
    const seedPeople = people(1);
    const plantPerson = seedPeople[0]!;
    const plan = buildApolloInventoryPlan({
      accounts: [account(1)],
      people: [
        plantPerson,
        { ...plantPerson, apolloPersonId: "duplicate-role" },
        { ...plantPerson, apolloPersonId: "orphan", accountCanonicalId: "missing" },
        { ...plantPerson, apolloPersonId: "unverified", roleTitle: "Director general", email: "a@example.com", emailStatus: "guessed" as const },
      ],
      suppression: { normalizedNames: [], domains: [], manifestSha256: hash },
      observedAt: "2026-08-25T18:00:00-06:00",
    });

    expect(plan.state).toBe("EXTEND");
    expect(plan.rejected.orphan_people).toBe(1);
    expect(plan.rejected.duplicate_people).toBeGreaterThan(0);
    expect(plan.blockers).toContain("UNVERIFIED_EMAIL_PRESENT");
    expect(plan.snapshot_sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("falla cerrado ante input inválido", () => {
    const plan = buildApolloInventoryPlan({
      accounts: [],
      people: [],
      suppression: { normalizedNames: [], domains: [], manifestSha256: "bad" },
      observedAt: "not-a-date",
    });
    expect(plan.state).toBe("KILL");
    expect(plan.blockers).toEqual(["APOLLO_INVENTORY_INPUT_INVALID"]);
    expect(plan.external_send_allowed).toBe(false);
  });
});
