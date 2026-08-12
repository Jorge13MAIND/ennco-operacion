import { describe, expect, it } from "vitest";

import { buildCompaniesContactsExportRows } from "@/lib/exports/datasets";

describe("companies and contacts export", () => {
  it("conserva empresas aunque todavía no tengan contacto", () => {
    const result = buildCompaniesContactsExportRows([
      { id: "account-1", legal_name: "Cuenta sin contacto", source_confidence: "VERIFIED" },
      { id: "account-2", legal_name: "Cuenta con contacto", source_confidence: "HIGH" },
    ], [
      { account_id: "account-2", full_name: "Persona sintética", role_title: "CEO", normalized_email: "synthetic@example.invalid", verified: true },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ account_name: "Cuenta sin contacto", contact_name: undefined });
    expect(result[1]).toMatchObject({ account_name: "Cuenta con contacto", contact_name: "Persona sintética" });
  });

  it("emite una fila por contacto sin duplicar la empresa sin contacto", () => {
    const result = buildCompaniesContactsExportRows([
      { id: "account-1", legal_name: "Cuenta sintética" },
    ], [
      { account_id: "account-1", full_name: "Persona uno" },
      { account_id: "account-1", full_name: "Persona dos" },
    ]);
    expect(result.map((row) => row.contact_name)).toEqual(["Persona uno", "Persona dos"]);
  });
});
