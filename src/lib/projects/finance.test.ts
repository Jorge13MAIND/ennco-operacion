import { describe, it, expect } from "vitest";
import {
  addBusinessDays,
  priceProposal,
  projectSummary,
  validateRecordTransition,
} from "./finance";
import { projectPermissions } from "./permissions";
import { parseRecordData } from "./schemas";
import type { ProjectRecord, RecordKind } from "./types";
const access = projectPermissions(["direction"]);
const r = (
  id: string,
  kind: RecordKind,
  data: Record<string, unknown>,
  createdAt = "2026-09-11T12:00:00Z",
): ProjectRecord => ({
  id,
  kind,
  data,
  createdAt,
  revision: 1,
  projectId: "p",
  actorId: "a",
});
const contract = r("c", "contract", {
  subtotalMxn: 1000,
  vatMxn: 160,
  totalMxn: 1160,
  advanceAmountMxn: 580,
  schedule: [
    { id: "a", label: "Anticipo", amountMxn: 580, dueDate: "2026-09-11" },
    { id: "b", label: "Entrega", amountMxn: 580, dueDate: "2026-10-01" },
  ],
});
describe("control financiero de proyectos", () => {
  it("cinco hábiles desde viernes y calendario explícito", () => {
    expect(addBusinessDays("2026-09-11", 5)).toBe("2026-09-21");
    expect(addBusinessDays("2026-09-11", 5, ["2026-09-16"])).toBe("2026-09-21");
  });
  it("margen sobre venta y USD/W se calculan antes de IVA sin doble descuento", () => {
    expect(
      priceProposal({
        pricingMethod: "COST_PLUS_MARGIN",
        marginPct: 20,
        discountPct: 10,
        vatPct: 16,
        costLines: [{ quantity: 2, unitCostMxn: 400 }],
      }),
    ).toMatchObject({
      subtotalMxn: 900,
      vatMxn: 144,
      totalMxn: 1044,
      profitMxn: 100,
    });
    expect(
      priceProposal({
        pricingMethod: "USD_PER_WATT",
        capacityWp: 1000,
        usdPerWatt: 1,
        exchangeRate: 20,
        discountPct: 0,
        vatPct: 16,
        costLines: [{ quantity: 1, unitCostMxn: 800 }],
      }).totalMxn,
    ).toBe(23200);
  });
  it("facturas y etiquetas no liberan compras; sólo anticipo confirmado acumulado", () => {
    const invoice = r("f", "customer_invoice", { totalMxn: 1160 });
    expect(projectSummary([contract, invoice], access).purchasesReleased).toBe(
      false,
    );
    const p = r("p", "customer_payment", {
      contractId: "c",
      amountMxn: 580,
      confirmed: false,
    });
    expect(projectSummary([contract, p], access).purchasesReleased).toBe(false);
    p.data.confirmed = true;
    expect(projectSummary([contract, p], access)).toMatchObject({
      purchasesReleased: true,
      collectedMxn: 580,
      purchaseDueDate: "2026-09-21",
      balanceMxn: 580,
    });
  });
  it("compromisos, facturas de proveedor y pagos no se suman como costos duplicados", () => {
    const rows = [
      contract,
      r("b", "budget", {
        approved: true,
        lines: [{ category: "Paneles solares", amountMxn: 700 }],
      }),
      r("o", "purchase_order", {
        subtotalMxn: 800,
        lines: [{ category: "Paneles solares", quantity: 1, unitCostMxn: 800 }],
      }),
      r("e", "expense", {
        purchaseOrderId: "o",
        category: "Paneles solares",
        subtotalMxn: 600,
        vatMxn: 96,
        totalMxn: 696,
        costBasisMxn: 600,
      }),
      r("p", "supplier_payment", { expenseId: "e", amountMxn: 348 }),
    ];
    expect(projectSummary(rows, access)).toMatchObject({
      committedMxn: 800,
      incurredMxn: 600,
      supplierPaidMxn: 348,
      projectedCostMxn: 800,
      projectedProfitMxn: 200,
    });
    expect(
      projectSummary(rows, projectPermissions(["sales"])),
    ).not.toHaveProperty("incurredMxn");
  });
  it("reversión conserva historial pero retira importes, y adicionales separados del contrato", () => {
    const rows = [
      contract,
      r("p", "customer_payment", {
        contractId: "c",
        amountMxn: 580,
        confirmed: true,
      }),
      r("rev", "reversal", { recordId: "p" }),
      r("ch", "change_order", {
        saleDeltaMxn: 116,
        saleVatDeltaMxn: 16,
        costDeltaMxn: 80,
      }),
      r("ap", "change_approval", { changeOrderId: "ch", decision: "APPROVED" }),
    ];
    expect(projectSummary(rows, access)).toMatchObject({
      contractedMxn: 1276,
      collectedMxn: 0,
      balanceMxn: 1276,
    });
  });
  it("recepción parcial y pagos no exceden saldo", () => {
    const order = r("o", "purchase_order", {
      lines: [{ id: "x", quantity: 10 }],
    });
    const receipt = r("r", "material_receipt", {
      purchaseOrderId: "o",
      lines: [{ lineId: "x", quantity: 7 }],
    });
    expect(() =>
      validateRecordTransition(
        [order, receipt],
        "material_receipt",
        { purchaseOrderId: "o", lines: [{ lineId: "x", quantity: 4 }] },
        access,
      ),
    ).toThrow("RECEIPT_EXCEEDS_ORDER");
    expect(() =>
      validateRecordTransition(
        [contract],
        "customer_payment",
        { contractId: "c", confirmed: true, amountMxn: 1200 },
        access,
      ),
    ).toThrow("PAYMENT_EXCEEDS_CONTRACT");
  });
  it("cierre técnico permite saldo; financiero exige conciliación o excepción dirección", () => {
    const rows = [contract, r("close", "technical_closure", {})];
    expect(projectSummary(rows, access)).toMatchObject({
      technicalClosed: true,
      financialClosed: false,
      balanceMxn: 1160,
    });
    expect(() =>
      validateRecordTransition(rows, "financial_closure", {}, access),
    ).toThrow();
    expect(() =>
      validateRecordTransition(
        rows,
        "financial_closure",
        { exceptionReason: "Saldo retenido aprobado con evidencia" },
        access,
      ),
    ).not.toThrow();
  });
  it("rechaza totales inconsistentes y precios calculados inyectados", () => {
    expect(() =>
      parseRecordData("customer_invoice", {
        contractId: "00000000-0000-4000-8000-000000000001",
        number: "A",
        date: "2026-09-10",
        subtotalMxn: 100,
        vatMxn: 16,
        totalMxn: 100,
        evidence: "doc",
      }),
    ).toThrow();
    expect(() => parseRecordData("proposal", { profitMxn: 100 })).toThrow();
  });
});

it("una revisión de presupuesto no vuelve a sumar adicionales incluidos", () => {
  const rows = [
    contract,
    r("ch", "change_order", {
      saleDeltaMxn: 116,
      saleVatDeltaMxn: 16,
      costDeltaMxn: 80,
    }),
    r("ap", "change_approval", { changeOrderId: "ch", decision: "APPROVED" }),
    r("b", "budget", {
      approved: true,
      lines: [{ category: "Paneles solares", amountMxn: 780 }],
      includedChangeOrderIds: ["ch"],
    }),
  ];
  expect(projectSummary(rows, access).budgetMxn).toBe(780);
});

it("un cobro se distribuye entre dos cuotas sin duplicar el total recibido", () => {
  const payment = r("p", "customer_payment", {
    contractId: "c",
    amountMxn: 1160,
    confirmed: true,
  });
  const allocation = r("a", "customer_payment_allocation", {
    paymentId: "p",
    allocations: [
      { scheduleId: "a", amountMxn: 580 },
      { scheduleId: "b", amountMxn: 580 },
    ],
  });
  const summary = projectSummary([contract, payment, allocation], access);
  expect(summary.collectedMxn).toBe(1160);
  expect(summary.nextPayment).toBeNull();
  expect(
    summary.alerts.some((a) => a.code === "PAYMENT_ALLOCATION_PENDING"),
  ).toBe(false);
});
it("el costo final sustituye la proyección y la utilidad estimada conserva su base original", () => {
  const budget = r("b", "budget", {
    approved: true,
    lines: [{ category: "Paneles solares", amountMxn: 700 }],
  });
  const summary = projectSummary(
    [
      contract,
      budget,
      r("ch", "change_order", {
        saleDeltaMxn: 116,
        saleVatDeltaMxn: 16,
        costDeltaMxn: 80,
      }),
      r("ap", "change_approval", { changeOrderId: "ch", decision: "APPROVED" }),
      r("e", "expense", { costBasisMxn: 600 }),
      r("close", "financial_closure", {}),
    ],
    access,
  );
  expect(summary).toMatchObject({
    estimatedProfitMxn: 300,
    projectedCostMxn: 600,
    projectedProfitMxn: 500,
    actualProfitMxn: 500,
  });
});

it("reasignar exige el cobro completo y protege cuotas ya ocupadas", () => {
  const p1 = r("p1", "customer_payment", {
      contractId: "c",
      confirmed: true,
      amountMxn: 580,
      scheduleId: "a",
    }),
    p2 = r("p2", "customer_payment", {
      contractId: "c",
      confirmed: true,
      amountMxn: 580,
    });
  expect(() =>
    validateRecordTransition(
      [contract, p1, p2],
      "customer_payment_allocation",
      { paymentId: "p2", allocations: [{ scheduleId: "b", amountMxn: 100 }] },
      access,
    ),
  ).toThrow("ALLOCATION_TOTAL_MISMATCH");
  expect(() =>
    validateRecordTransition(
      [contract, p1, p2],
      "customer_payment_allocation",
      { paymentId: "p2", allocations: [{ scheduleId: "a", amountMxn: 580 }] },
      access,
    ),
  ).toThrow("PAYMENT_EXCEEDS_INSTALLMENT");
  expect(() =>
    validateRecordTransition(
      [contract, p1, p2],
      "customer_payment_allocation",
      { paymentId: "p2", allocations: [{ scheduleId: "b", amountMxn: 580 }] },
      access,
    ),
  ).not.toThrow();
  expect(() =>
    validateRecordTransition(
      [contract, p1],
      "payment_schedule",
      { contractId: "c", schedule: [{ id: "b", amountMxn: 1160 }] },
      access,
    ),
  ).toThrow("PAID_INSTALLMENT_REMOVAL");
});
it("duplicado bancario se detecta aunque el usuario cambie mayúsculas y espacios", () => {
  const payment = r("p", "customer_payment", {
    contractId: "c",
    confirmed: true,
    amountMxn: 100,
    reference: "  SPEI  123 ",
    method: "Transferencia",
    paidAt: "2026-09-10",
  });
  expect(() =>
    validateRecordTransition(
      [contract, payment],
      "customer_payment",
      { ...payment.data, reference: "spei 123", method: "transferencia" },
      access,
    ),
  ).toThrow("PAYMENT_DUPLICATE");
  expect(() =>
    validateRecordTransition(
      [contract, payment, r("rev", "reversal", { recordId: "p" })],
      "customer_payment",
      payment.data,
      access,
    ),
  ).not.toThrow();
});
it("un cierre protege sus movimientos y su reversión permite corregirlos", () => {
  const close = r("cl", "financial_closure", {});
  const expense = { costBasisMxn: 100 };
  expect(() =>
    validateRecordTransition([contract, close], "expense", expense, access),
  ).toThrow("FINANCIALLY_CLOSED");
  expect(() =>
    validateRecordTransition(
      [contract, close],
      "reversal",
      { recordId: "cl" },
      access,
    ),
  ).not.toThrow();
  expect(() =>
    validateRecordTransition(
      [contract, close, r("rev", "reversal", { recordId: "cl" })],
      "expense",
      expense,
      access,
    ),
  ).not.toThrow();
});

it("sin presupuesto no presenta toda la venta como utilidad proyectada", () => {
  expect(projectSummary([contract], access)).not.toHaveProperty(
    "projectedProfitMxn",
  );
  expect(projectSummary([contract], access)).not.toHaveProperty(
    "projectedCostMxn",
  );
});
