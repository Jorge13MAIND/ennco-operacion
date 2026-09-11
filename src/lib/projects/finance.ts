import type {
  JsonRecord,
  ProjectAccess,
  ProjectAlert,
  ProjectRecord,
  ProjectSummary,
} from "./types";
export const cents = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) : 0;
export const mxn = (v: number): number => v / 100;
const n = (v: unknown): number => (typeof v === "number" ? v : 0);
const s = (v: unknown): string => (typeof v === "string" ? v : "");
export const mexicoDate = (date: string | Date): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(date));
export function mexicanBusinessHolidays(year: number): string[] {
  const monday = (month: number, index: number) => {
    const d = new Date(Date.UTC(year, month - 1, 1));
    return `${year}-${String(month).padStart(2, "0")}-${String(1 + ((8 - d.getUTCDay()) % 7) + 7 * (index - 1)).padStart(2, "0")}`;
  };
  return [
    `${year}-01-01`,
    monday(2, 1),
    monday(3, 3),
    `${year}-05-01`,
    `${year}-09-16`,
    monday(11, 3),
    `${year}-12-25`,
    ...(year >= 2024 && (year - 2024) % 6 === 0 ? [`${year}-10-01`] : []),
  ];
}
const list = (v: unknown): JsonRecord[] =>
  Array.isArray(v) ? (v as JsonRecord[]) : [];
export function activeRecords(records: ProjectRecord[]): ProjectRecord[] {
  const reversed = new Set(
    records.filter((r) => r.kind === "reversal").map((r) => s(r.data.recordId)),
  );
  return records.filter((r) => r.kind !== "reversal" && !reversed.has(r.id));
}
export function addBusinessDays(
  date: string,
  days: number,
  holidays: string[] = [],
): string {
  const value = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(value.getTime()) || !Number.isInteger(days) || days < 0)
    throw new Error("INVALID_BUSINESS_DATE");
  const excluded = new Set([
    ...mexicanBusinessHolidays(value.getUTCFullYear()),
    ...mexicanBusinessHolidays(value.getUTCFullYear() + 1),
    ...holidays,
  ]);
  let count = 0;
  while (count < days) {
    value.setUTCDate(value.getUTCDate() + 1);
    if (
      value.getUTCDay() !== 0 &&
      value.getUTCDay() !== 6 &&
      !excluded.has(value.toISOString().slice(0, 10))
    )
      count++;
  }
  return value.toISOString().slice(0, 10);
}
export function priceProposal(data: JsonRecord): JsonRecord {
  const costCents = list(data.costLines).reduce(
    (sum, l) => sum + Math.round(n(l.quantity) * cents(l.unitCostMxn)),
    0,
  );
  const grossBeforeDiscount =
    data.pricingMethod === "USD_PER_WATT"
      ? n(data.capacityWp) * n(data.usdPerWatt) * n(data.exchangeRate) * 100
      : costCents / (1 - n(data.marginPct) / 100);
  const subtotalCents = Math.round(
    grossBeforeDiscount * (1 - n(data.discountPct) / 100),
  );
  const vatCents = Math.round((subtotalCents * n(data.vatPct)) / 100);
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0)
    throw new Error("PRICE_OUT_OF_RANGE");
  return {
    ...data,
    costMxn: mxn(costCents),
    subtotalMxn: mxn(subtotalCents),
    vatMxn: mxn(vatCents),
    totalMxn: mxn(subtotalCents + vatCents),
    profitMxn: mxn(subtotalCents - costCents),
    pricingVersion: "ENNCO-PRICE-1",
    marginDefinition: "MARGEN_SOBRE_VENTA_ANTES_IVA",
  };
}
export function effectivePaymentSchedule(
  records: ProjectRecord[],
  contractId?: string,
): JsonRecord[] {
  const active = activeRecords(records),
    contract = contractId
      ? active.find((r) => r.id === contractId && r.kind === "contract")
      : active.findLast((r) => r.kind === "contract");
  if (!contract) return [];
  return list(
    active.findLast(
      (r) => r.kind === "payment_schedule" && r.data.contractId === contract.id,
    )?.data.schedule ?? contract.data.schedule,
  );
}
export function paymentAllocations(
  records: ProjectRecord[],
  payment: ProjectRecord,
): { scheduleId: string; amountMxn: number }[] {
  const active = activeRecords(records),
    latest = active.findLast(
      (r) =>
        r.kind === "customer_payment_allocation" &&
        r.data.paymentId === payment.id,
    );
  return latest
    ? list(latest.data.allocations).map((a) => ({
        scheduleId: s(a.scheduleId),
        amountMxn: n(a.amountMxn),
      }))
    : payment.data.scheduleId
      ? [
          {
            scheduleId: s(payment.data.scheduleId),
            amountMxn: n(payment.data.amountMxn),
          },
        ]
      : [];
}
export function projectSummary(
  records: ProjectRecord[],
  access: ProjectAccess,
  now = new Date(),
  holidays: string[] = [],
): ProjectSummary {
  const active = activeRecords(records);
  const by = (kind: string) => active.filter((r) => r.kind === kind);
  const last = (kind: string) => by(kind).at(-1);
  const sum = (kind: string, key: string) =>
    by(kind).reduce((v, r) => v + cents(r.data[key]), 0);
  const contract = last("contract");
  const contractIds = new Set(by("contract").map((r) => r.id));
  const changes = by("change_order").filter(
    (r) =>
      by("change_approval").findLast((a) => a.data.changeOrderId === r.id)?.data
        .decision === "APPROVED",
  );
  const changeTotal = changes.reduce(
      (v, r) => v + cents(r.data.saleDeltaMxn),
      0,
    ),
    changeVat = changes.reduce((v, r) => v + cents(r.data.saleVatDeltaMxn), 0);
  const contracted = cents(contract?.data.totalMxn) + changeTotal;
  const netRevenue =
    cents(contract?.data.subtotalMxn) + changeTotal - changeVat;
  const payments = by("customer_payment").filter(
    (r) => r.data.confirmed === true && contractIds.has(s(r.data.contractId)),
  );
  const collected = payments.reduce((v, r) => v + cents(r.data.amountMxn), 0);
  const advanceRequired = cents(contract?.data.advanceAmountMxn);
  let running = 0,
    advanceConfirmedDate: string | null = null;
  for (const p of payments.toSorted((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  )) {
    running += cents(p.data.amountMxn);
    if (advanceConfirmedDate === null && running >= advanceRequired)
      advanceConfirmedDate = mexicoDate(p.createdAt);
  }
  // Confirmation date, never backdated date of bank movement, starts the purchase clock.
  if (contract && advanceRequired === 0)
    advanceConfirmedDate = mexicoDate(contract.createdAt);
  const exception = last("purchase_exception");
  const purchasesReleased = Boolean(
    exception || (contract && collected >= advanceRequired),
  );
  const purchaseDueDate = advanceConfirmedDate
    ? addBusinessDays(advanceConfirmedDate, 5, holidays)
    : null;
  const physicalProgressPct = n(last("progress")?.data.percent);
  const collectedPct = contracted > 0 ? (collected / contracted) * 100 : 0;
  const effectiveSchedule = effectivePaymentSchedule(records, contract?.id);
  const schedule = effectiveSchedule
    .map((p) => {
      const paid = payments
        .flatMap((r) => paymentAllocations(records, r))
        .filter((a) => a.scheduleId === p.id)
        .reduce((v, a) => v + cents(a.amountMxn), 0);
      return {
        label: s(p.label),
        dueDate: s(p.dueDate),
        amountMxn: mxn(Math.max(0, cents(p.amountMxn) - paid)),
      };
    })
    .filter((p) => p.amountMxn > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const approvedBudget = by("budget").findLast((r) => r.data.approved === true);
  const budgetLines = list(approvedBudget?.data.lines);
  const includedChanges = new Set(
    Array.isArray(approvedBudget?.data.includedChangeOrderIds)
      ? approvedBudget.data.includedChangeOrderIds
      : [],
  );
  const remainingChangeCosts = changes
    .filter((r) => !includedChanges.has(r.id))
    .reduce((v, r) => v + cents(r.data.costDeltaMxn), 0);
  const budget =
    budgetLines.reduce((v, l) => v + cents(l.amountMxn), 0) +
    remainingChangeCosts;
  const incurred = sum("expense", "costBasisMxn");
  const supplierPaid = sum("supplier_payment", "amountMxn");
  const committed = sum("purchase_order", "subtotalMxn");
  const openCommitments = by("purchase_order").reduce(
    (v, o) =>
      v +
      Math.max(
        0,
        cents(o.data.subtotalMxn) -
          by("expense")
            .filter((e) => e.data.purchaseOrderId === o.id)
            .reduce((x, e) => x + cents(e.data.subtotalMxn), 0),
      ),
    0,
  );
  const technicalClosed = Boolean(last("technical_closure"));
  const financialClosed = Boolean(last("financial_closure"));
  const projected = financialClosed
    ? incurred
    : Math.max(budget, incurred + openCommitments);
  const alerts: ProjectAlert[] = [];
  const today = mexicoDate(now);
  if (!contract)
    alerts.push({
      code: "CONTRACT_PENDING",
      message: "Registra el contrato y su calendario de pagos.",
      level: "info",
    });
  if (!purchasesReleased)
    alerts.push({
      code: "ADVANCE_PENDING",
      message:
        "Compras pendientes: Administración debe confirmar el anticipo contractual o Dirección registrar una excepción.",
      level: "warning",
    });
  if (purchasesReleased && !approvedBudget)
    alerts.push({
      code: "BUDGET_PENDING",
      message: "Falta el presupuesto de costos autorizado. Solicitar revisión.",
      level: "warning",
    });
  if (physicalProgressPct > collectedPct)
    alerts.push({
      code: "PROGRESS_AHEAD_OF_COLLECTION",
      message:
        "El avance físico supera el porcentaje cobrado. Solicitar revisión.",
      level: "warning",
    });
  if (
    purchaseDueDate &&
    today > purchaseDueDate &&
    !by("purchase_order").some((o) => o.data.major === true)
  )
    alerts.push({
      code: "MAJOR_PURCHASE_OVERDUE",
      message: `Venció el objetivo de compras principales (${purchaseDueDate}).`,
      level: "warning",
    });
  for (const o of by("purchase_order").filter(
    (o) =>
      o.data.major === true &&
      purchaseDueDate &&
      mexicoDate(o.createdAt) > purchaseDueDate,
  ))
    alerts.push({
      code: "MAJOR_PURCHASE_LATE",
      message: "Una compra principal se registró después de su fecha objetivo.",
      level: "warning",
      recordId: o.id,
    });
  if (
    contract &&
    effectiveSchedule.reduce((v, p) => v + cents(p.amountMxn), 0) !== contracted
  )
    alerts.push({
      code: "PAYMENT_SCHEDULE_REVIEW",
      message:
        "Actualiza el calendario para conciliar el contrato y los adicionales autorizados.",
      level: "warning",
    });
  if (
    payments.some(
      (p) =>
        paymentAllocations(records, p).reduce(
          (v, a) => v + cents(a.amountMxn),
          0,
        ) !== cents(p.data.amountMxn),
    )
  )
    alerts.push({
      code: "PAYMENT_ALLOCATION_PENDING",
      message:
        "Hay cobros confirmados pendientes de asignar a parcialidades; el saldo global sí los incluye.",
      level: "warning",
    });
  if (schedule.some((p) => p.dueDate < today))
    alerts.push({
      code: "CUSTOMER_PAYMENT_OVERDUE",
      message: "Hay parcialidades vencidas pendientes de cobro.",
      level: "warning",
    });
  if (technicalClosed && !financialClosed)
    alerts.push({
      code: "FINANCIAL_CLOSE_PENDING",
      message: "Cierre técnico completo; conciliación financiera pendiente.",
      level: "info",
    });
  if (
    by("document")
      .filter((d) => !by("document").some((x) => x.data.supersedes === d.id))
      .some((d) => d.data.status !== "SYNCED")
  )
    alerts.push({
      code: "DRIVE_PENDING",
      message: "Hay documentos pendientes de sincronizar con Drive.",
      level: "warning",
    });
  const result: ProjectSummary = {
    contractedMxn: mxn(contracted),
    invoicedMxn: mxn(sum("customer_invoice", "totalMxn")),
    collectedMxn: mxn(collected),
    balanceMxn: mxn(contracted - collected),
    advanceRequiredMxn: mxn(advanceRequired),
    advanceConfirmedMxn: mxn(Math.min(advanceRequired, collected)),
    purchasesReleased,
    purchaseDueDate,
    physicalProgressPct,
    collectedPct,
    nextPayment: schedule[0] ?? null,
    technicalClosed,
    financialClosed,
    alerts,
  };
  if (access.costScope === "ALL") {
    const categories = [
      ...new Set([
        ...budgetLines.map((l) => s(l.category)),
        ...by("expense").map((e) => s(e.data.category)),
        ...by("purchase_order").flatMap((o) =>
          list(o.data.lines).map((l) => s(l.category)),
        ),
      ]),
    ];
    Object.assign(result, {
      ...(approvedBudget ? { budgetMxn: mxn(budget) } : {}),
      incurredMxn: mxn(incurred),
      committedMxn: mxn(committed),
      supplierPaidMxn: mxn(supplierPaid),
      ...(approvedBudget || financialClosed
        ? { projectedCostMxn: mxn(projected) }
        : {}),
      categories: categories.map((category) => {
        const b = budgetLines
            .filter((l) => l.category === category)
            .reduce((v, l) => v + cents(l.amountMxn), 0),
          es = by("expense").filter((e) => e.data.category === category),
          i = es.reduce((v, e) => v + cents(e.data.costBasisMxn), 0),
          co = by("purchase_order")
            .flatMap((o) => list(o.data.lines))
            .filter((l) => l.category === category)
            .reduce(
              (v, l) => v + Math.round(n(l.quantity) * cents(l.unitCostMxn)),
              0,
            ),
          paid = by("supplier_payment")
            .filter((p) => es.some((e) => e.id === p.data.expenseId))
            .reduce((v, p) => v + cents(p.data.amountMxn), 0);
        return {
          category,
          budgetMxn: mxn(b),
          incurredMxn: mxn(i),
          committedMxn: mxn(co),
          paidMxn: mxn(paid),
          differenceMxn: mxn(b - i),
          deviationPct: b > 0 ? ((i - b) / b) * 100 : null,
        };
      }),
    });
    if (remainingChangeCosts !== 0)
      result.categories?.push({
        category: "Adicionales autorizados sin distribuir",
        budgetMxn: mxn(remainingChangeCosts),
        incurredMxn: 0,
        committedMxn: 0,
        paidMxn: 0,
        differenceMxn: mxn(remainingChangeCosts),
        deviationPct: null,
      });
    if (approvedBudget && projected > budget)
      alerts.push({
        code: "COST_OVERRUN",
        message:
          "Los costos proyectados superan el presupuesto autorizado. Solicitar revisión.",
        level: "warning",
      });
  }
  if (access.canReadMargins) {
    const firstBudget = by("budget").find((r) => r.data.approved === true),
      proposal =
        by("proposal").find((r) => r.id === contract?.data.proposalId) ??
        last("proposal");
    const originalCost = firstBudget
      ? list(firstBudget.data.lines).reduce((v, l) => v + cents(l.amountMxn), 0)
      : proposal
        ? cents(proposal.data.costMxn)
        : null;
    Object.assign(result, {
      ...(originalCost === null
        ? {}
        : {
            estimatedProfitMxn: mxn(
              (contract
                ? cents(contract.data.subtotalMxn)
                : cents(proposal?.data.subtotalMxn)) - originalCost,
            ),
          }),
      ...(approvedBudget || financialClosed
        ? { projectedProfitMxn: mxn(netRevenue - projected) }
        : {}),
      ...(financialClosed
        ? { actualProfitMxn: mxn(netRevenue - incurred) }
        : {}),
    });
  }
  return result;
}
/** Only use on complete records. SQL also enforces these rules under a project row lock. */
export function validateRecordTransition(
  records: ProjectRecord[],
  kind: string,
  data: JsonRecord,
  access: ProjectAccess,
): void {
  const active = activeRecords(records);
  const ref = (value: unknown, k: string) => {
    const r = active.find((r) => r.id === value && r.kind === k);
    if (!r) throw new Error("RECORD_REFERENCE_NOT_ACTIVE");
    return r;
  };
  const summary = projectSummary(records, access);
  const financialKinds = [
    "contract",
    "budget",
    "customer_payment",
    "customer_payment_allocation",
    "payment_schedule",
    "customer_invoice",
    "expense",
    "supplier_payment",
    "change_approval",
    "purchase_order",
    "financial_closure",
  ];
  const technicalKinds = [
    "receipt",
    "survey",
    "calculation",
    "technical_review",
    "progress",
  ];
  if (summary.financialClosed && financialKinds.includes(kind))
    throw new Error("PROJECT_FINANCIALLY_CLOSED");
  if (summary.technicalClosed && technicalKinds.includes(kind))
    throw new Error("PROJECT_TECHNICALLY_CLOSED");
  const payments = active.filter(
    (r) => r.kind === "customer_payment" && r.data.confirmed === true,
  );
  const allocated = (scheduleId: unknown, excludeId?: string) =>
    payments
      .filter((p) => p.id !== excludeId)
      .flatMap((p) => paymentAllocations(records, p))
      .filter((a) => a.scheduleId === scheduleId)
      .reduce((sum, a) => sum + cents(a.amountMxn), 0);
  const schedule = effectivePaymentSchedule(records);
  if (kind === "customer_payment" || kind === "supplier_payment") {
    const normalized = (v: unknown) =>
      s(v).trim().toLowerCase().replace(/\s+/g, " ");
    if (
      data.reference &&
      data.method &&
      data.paidAt &&
      active.some(
        (r) =>
          r.kind === kind &&
          normalized(r.data.reference) === normalized(data.reference) &&
          normalized(r.data.method) === normalized(data.method) &&
          new Date(s(r.data.paidAt)).getTime() ===
            new Date(s(data.paidAt)).getTime(),
      )
    )
      throw new Error("PROJECT_PAYMENT_DUPLICATE");
  }
  if (kind === "payment_schedule") {
    ref(data.contractId, "contract");
    const next = list(data.schedule);
    if (
      next.reduce((sum, p) => sum + cents(p.amountMxn), 0) !==
      cents(summary.contractedMxn)
    )
      throw new Error("PROJECT_SCHEDULE_TOTAL_MISMATCH");
    for (const old of schedule)
      if (allocated(old.id) > 0 && !next.some((p) => p.id === old.id))
        throw new Error("PROJECT_PAID_INSTALLMENT_REMOVAL");
    for (const part of next)
      if (allocated(part.id) > cents(part.amountMxn))
        throw new Error("PROJECT_PAYMENT_EXCEEDS_INSTALLMENT");
  }
  if (kind === "customer_payment_allocation") {
    const payment = ref(data.paymentId, "customer_payment");
    if (payment.data.confirmed !== true)
      throw new Error("PROJECT_CONFIRMED_PAYMENT_REQUIRED");
    const allocations = list(data.allocations);
    if (
      allocations.reduce((sum, p) => sum + cents(p.amountMxn), 0) !==
      cents(payment.data.amountMxn)
    )
      throw new Error("PROJECT_ALLOCATION_TOTAL_MISMATCH");
    for (const allocation of allocations) {
      const part = schedule.find((p) => p.id === allocation.scheduleId);
      if (!part) throw new Error("PROJECT_SCHEDULE_REFERENCE_INVALID");
      if (
        allocated(part.id, payment.id) + cents(allocation.amountMxn) >
        cents(part.amountMxn)
      )
        throw new Error("PROJECT_PAYMENT_EXCEEDS_INSTALLMENT");
    }
  }
  if (kind === "customer_payment") {
    if (data.scheduleId) {
      const part = schedule.find((p) => p.id === data.scheduleId);
      if (!part) throw new Error("PROJECT_SCHEDULE_REFERENCE_INVALID");
      if (
        data.confirmed === true &&
        allocated(part.id) + cents(data.amountMxn) > cents(part.amountMxn)
      )
        throw new Error("PROJECT_PAYMENT_EXCEEDS_INSTALLMENT");
    }
    if (data.invoiceId) {
      const invoice = ref(data.invoiceId, "customer_invoice");
      if (invoice.data.contractId !== data.contractId)
        throw new Error("PROJECT_INVOICE_CONTRACT_MISMATCH");
      const received = payments
        .filter((p) => p.data.invoiceId === invoice.id)
        .reduce((sum, p) => sum + cents(p.data.amountMxn), 0);
      if (
        data.confirmed === true &&
        received + cents(data.amountMxn) > cents(invoice.data.totalMxn)
      )
        throw new Error("PROJECT_PAYMENT_EXCEEDS_INVOICE");
    }
  }
  if (kind === "customer_invoice") {
    if (
      cents(summary.invoicedMxn) + cents(data.totalMxn) >
      cents(summary.contractedMxn)
    )
      throw new Error("PROJECT_INVOICE_EXCEEDS_CONTRACT");
    if (
      active.some(
        (r) => r.kind === "customer_invoice" && r.data.number === data.number,
      )
    )
      throw new Error("PROJECT_INVOICE_DUPLICATE");
  }
  if (kind === "technical_closure") {
    if (summary.technicalClosed)
      throw new Error("PROJECT_ALREADY_TECHNICALLY_CLOSED");
    const checks = data.checks as Record<string, unknown> | undefined;
    if (
      !checks ||
      Object.keys(checks).length < 3 ||
      !Object.values(checks).every((v) => v === true)
    )
      throw new Error("PROJECT_TECHNICAL_CHECKS_REQUIRED");
  }

  if (kind === "purchase_order" && !summary.purchasesReleased)
    throw new Error("ADVANCE_REQUIRED");
  if (kind === "proposal_acceptance") {
    ref(data.proposalId, "proposal");
    if (active.some((r) => r.kind === "contract"))
      throw new Error("PROJECT_CONTRACT_ALREADY_EXISTS");
  }
  if (kind === "budget") {
    for (const id of Array.isArray(data.includedChangeOrderIds)
      ? data.includedChangeOrderIds
      : []) {
      ref(id, "change_order");
      if (
        !active.some(
          (r) =>
            r.kind === "change_approval" &&
            r.data.changeOrderId === id &&
            r.data.decision === "APPROVED",
        )
      )
        throw new Error("BUDGET_CHANGE_NOT_APPROVED");
    }
  }
  if (kind === "technical_review") {
    const r = ref(data.calculationId, "calculation");
    const result = r.data.result as
      | { missingData?: unknown[]; warnings?: { severity: string }[] }
      | undefined;
    if (
      data.decision === "APPROVED" &&
      (result?.missingData?.length ||
        result?.warnings?.some((w) => w.severity === "BLOCKER"))
    )
      throw new Error("ENGINEERING_DATA_INCOMPLETE");
  }
  if (kind === "contract") {
    if (active.some((r) => r.kind === "contract"))
      throw new Error("PROJECT_CONTRACT_ALREADY_EXISTS");
    const proposal = ref(data.proposalId, "proposal");
    if (cents(proposal.data.totalMxn) !== cents(data.totalMxn))
      throw new Error("PROJECT_CONTRACT_PROPOSAL_MISMATCH");
    if (
      !active.some(
        (r) =>
          r.kind === "proposal_acceptance" &&
          r.data.proposalId === data.proposalId,
      )
    )
      throw new Error("PROPOSAL_ACCEPTANCE_REQUIRED");
  }
  if (kind === "customer_payment" || kind === "customer_invoice")
    ref(data.contractId, "contract");
  if (
    kind === "customer_payment" &&
    data.confirmed === true &&
    cents(summary.collectedMxn) + cents(data.amountMxn) >
      cents(summary.contractedMxn)
  )
    throw new Error("PAYMENT_EXCEEDS_CONTRACT");
  if (kind === "expense" && data.purchaseOrderId)
    ref(data.purchaseOrderId, "purchase_order");
  if (kind === "supplier_payment") {
    const e = ref(data.expenseId, "expense");
    const paid = active
      .filter((r) => r.kind === "supplier_payment" && r.data.expenseId === e.id)
      .reduce((v, r) => v + cents(r.data.amountMxn), 0);
    if (paid + cents(data.amountMxn) > cents(e.data.totalMxn))
      throw new Error("PAYMENT_EXCEEDS_EXPENSE");
  }
  if (kind === "material_receipt") {
    const order = ref(data.purchaseOrderId, "purchase_order");
    for (const l of list(data.lines)) {
      const original = list(order.data.lines).find((x) => x.id === l.lineId);
      const received = active
        .filter(
          (r) =>
            r.kind === "material_receipt" &&
            r.data.purchaseOrderId === order.id,
        )
        .flatMap((r) => list(r.data.lines))
        .filter((x) => x.lineId === l.lineId)
        .reduce((v, x) => v + n(x.quantity), 0);
      if (!original || received + n(l.quantity) > n(original.quantity))
        throw new Error("RECEIPT_EXCEEDS_ORDER");
    }
  }
  if (kind === "change_approval") ref(data.changeOrderId, "change_order");
  if (kind === "reversal") {
    const target = active.find((r) => r.id === data.recordId);
    if (!target || target.kind === "reversal")
      throw new Error("INVALID_REVERSAL");
    if (
      summary.financialClosed &&
      financialKinds.includes(target.kind) &&
      target.kind !== "financial_closure"
    )
      throw new Error("PROJECT_FINANCIALLY_CLOSED");
    if (summary.technicalClosed && technicalKinds.includes(target.kind))
      throw new Error("PROJECT_TECHNICALLY_CLOSED");
    const dependentKeys = [
      "proposalId",
      "acceptanceId",
      "contractId",
      "expenseId",
      "purchaseOrderId",
      "invoiceId",
      "changeOrderId",
      "calculationId",
    ];
    if (
      active.some(
        (r) =>
          r.id !== target.id &&
          dependentKeys.some((k) => r.data[k] === target.id),
      )
    )
      throw new Error("PROJECT_REVERSAL_HAS_DEPENDENCIES");
    if (
      [
        "technical_review",
        "proposal_acceptance",
        "change_approval",
        "purchase_exception",
        "budget",
      ].includes(target.kind) &&
      !access.canApprove
    )
      throw new Error("PROJECT_FORBIDDEN");
    if (
      ["customer_payment_allocation", "payment_schedule"].includes(target.kind)
    ) {
      const remaining = records.filter((r) => r.id !== target.id),
        restored = effectivePaymentSchedule(remaining);
      const restoredAllocations = payments.flatMap((p) =>
        paymentAllocations(remaining, p),
      );
      if (
        restoredAllocations.some(
          (a) => !restored.some((p) => p.id === a.scheduleId),
        )
      )
        throw new Error("PROJECT_PAID_INSTALLMENT_REMOVAL");
      for (const part of restored)
        if (
          restoredAllocations
            .filter((a) => a.scheduleId === part.id)
            .reduce((sum, a) => sum + cents(a.amountMxn), 0) >
          cents(part.amountMxn)
        )
          throw new Error("PROJECT_PAYMENT_EXCEEDS_INSTALLMENT");
    }
  }
  if (kind === "financial_closure") {
    if (!active.some((r) => r.kind === "contract"))
      throw new Error("PROJECT_CONTRACT_REQUIRED");
    const scheduleMismatch =
      schedule.reduce((sum, p) => sum + cents(p.amountMxn), 0) !==
        cents(summary.contractedMxn) ||
      payments.some(
        (p) =>
          paymentAllocations(records, p).reduce(
            (sum, a) => sum + cents(a.amountMxn),
            0,
          ) !== cents(p.data.amountMxn),
      );
    const openOrders = active
      .filter((r) => r.kind === "purchase_order")
      .some(
        (o) =>
          active
            .filter(
              (e) => e.kind === "expense" && e.data.purchaseOrderId === o.id,
            )
            .reduce((sum, e) => sum + cents(e.data.subtotalMxn), 0) <
          cents(o.data.subtotalMxn),
      );
    const unpaidExpenses = active
      .filter((r) => r.kind === "expense")
      .some(
        (e) =>
          active
            .filter(
              (p) => p.kind === "supplier_payment" && p.data.expenseId === e.id,
            )
            .reduce((v, p) => v + cents(p.data.amountMxn), 0) !==
          cents(e.data.totalMxn),
      );
    const uninvoiced =
      Math.abs(cents(summary.invoicedMxn) - cents(summary.contractedMxn)) > 0;
    if (
      (summary.balanceMxn !== 0 ||
        unpaidExpenses ||
        uninvoiced ||
        openOrders ||
        scheduleMismatch) &&
      (!access.canApprove || !s(data.exceptionReason).trim())
    )
      throw new Error("FINANCIAL_RECONCILIATION_REQUIRED");
  }
}
