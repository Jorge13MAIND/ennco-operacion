import { inflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  buildProjectDocumentLines,
  generateProjectPdf,
  projectPdfSafeText,
  type ProjectDocumentKind,
} from "./documents";
import { calculateEngineering } from "./engineering";
import type {
  ProjectAccess,
  ProjectBundle,
  ProjectRecord,
  RecordKind,
} from "./types";

const permissions = (): ProjectAccess => ({
  areas: ["direction"],
  readOnly: false,
  canCreate: true,
  canEdit: true,
  canEngineer: true,
  canSell: true,
  canPurchase: true,
  canConfirmPayments: true,
  canApprove: true,
  canExecute: true,
  canReadCosts: true,
  canReadMargins: true,
  costScope: "ALL",
  canManageCatalogs: true,
  canManageMembers: true,
  canCloseFinancial: true,
});
const record = (
  id: string,
  kind: RecordKind,
  revision: number,
  data: ProjectRecord["data"],
): ProjectRecord => ({
  id,
  kind,
  revision,
  data,
  projectId: "p1",
  createdAt: `2026-09-${String(10 + revision).padStart(2, "0")}T12:00:00Z`,
  actorId: "tester",
});
const input = {
  segment: "RESIDENTIAL" as const,
  shadows: {
    panelSlopeLengthM: 2,
    tiltDeg: 30,
    designSolarElevationDeg: 45,
    additionalObstacleHeightM: 0,
    sourceRef: "survey:1",
  },
};
function bundle(): ProjectBundle {
  return {
    project: {
      id: "p1",
      organizationId: "o1",
      folio: "ENNCO-2026-0001",
      name: "Proyecto de prueba",
      segment: "RESIDENTIAL",
      customerName: "Cliente actual cambiado",
      contactName: "Contacto",
      email: "",
      phone: "",
      location: "Sitio actual cambiado",
      scope: "Alcance actual cambiado",
      stage: "PROPOSAL",
      lifecycle: "ACTIVE",
      version: 8,
      createdAt: "2026-09-10T12:00:00Z",
      updatedAt: "2026-09-18T12:00:00Z",
      data: { privateNote: "PROJECT_PRIVATE_MARKER" },
    },
    permissions: permissions(),
    records: [
      record("calc1", "calculation", 1, {
        input,
        result: calculateEngineering(input),
        inputHash: "hash-frozen",
        reviewStatus: "PENDING",
        rawPrivate: "CALC_PRIVATE_MARKER",
      }),
      record("review1", "technical_review", 2, {
        calculationId: "calc1",
        decision: "APPROVED",
        notes: "TECH_REVIEW_PRIVATE_MARKER",
      }),
      record("proposal1", "proposal", 3, {
        name: "Propuesta uno",
        calculationId: "calc1",
        customerSnapshot: {
          customerName: "Cliente congelado",
          contactName: "Paco",
          location: "Sitio congelado",
          scope: "Instalación de prueba",
        },
        capacityWp: 5000,
        subtotalMxn: 100000,
        vatMxn: 16000,
        totalMxn: 116000,
        conditions: "Pago conforme calendario",
        validUntil: "2026-10-15",
        costLines: [
          {
            category: "Paneles solares",
            description: "COST_SECRET_MARKER",
            quantity: 10,
            unitCostMxn: 37135,
          },
        ],
        costMxn: 371350,
        profitMxn: -271350,
        marginPct: 30,
        notes: "PROPOSAL_PRIVATE_MARKER",
      }),
      record("accept1", "proposal_acceptance", 4, {
        proposalId: "proposal1",
        acceptedAt: "2026-09-14",
        customerEvidence: "PRIVATE_ACCEPTANCE_URL",
      }),
      record("contract1", "contract", 5, {
        proposalId: "proposal1",
        scope: "Instalación de prueba",
        subtotalMxn: 100000,
        vatMxn: 16000,
        totalMxn: 116000,
        advanceAmountMxn: 58000,
        schedule: [
          {
            id: "a1",
            label: "Anticipo",
            amountMxn: 58000,
            dueDate: "2026-09-15",
            condition: "Al firmar",
          },
          {
            id: "a2",
            label: "Entrega",
            amountMxn: 58000,
            dueDate: "2026-10-15",
            condition: "Entrega técnica",
          },
        ],
        terms: "Términos particulares pendientes",
        warranties: "Garantías según anexos por completar",
        legalDetails: {
          legalNameEnnco: "Prestador ficticio de prueba",
          enncoRfc: "RFC-SINTETICO",
          workmanshipWarranty: "Periodo por acordar",
          equipmentWarranty: "Ficha del proveedor por validar",
        },
        evidence: "PRIVATE_SIGNED_CONTRACT_URL",
      }),
      record("budget1", "budget", 6, {
        name: "Presupuesto",
        approved: true,
        lines: [
          {
            category: "Paneles solares",
            description: "BUDGET_SECRET_MARKER",
            amountMxn: 60000,
          },
        ],
      }),
      record("expense1", "expense", 7, {
        category: "Paneles solares",
        supplier: "SUPPLIER_SECRET_MARKER",
        description: "EXPENSE_SECRET_MARKER",
        invoiceNumber: "F123",
        date: "2026-09-17",
        subtotalMxn: 50000,
        vatMxn: 8000,
        totalMxn: 58000,
        costBasisMxn: 50000,
      }),
      record("paid1", "supplier_payment", 8, {
        expenseId: "expense1",
        amountMxn: 58000,
        paidAt: "2026-09-18",
        reference: "SUPPLIER_PAYMENT_SECRET_MARKER",
      }),
    ],
  };
}

async function pdfText(
  bytes: Uint8Array,
): Promise<{ content: string; pages: number; hasAttachments: boolean }> {
  const pdf = await PDFDocument.load(bytes);
  const extracted: string[] = [];
  for (const [, value] of pdf.context.enumerateIndirectObjects()) {
    if (!(value instanceof PDFRawStream)) continue;
    const contents = value.getContents();
    let decoded: string;
    try {
      decoded = (
        value.dict.get(PDFName.of("Filter"))?.toString() === "/FlateDecode"
          ? inflateSync(contents)
          : Buffer.from(contents)
      ).toString("latin1");
    } catch {
      continue;
    }
    for (const match of decoded.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g))
      extracted.push(Buffer.from(match[1]!, "hex").toString("latin1"));
  }
  return {
    content: extracted.join("\n"),
    pages: pdf.getPageCount(),
    hasAttachments: pdf.catalog.get(PDFName.of("Names")) !== undefined,
  };
}

describe("documentos de Proyectos ENNCO", () => {
  it.each(["proposal", "technical", "contract"] as const)(
    "%s omite campos económicos internos y notas fuera de la lista permitida",
    (kind) => {
      const lines = buildProjectDocumentLines(bundle(), kind).join("\n");
      for (const secret of [
        "COST_SECRET_MARKER",
        "PROPOSAL_PRIVATE_MARKER",
        "PROJECT_PRIVATE_MARKER",
        "BUDGET_SECRET_MARKER",
        "SUPPLIER_SECRET_MARKER",
        "EXPENSE_SECRET_MARKER",
        "SUPPLIER_PAYMENT_SECRET_MARKER",
        "CALC_PRIVATE_MARKER",
        "PRIVATE_ACCEPTANCE_URL",
        "PRIVATE_SIGNED_CONTRACT_URL",
        "TECH_REVIEW_PRIVATE_MARKER",
      ])
        expect(lines).not.toContain(secret);
      expect(lines).not.toContain("marginPct");
      expect(lines).not.toContain("costLines");
      expect(lines).not.toContain("profitMxn");
    },
  );

  it("la propuesta usa el cliente y alcance congelados aunque el proyecto cambie", () => {
    const lines = buildProjectDocumentLines(
      bundle(),
      "proposal",
      "proposal1",
    ).join("\n");
    expect(lines).toContain("PROPUESTA ACEPTADA");
    expect(lines).toContain("Cliente congelado");
    expect(lines).toContain("Sitio congelado");
    expect(lines).not.toContain("Cliente actual cambiado");
    expect(lines).not.toContain("Alcance actual cambiado");
    expect(lines).toContain("$116,000.00 MXN");
  });

  it("sin snapshot o aprobación técnica conserva marca de borrador", () => {
    const b = bundle();
    delete b.records.find((r) => r.id === "proposal1")!.data.customerSnapshot;
    expect(buildProjectDocumentLines(b, "proposal").join("\n")).toContain(
      "Estado: BORRADOR",
    );
    const other = bundle();
    other.records.push(
      record("rejected", "technical_review", 9, {
        calculationId: "calc1",
        decision: "REJECTED",
      }),
    );
    expect(buildProjectDocumentLines(other, "proposal").join("\n")).toContain(
      "Estado: BORRADOR",
    );
  });

  it("aceptación anulada no se presenta como vigente", () => {
    const b = bundle();
    b.records.push(
      record("reversal1", "reversal", 9, {
        recordId: "accept1",
        reason: "Corrección",
      }),
    );
    expect(buildProjectDocumentLines(b, "proposal").join("\n")).toContain(
      "Estado: BORRADOR",
    );
  });

  it("selecciona la revisión solicitada y rechaza identificadores ajenos o tipo incorrecto", () => {
    const b = bundle();
    b.records.push(
      record("proposal2", "proposal", 9, {
        ...b.records.find((r) => r.id === "proposal1")!.data,
        name: "Propuesta dos",
        totalMxn: 200000,
      }),
    );
    expect(
      buildProjectDocumentLines(b, "proposal", "proposal1").join("\n"),
    ).toContain("Nombre: Propuesta uno");
    expect(buildProjectDocumentLines(b, "proposal").join("\n")).toContain(
      "Nombre: Propuesta dos",
    );
    expect(() => buildProjectDocumentLines(b, "proposal", "calc1")).toThrow(
      "DOCUMENT_REVISION_NOT_FOUND",
    );
    expect(() => buildProjectDocumentLines(b, "technical", "unknown")).toThrow(
      "DOCUMENT_REVISION_NOT_FOUND",
    );
  });

  it("contrato conserva propuesta aceptada y marca campos faltantes sin inventar garantías o identidad", () => {
    const lines = buildProjectDocumentLines(bundle(), "contract").join("\n");
    expect(lines).toContain("PLANTILLA PENDIENTE DE VALIDACIÓN LEGAL ENNCO");
    expect(lines).toContain("Propuesta de referencia: proposal1");
    expect(lines).toContain("Prestador ficticio de prueba");
    expect(lines).toContain("RFC-SINTETICO");
    expect(lines).toContain("$58,000.00 MXN");
    expect(lines).toContain("Porcentaje del total: 50 %");
    expect(lines).toContain("[POR COMPLETAR]");
    expect(lines).toContain("cierre técnico y la conciliación financiera");
    expect(lines).not.toContain("25 años");
    expect(lines).not.toContain("12 meses");
  });

  it("puede preparar contrato de propuesta aceptada antes de registrar contrato firmado", () => {
    const b = bundle();
    b.records = b.records.filter((r) => r.kind !== "contract");
    const lines = buildProjectDocumentLines(b, "contract").join("\n");
    expect(lines).toContain("Propuesta de referencia: proposal1");
    expect(lines).toContain("TOTAL A PAGAR: $116,000.00 MXN");
    expect(lines).toContain("Anticipo: [POR COMPLETAR]");
  });

  it("la memoria incluye entradas, método, fuentes y resultado de su revisión", () => {
    const lines = buildProjectDocumentLines(
      bundle(),
      "technical",
      "calc1",
    ).join("\n");
    expect(lines).toContain("Huella de entradas: hash-frozen");
    expect(lines).toContain("2.732 m");
    expect(lines).toContain("survey:1");
    expect(lines).toContain("REVISIÓN TÉCNICA APROBADA REGISTRADA");
  });

  it("restringe financiero en función de costos y alcance de permiso", () => {
    const b = bundle();
    b.permissions.canReadCosts = false;
    expect(() => buildProjectDocumentLines(b, "financial")).toThrow(
      "PROJECT_FINANCIAL_DOCUMENT_FORBIDDEN",
    );
    b.permissions.canReadCosts = true;
    b.permissions.costScope = "PURCHASES";
    expect(() => buildProjectDocumentLines(b, "financial")).toThrow(
      "PROJECT_FINANCIAL_DOCUMENT_FORBIDDEN",
    );
  });

  it("financiero calcula costos sin sumar otra vez el pago y separa permiso de utilidad", () => {
    const b = bundle();
    b.permissions.canReadMargins = false;
    const lines = buildProjectDocumentLines(b, "financial").join("\n");
    expect(lines).toContain("Costos incurridos: $50,000.00 MXN");
    expect(lines).toContain("Pagos a proveedores: $58,000.00 MXN");
    expect(lines).not.toContain("Utilidad del proyecto");
    expect(lines).not.toContain("Proyectada:");
    const authorized = buildProjectDocumentLines(bundle(), "financial").join(
      "\n",
    );
    expect(authorized).toContain("Utilidad del proyecto");
    expect(authorized).toContain("Estimada: $40,000.00 MXN");
  });

  it("corte financiero histórico excluye movimientos posteriores", () => {
    const lines = buildProjectDocumentLines(
      bundle(),
      "financial",
      "budget1",
    ).join("\n");
    expect(lines).toContain("Costos incurridos: $0.00 MXN");
    expect(lines).not.toContain("SUPPLIER_PAYMENT_SECRET_MARKER");
    expect(lines).not.toContain("EXPENSE_SECRET_MARKER");
  });

  it.each(["proposal", "technical", "contract", "financial"] as const)(
    "genera PDF %s paginado y legible",
    async (kind) => {
      const bytes = await generateProjectPdf(bundle(), kind);
      expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
      const extracted = await pdfText(bytes);
      expect(extracted.pages).toBeGreaterThan(0);
      expect(extracted.content).toContain("ENNCO");
      expect(extracted.content).toContain("ENNCO-2026-0001");
      expect(extracted.hasAttachments).toBe(false);
      if (kind !== "financial") {
        expect(extracted.content).not.toContain("COST_SECRET_MARKER");
        expect(extracted.content).not.toContain("EXPENSE_SECRET_MARKER");
        expect(extracted.content).not.toContain(
          "SUPPLIER_PAYMENT_SECRET_MARKER",
        );
      }
      if (kind === "contract") {
        expect(extracted.pages).toBeGreaterThan(1);
        expect(extracted.content).toContain("BORRADOR");
      }
    },
  );

  it("tolera unicode no WinAnsi y divide palabras largas sin desbordar páginas", async () => {
    const b = bundle();
    b.records.find((r) => r.id === "proposal1")!.data.conditions =
      `Español: áéíóú, ñ, °, m². Ω √3 → eléctrico 💠 中文. ${"abcdef".repeat(1500)}`;
    const extracted = await pdfText(await generateProjectPdf(b, "proposal"));
    expect(extracted.pages).toBeGreaterThan(1);
    expect(projectPdfSafeText("ángulo Ω √3 → 💠")).toContain(
      "ángulo ohm sqrt3  ->  ?",
    );
  });

  it("rechaza exportación financiera antes de producir bytes", async () => {
    const b = bundle();
    b.permissions.canReadCosts = false;
    await expect(generateProjectPdf(b, "financial")).rejects.toThrow(
      "PROJECT_FINANCIAL_DOCUMENT_FORBIDDEN",
    );
  });

  it("construcción de líneas no muta el expediente y rechaza tipos inexistentes", () => {
    const b = bundle(),
      original = structuredClone(b);
    buildProjectDocumentLines(b, "contract");
    expect(b).toEqual(original);
    expect(() =>
      buildProjectDocumentLines(b, "unexpected" as ProjectDocumentKind),
    ).toThrow("INVALID_PROJECT_DOCUMENT_KIND");
  });

  it("retorno comercial permite inversión y operación del sistema, excluyendo campos internos adicionales", () => {
    const b = bundle();
    b.records.find((r) => r.id === "proposal1")!.data.economics = {
      version: "ENNCO-SIMPLE-PAYBACK-1",
      status: "ESTIMATE",
      calculationId: "calc1",
      investmentMxn: 100000,
      annualEnergySavingsMxn: 22000,
      annualOperatingCostMxn: 2000,
      netAnnualSavingsMxn: 20000,
      simplePaybackYears: 5,
      periodFrom: "2026-01",
      periodTo: "2026-12",
      limitations: ["Estimación simple antes de IVA, no TIR."],
      privateCosts: "ECONOMICS_PRIVATE_MARKER",
      marginPct: 45,
    };
    const lines = buildProjectDocumentLines(b, "proposal").join("\n");
    expect(lines).toContain("Retorno simple: 5 años");
    expect(lines).toContain(
      "Operación anual del sistema antes de IVA: $2,000.00 MXN",
    );
    expect(lines).not.toContain("ECONOMICS_PRIVATE_MARKER");
    expect(lines).not.toContain("marginPct");
    b.records.find((r) => r.id === "proposal1")!.data.economics = {
      status: "UNAVAILABLE",
      simplePaybackYears: null,
      missingReason: "Falta operación anual explícita.",
    };
    expect(buildProjectDocumentLines(b, "proposal").join("\n")).toContain(
      "Retorno pendiente: Falta operación anual explícita.",
    );
  });
});
