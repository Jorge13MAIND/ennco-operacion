import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import { randomBytes } from "node:crypto";
import type {
  JsonRecord,
  ProjectRecord,
  ProjectSummary,
} from "../../src/lib/projects/types";

test.skip(
  process.env.ENNCO_PROJECTS_E2E !== "true",
  "Usar el entorno sintético aislado de playwright.projects.config.ts.",
);
const origin = process.env.PROJECTS_E2E_BASE_URL ?? "http://localhost:3017";
const operationKey = () => randomBytes(32).toString("hex");
const headers = () => ({ Origin: origin, "Idempotency-Key": operationKey() });
type Detail = {
  project: {
    id: string;
    version: number;
    segment: string;
    stage: string;
    data: JsonRecord;
  };
  records: ProjectRecord[];
  summary: ProjectSummary;
  readiness: { demo: boolean };
};
async function accepted(response: APIResponse, step: string): Promise<Detail> {
  expect(response.status(), `${step}: ${await response.text()}`).toBe(200);
  return response.json();
}
function solarDesign() {
  return {
    moduleCount: 10,
    module: {
      model: "Módulo sintético 500 W",
      sourceRef: "synthetic:lifecycle-module",
      powerW: 500,
      vocV: 50,
      vmpV: 40,
      iscA: 14,
      impA: 12.5,
      vocTemperaturePctPerC: -0.3,
      vmpTemperaturePctPerC: -0.4,
    },
    inverter: {
      model: "Inversor sintético 5 kW",
      sourceRef: "synthetic:lifecycle-inverter",
      acPowerKw: 5,
      maxDcVoltageV: 600,
      mpptMinV: 200,
      mpptMaxV: 550,
      mpptCount: 2,
      maxInputCurrentPerMpptA: 20,
      maxShortCircuitCurrentPerMpptA: 25,
      maxDcPowerKw: 7,
    },
    mpptStrings: [{ mppt: 1, modulesInSeries: 10, parallelStrings: 1 }],
    temperature: {
      minCellC: 0,
      maxCellC: 75,
      sourceRef: "synthetic:cell-extremes",
    },
    shortCircuitDesignFactor: 1.25,
    currentFactorSourceRef: "synthetic:current-factor",
    performanceRatio: 0.8,
    performanceRatioSourceRef: "synthetic:losses",
    monthlyResource: Array.from({ length: 12 }, (_, index) => ({
      month: `2026-${String(index + 1).padStart(2, "0")}`,
      dailyPlaneOfArrayKwhM2: 5,
      sourceRef: "synthetic:lifecycle-resource",
      datasetPeriod: "Escenario sintético; no es medición",
      tiltDeg: 20,
      azimuthDeg: 0,
    })),
  };
}
// Independent calendar oracle for the real confirmation day of these September 2026 fixtures.
// It deliberately does not import the production financial calendar function.
function fiveBusinessDays(confirmation: string) {
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(confirmation));
  const date = new Date(`${local}T12:00:00Z`);
  let remaining = 5;
  while (remaining) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.toISOString().slice(0, 10);
    if (
      date.getUTCDay() !== 0 &&
      date.getUTCDay() !== 6 &&
      day !== "2026-09-16"
    )
      remaining--;
  }
  return date.toISOString().slice(0, 10);
}

for (const [segment, systems] of [
  ["RESIDENTIAL", 1],
  ["COMMERCIAL", 2],
  ["INDUSTRIAL", 4],
] as const) {
  test(`ciclo completo sintético ${segment}: expediente, ingeniería, compras, cobros y cierre`, async ({
    request,
  }: {
    request: APIRequestContext;
  }) => {
    const title = `Ciclo sintético ${segment} ${operationKey().slice(0, 8)}`;
    let state = await accepted(
      await request.post("/api/v1/projects", {
        headers: headers(),
        data: {
          name: title,
          segment,
          customerName: "Cliente ficticio de prueba integral",
          contactName: "Contacto sintético",
          location: "Sitio ficticio, México",
          scope:
            "Instalación solar sintética para verificar el ciclo de software.",
        },
      }),
      "alta",
    );
    expect(state.readiness.demo).toBe(true);
    expect(state.project.data.opportunityId).toBeUndefined();
    const endpoint = `/api/v1/projects/${state.project.id}`;
    const append = async (kind: ProjectRecord["kind"], data: JsonRecord) => {
      state = await accepted(
        await request.post(`${endpoint}/records`, {
          headers: headers(),
          data: { expectedVersion: state.project.version, kind, data },
        }),
        kind,
      );
      return state.records.filter((record) => record.kind === kind).at(-1)!;
    };
    await append("receipt", {
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      kWh: 800 * systems,
      amountMxn: 2000 * systems,
      tariff: segment === "INDUSTRIAL" ? "GDMTH" : "PDBT",
      confirmed: true,
      source: "MANUAL",
      notes: "Dato sintético revisado para esta prueba; no proviene de Paco.",
    });
    const input = {
      segment,
      ...(systems === 1
        ? { solar: solarDesign() }
        : {
            solarSystems: Array.from({ length: systems }, (_, index) => ({
              id: `SISTEMA-${index + 1}`,
              design: solarDesign(),
            })),
          }),
    };
    state = await accepted(
      await request.post(`${endpoint}/calculate`, {
        headers: headers(),
        data: { expectedVersion: state.project.version, input },
      }),
      "cálculo",
    );
    const calculation = state.records.find(
      (record) => record.kind === "calculation",
    )!;
    const calculated = calculation.data.result as JsonRecord;
    expect(calculated.status).toBe("READY_FOR_REVIEW");
    expect(calculated.missingData).toEqual([]);
    const solar = (
      systems === 1 ? calculated.solar : calculated.solarTotals
    ) as JsonRecord;
    expect(solar.capacityKw).toBe(5 * systems);
    expect(solar.annualGenerationKwh).toBe(7300 * systems);
    await append("technical_review", {
      calculationId: calculation.id,
      decision: "APPROVED",
      notes:
        "Revisión sintética del motor; no acredita aprobación técnica de Paco.",
      evidence:
        "Caso de cálculo independiente: 20 kWh/día por sistema durante 365 días.",
      reviewedSections: ["solar"],
    });
    const proposal = await append("proposal", {
      name: "Propuesta sintética de prueba",
      calculationId: calculation.id,
      pricingMethod: "COST_PLUS_MARGIN",
      capacityWp: 5000 * systems,
      marginPct: 20,
      discountPct: 0,
      vatPct: 16,
      costLines: [
        {
          category: "Paneles solares",
          description: "Partida sintética de suministro",
          quantity: 10 * systems,
          unitCostMxn: 800,
        },
      ],
      validUntil: "2026-12-31",
      conditions: "Condiciones sintéticas; no constituye una oferta real.",
    });
    expect(proposal.data.subtotalMxn).toBe(10000 * systems);
    expect(proposal.data.totalMxn).toBe(11600 * systems);
    const frozenProposal = structuredClone(proposal.data);
    const acceptance = await append("proposal_acceptance", {
      proposalId: proposal.id,
      acceptedAt: "2026-09-10",
      customerEvidence: "Aceptación sintética exclusiva del caso de prueba.",
    });
    const originalBudget = await append("budget", {
      name: "Presupuesto original",
      proposalId: proposal.id,
      lines: [
        {
          category: "Paneles solares",
          description: "Costo originalmente autorizado",
          amountMxn: 8000 * systems,
        },
      ],
      reason: "Referencia inicial sintética.",
      approved: true,
    });
    const revisedBudget = await append("budget", {
      name: "Presupuesto revisado",
      proposalId: proposal.id,
      lines: [
        {
          category: "Paneles solares",
          description: "Costo revisado y autorizado",
          amountMxn: 7800 * systems,
        },
      ],
      reason:
        "Nueva revisión sintética por negociación de adquisición; se conserva la original.",
      approved: true,
    });
    const contract = await append("contract", {
      proposalId: proposal.id,
      acceptanceId: acceptance.id,
      evidence:
        "Contrato sintético de prueba; no es un contrato suscrito por ENNCO.",
      scope: "Alcance del caso de software sintético",
      subtotalMxn: 10000 * systems,
      vatMxn: 1600 * systems,
      totalMxn: 11600 * systems,
      advanceAmountMxn: 5800 * systems,
      startDate: "2026-09-10",
      durationDays: 30,
      schedule: [
        {
          id: "advance",
          label: "Anticipo",
          amountMxn: 5800 * systems,
          dueDate: "2026-09-10",
        },
        {
          id: "balance",
          label: "Saldo a entrega",
          amountMxn: 5800 * systems,
          dueDate: "2026-10-10",
        },
      ],
      terms: "Términos sintéticos de prueba",
      warranties: "Garantías no reales; dato sintético de prueba.",
    });
    const orderData = {
      supplier: "Proveedor ficticio",
      reference: "OC-SINTETICA-1",
      major: true,
      deliveryDate: "2026-10-01",
      lines: [
        {
          id: "modules",
          category: "Paneles solares",
          description: "Módulo sintético",
          quantity: 10 * systems,
          unit: "pieza",
          unitCostMxn: 760,
        },
      ],
      subtotalMxn: 7600 * systems,
      vatMxn: 1216 * systems,
      totalMxn: 8816 * systems,
      evidence: "Orden de compra sintética.",
    };
    expect(state.summary.purchasesReleased).toBe(false);
    expect(
      (
        await request.post(`${endpoint}/records`, {
          headers: headers(),
          data: {
            expectedVersion: state.project.version,
            kind: "purchase_order",
            data: orderData,
          },
        })
      ).status(),
    ).toBe(409);
    const advance = await append("customer_payment", {
      contractId: contract.id,
      scheduleId: "advance",
      amountMxn: 5800 * systems,
      paidAt: "2026-09-10",
      method: "Transferencia sintética",
      reference: "CLIENTE-ANTICIPO",
      evidence: "Comprobante sintético de anticipo",
      confirmed: true,
    });
    expect(state.summary.purchasesReleased).toBe(true);
    expect(state.summary.purchaseDueDate).toBe(
      fiveBusinessDays(advance.createdAt),
    );
    expect(state.summary.nextPayment?.label).toBe("Saldo a entrega");
    expect(state.summary.nextPayment?.amountMxn).toBe(5800 * systems);
    const order = await append("purchase_order", orderData);
    await append("material_receipt", {
      purchaseOrderId: order.id,
      receivedAt: "2026-09-10",
      lines: [{ lineId: "modules", quantity: 4 * systems }],
      evidence: "Recepción parcial sintética 1",
    });
    await append("material_receipt", {
      purchaseOrderId: order.id,
      receivedAt: "2026-09-11",
      lines: [{ lineId: "modules", quantity: 6 * systems }],
      evidence: "Recepción parcial sintética 2",
    });
    const expense = await append("expense", {
      purchaseOrderId: order.id,
      supplier: "Proveedor ficticio",
      invoiceNumber: "FACTURA-SINTETICA-1",
      date: "2026-09-10",
      category: "Paneles solares",
      description: "Costo sintético de adquisición",
      subtotalMxn: 7600 * systems,
      vatMxn: 1216 * systems,
      totalMxn: 8816 * systems,
      costBasisMxn: 7600 * systems,
      dueDate: "2026-10-01",
      evidence: "Factura ficticia de proveedor",
    });
    for (const part of [1, 2])
      await append("supplier_payment", {
        expenseId: expense.id,
        amountMxn: 4408 * systems,
        paidAt: "2026-09-10",
        method: "Transferencia sintética",
        reference: `PROVEEDOR-PARCIAL-${part}`,
        evidence: `Comprobante sintético proveedor ${part}`,
      });
    expect(state.summary.incurredMxn).toBe(7600 * systems);
    expect(state.summary.committedMxn).toBe(7600 * systems);
    expect(state.summary.supplierPaidMxn).toBe(8816 * systems);
    expect(state.summary.projectedCostMxn).toBe(7800 * systems);
    const invoice = await append("customer_invoice", {
      contractId: contract.id,
      number: "FACTURA-CLIENTE-SINTETICA",
      date: "2026-09-10",
      subtotalMxn: 10000 * systems,
      vatMxn: 1600 * systems,
      totalMxn: 11600 * systems,
      evidence: "Factura ficticia del cliente",
    });
    expect(state.summary.collectedMxn).toBe(5800 * systems); // Issuing an invoice does not collect cash.
    await append("progress", {
      date: "2026-09-10",
      responsible: "Responsable sintético",
      percent: 100,
      description: "Ejecución completa del caso de prueba",
      evidence: "Evidencia sintética de avance físico",
    });
    expect(
      state.summary.alerts.some(
        (alert) => alert.code === "PROGRESS_AHEAD_OF_COLLECTION",
      ),
    ).toBe(true);
    await append("technical_closure", {
      checks: { tests: true, handover: true, warranties: true },
      evidence: "Entrega técnica sintética de prueba",
      notes: "Cierre técnico independiente del saldo financiero.",
    });
    expect(state.summary.technicalClosed).toBe(true);
    expect(state.summary.financialClosed).toBe(false);
    expect(state.summary.balanceMxn).toBe(5800 * systems);
    expect(
      (
        await request.post(`${endpoint}/records`, {
          headers: headers(),
          data: {
            expectedVersion: state.project.version,
            kind: "financial_closure",
            data: {
              evidence: "Prueba de cierre prematuro",
              notes: "Debe rechazarse mientras exista saldo.",
            },
          },
        })
      ).status(),
    ).toBe(409);
    await append("customer_payment", {
      contractId: contract.id,
      invoiceId: invoice.id,
      scheduleId: "balance",
      amountMxn: 5800 * systems,
      paidAt: "2026-09-11",
      method: "Transferencia sintética",
      reference: "CLIENTE-SALDO",
      evidence: "Comprobante sintético del saldo",
      confirmed: true,
    });
    await append("financial_closure", {
      evidence:
        "Conciliación sintética completa de facturas, pagos, gastos y parcialidades.",
      notes:
        "Cierre financiero del caso de software; no es aceptación operativa de Paco.",
    });
    expect(state.summary).toMatchObject({
      contractedMxn: 11600 * systems,
      invoicedMxn: 11600 * systems,
      collectedMxn: 11600 * systems,
      balanceMxn: 0,
      incurredMxn: 7600 * systems,
      committedMxn: 7600 * systems,
      supplierPaidMxn: 8816 * systems,
      budgetMxn: 7800 * systems,
      projectedCostMxn: 7600 * systems,
      estimatedProfitMxn: 2000 * systems,
      projectedProfitMxn: 2400 * systems,
      actualProfitMxn: 2400 * systems,
      physicalProgressPct: 100,
      collectedPct: 100,
      nextPayment: null,
      technicalClosed: true,
      financialClosed: true,
    });
    expect(
      state.records.find((record) => record.id === proposal.id)?.data,
    ).toEqual(frozenProposal);
    expect(
      state.records.find((record) => record.id === originalBudget.id)?.data
        .lines,
    ).toEqual(originalBudget.data.lines);
    expect(
      state.records.filter((record) => record.kind === "budget"),
    ).toHaveLength(2);
    expect(revisedBudget.revision).toBeGreaterThan(originalBudget.revision);
    expect(
      state.records.find((record) => record.id === calculation.id)?.data
        .inputHash,
    ).toBe(calculation.data.inputHash);
    for (const kind of ["proposal", "technical", "financial", "contract"]) {
      const pdf = await request.get(`${endpoint}/pdf?kind=${kind}`);
      expect(pdf.status(), `PDF ${kind}`).toBe(200);
      expect(pdf.headers()["content-type"]).toBe("application/pdf");
      expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    }
    state = await accepted(
      await request.patch(endpoint, {
        headers: headers(),
        data: { expectedVersion: state.project.version, stage: "CLOSED" },
      }),
      "estado cerrado",
    );
    expect(state.project.stage).toBe("CLOSED");
    expect(
      (await accepted(await request.get(endpoint), "relectura final")).summary
        .actualProfitMxn,
    ).toBe(2400 * systems);
  });
}
