"use client";

import { useState } from "react";
import { COST_CATEGORIES } from "@/lib/projects/types";
import {
  AmountFields,
  CostLines,
  History,
  RecordForm,
  parseAmounts,
  parseCostLines,
  type SectionProps,
} from "./records";
import { PdfLinks } from "./ProjectCommercial";
import {
  Badge,
  Check,
  EvidenceField,
  Field,
  Metric,
  Notice,
  Panel,
  RecordSelect,
  activeRecords,
  dateLabel,
  isChecked,
  list,
  money,
  num,
  numberValue,
  optionalNumber,
  optionalText,
  quantity,
  str,
  textValue,
} from "./ui";

export function PurchasesSection({ detail, reload }: SectionProps) {
  const records = activeRecords(detail.records);
  const quotes = records.filter((record) => record.kind === "supplier_quote");
  const orders = records.filter((record) => record.kind === "purchase_order");
  const [orderId, setOrderId] = useState(orders.at(-1)?.id ?? "");
  const order = orders.find((record) => record.id === orderId);
  const lines = list(order?.data.lines);
  return (
    <>
      <Notice tone={detail.summary.purchasesReleased ? "success" : "warning"}>
        <strong>
          {detail.summary.purchasesReleased
            ? "Proyecto liberado para compras"
            : "Compras pendiente de liberación"}
        </strong>
        <p>
          {detail.summary.purchasesReleased
            ? `Anticipo confirmado: ${money(detail.summary.advanceConfirmedMxn)}.${detail.summary.purchaseDueDate ? ` Objetivo para compras principales: ${dateLabel(detail.summary.purchaseDueDate)}.` : ""}`
            : "Puedes preparar comparativas. Para emitir órdenes, Administración debe confirmar el anticipo o Dirección registrar una excepción."}
        </p>
      </Notice>
      <RecordForm
        detail={detail}
        reload={reload}
        kind="supplier_quote"
        title="Cotización de proveedor"
        description="Conserva costo, disponibilidad, entrega y evidencia para comparar antes de comprar."
        allowed={detail.access.canPurchase}
        build={(form) => ({
          supplier: textValue(form, "supplier"),
          description: textValue(form, "description"),
          category: textValue(form, "category"),
          quantity: numberValue(form, "quantity"),
          unit: textValue(form, "unit"),
          unitCostMxn: numberValue(form, "unitCostMxn"),
          vatPct: numberValue(form, "vatPct"),
          validUntil: textValue(form, "validUntil"),
          deliveryDate: optionalText(form, "deliveryDate"),
          warranty: optionalText(form, "warranty"),
          evidence: textValue(form, "evidence"),
        })}
      >
        <div className="projects-form-grid">
          <Field label="Proveedor" name="supplier" required />
          <Field label="Material o servicio" name="description" required />
          <Field
            label="Categoría"
            name="category"
            required
            options={COST_CATEGORIES}
          />
          <Field
            label="Cantidad"
            name="quantity"
            type="number"
            min={0.001}
            required
          />
          <Field
            label="Unidad"
            name="unit"
            required
            placeholder="pieza, metro, servicio…"
          />
          <Field
            label="Costo unitario sin IVA MXN"
            name="unitCostMxn"
            type="number"
            min={0}
            step="0.01"
            required
          />
          <Field
            label="IVA (%)"
            name="vatPct"
            type="number"
            min={0}
            max={100}
            required
          />
          <Field label="Vigencia" name="validUntil" type="date" required />
          <Field label="Entrega ofrecida" name="deliveryDate" type="date" />
          <Field label="Garantía / condiciones" name="warranty" />
          <EvidenceField label="Cotización del proveedor" />
        </div>
      </RecordForm>
      <History
        title="Comparativa de proveedores"
        records={detail.records.filter(
          (record) => record.kind === "supplier_quote",
        )}
        detail={detail}
      />
      <RecordForm
        detail={detail}
        reload={reload}
        kind="purchase_order"
        title="Registrar orden de compra"
        description="La orden compromete presupuesto. El gasto y el pago se registran por separado cuando se genera la factura y se liquida."
        allowed={detail.access.canPurchase && detail.summary.purchasesReleased}
        submit="Guardar orden de compra"
        build={(form) => {
          const orderLines = parseCostLines(form, "lines", "purchase");
          const subtotalMxn =
            orderLines.reduce(
              (sum, line) =>
                sum +
                Math.round(
                  num(line, "quantity") * num(line, "unitCostMxn") * 100,
                ),
              0,
            ) / 100;
          const vatMxn = numberValue(form, "vatMxn");
          return {
            supplier: textValue(form, "supplier"),
            reference: textValue(form, "reference"),
            quoteId: optionalText(form, "quoteId"),
            major: isChecked(form, "major"),
            deliveryDate: textValue(form, "deliveryDate"),
            lines: orderLines,
            subtotalMxn,
            vatMxn,
            totalMxn: Math.round((subtotalMxn + vatMxn) * 100) / 100,
            evidence: textValue(form, "evidence"),
            notes: optionalText(form, "notes"),
          };
        }}
      >
        <div className="projects-form-grid">
          <Field label="Proveedor" name="supplier" required />
          <Field label="Referencia de la orden" name="reference" required />
          <RecordSelect
            label="Cotización seleccionada"
            name="quoteId"
            records={quotes}
            required={false}
          />
          <Field
            label="Entrega programada"
            name="deliveryDate"
            type="date"
            required
          />
          <Field
            label="IVA total de la orden MXN"
            name="vatMxn"
            type="number"
            min={0}
            step="0.01"
            required
            help="El subtotal se obtiene de las partidas; se suma este importe de IVA."
          />
          <Check name="major">Es una compra principal del proyecto.</Check>
        </div>
        <div style={{ marginBlock: 24 }}>
          <CostLines mode="purchase" />
        </div>
        <EvidenceField label="Orden autorizada" />
        <Field name="notes" label="Condiciones y notas" type="textarea" />
      </RecordForm>
      <RecordForm
        detail={detail}
        reload={reload}
        kind="material_receipt"
        title="Recepción de materiales"
        description="Registra sólo las cantidades que se recibieron. Puedes capturar entregas parciales de la misma orden."
        allowed={detail.access.canPurchase}
        build={(form) => ({
          purchaseOrderId: orderId,
          receivedAt: textValue(form, "receivedAt"),
          lines: lines
            .map((line) => ({
              lineId: str(line, "id"),
              quantity:
                optionalNumber(form, `received-${str(line, "id")}`) ?? 0,
            }))
            .filter((line) => line.quantity > 0),
          evidence: textValue(form, "evidence"),
          notes: optionalText(form, "notes"),
        })}
      >
        <div className="projects-form-grid">
          <label className="projects-field">
            <span>Orden de compra *</span>
            <select
              value={orderId}
              onChange={(event) => setOrderId(event.target.value)}
              required
            >
              <option value="">Seleccionar…</option>
              {orders.map((record) => (
                <option value={record.id} key={record.id}>
                  {str(record.data, "reference")} ·{" "}
                  {str(record.data, "supplier")}
                </option>
              ))}
            </select>
          </label>
          <Field
            name="receivedAt"
            label="Fecha de recepción"
            type="date"
            required
          />
        </div>
        <div
          className="projects-form-grid"
          key={orderId}
          style={{ marginBlock: 20 }}
        >
          {lines.map((line) => (
            <Field
              key={str(line, "id")}
              name={`received-${str(line, "id")}`}
              label={`${str(line, "description")} (${str(line, "unit")})`}
              type="number"
              min={0}
              max={num(line, "quantity")}
              help={`Ordenado: ${quantity(num(line, "quantity"))}. Captura lo recibido en esta entrega.`}
            />
          ))}
        </div>
        <EvidenceField label="Evidencia de recepción" />
        <Field name="notes" label="Faltantes o diferencias" type="textarea" />
      </RecordForm>
      {detail.access.canApprove ? (
        <details className="projects-disclosure">
          <summary>Excepción de Dirección para liberar compras</summary>
          <RecordForm
            detail={detail}
            reload={reload}
            kind="purchase_exception"
            title="Autorizar excepción"
            description="Documenta por qué se autoriza comprar antes del anticipo y la evidencia de Dirección."
            submit="Registrar excepción"
            build={(form) => ({
              reason: textValue(form, "reason"),
              evidence: textValue(form, "evidence"),
            })}
          >
            <Field
              name="reason"
              label="Motivo de la excepción"
              type="textarea"
              required
            />
            <EvidenceField label="Autorización de Dirección" />
          </RecordForm>
        </details>
      ) : null}
      <History
        title="Órdenes, entregas y excepciones"
        records={detail.records.filter((record) =>
          ["purchase_order", "material_receipt", "purchase_exception"].includes(
            record.kind,
          ),
        )}
        detail={detail}
      />
    </>
  );
}

export function ExpensesSection({ detail, reload }: SectionProps) {
  const records = activeRecords(detail.records);
  const summary = detail.summary;
  const hasApprovedBudget = records.some(
    (record) => record.kind === "budget" && record.data.approved === true,
  );
  if (!detail.access.canReadCosts)
    return (
      <Notice>
        Los gastos y costos están disponibles para las áreas autorizadas.
        Consulta Administración para revisar esta sección.
      </Notice>
    );
  return (
    <>
      <section className="projects-metrics" aria-label="Costos del proyecto">
        <Metric
          label="Presupuesto autorizado"
          value={
            detail.access.costScope === "ALL" && !hasApprovedBudget
              ? "Pendiente de presupuesto"
              : money(summary.budgetMxn)
          }
        />
        <Metric
          label="Costo incurrido"
          value={money(summary.incurredMxn)}
          help="Costos reconocidos, pagados o pendientes"
        />
        <Metric
          label="Comprometido"
          value={money(summary.committedMxn)}
          help="Órdenes y compromisos registrados"
        />
        <Metric
          label="Pagado a proveedores"
          value={money(summary.supplierPaidMxn)}
        />
      </section>
      {summary.categories?.length ? (
        <Panel
          title="Presupuesto contra costo real"
          description="La desviación se revisa durante la obra. Facturar un gasto y pagarlo son eventos distintos."
        >
          <div
            className="projects-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Comparación de costos por categoría"
          >
            <table className="projects-table">
              <thead>
                <tr>
                  <th>Categoría</th>
                  <th>Presupuesto</th>
                  <th>Incurrido</th>
                  <th>Comprometido</th>
                  <th>Pagado</th>
                  <th>Diferencia</th>
                  <th>Desviación</th>
                </tr>
              </thead>
              <tbody>
                {summary.categories.map((row) => (
                  <tr key={row.category}>
                    <td>{row.category}</td>
                    <td>
                      {hasApprovedBudget
                        ? money(row.budgetMxn)
                        : "Pendiente de presupuesto"}
                    </td>
                    <td>{money(row.incurredMxn)}</td>
                    <td>{money(row.committedMxn)}</td>
                    <td>{money(row.paidMxn)}</td>
                    <td>
                      {hasApprovedBudget
                        ? money(row.differenceMxn)
                        : "Sin base"}
                    </td>
                    <td>
                      <Badge
                        tone={
                          hasApprovedBudget &&
                          row.deviationPct !== null &&
                          row.deviationPct > 0
                            ? "warning"
                            : "neutral"
                        }
                      >
                        {!hasApprovedBudget || row.deviationPct === null
                          ? "Sin base"
                          : `${quantity(row.deviationPct)}%`}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
      <RecordForm
        detail={detail}
        reload={reload}
        kind="expense"
        title="Registrar gasto de obra"
        description="Captura la factura o comprobante. El costo reconocido puede incluir IVA no acreditable, si corresponde al criterio administrativo."
        allowed={detail.access.canConfirmPayments}
        build={(form) => ({
          purchaseOrderId: optionalText(form, "purchaseOrderId"),
          supplier: textValue(form, "supplier"),
          invoiceNumber: textValue(form, "invoiceNumber"),
          date: textValue(form, "date"),
          category: textValue(form, "category"),
          description: textValue(form, "description"),
          ...parseAmounts(form),
          costBasisMxn: numberValue(form, "costBasisMxn"),
          dueDate: optionalText(form, "dueDate"),
          evidence: textValue(form, "evidence"),
        })}
      >
        <div className="projects-form-grid">
          <RecordSelect
            records={records.filter(
              (record) => record.kind === "purchase_order",
            )}
            name="purchaseOrderId"
            label="Orden de compra relacionada"
            required={false}
          />
          <Field name="supplier" label="Proveedor / beneficiario" required />
          <Field
            name="invoiceNumber"
            label="Número de factura o comprobante"
            required
          />
          <Field name="date" label="Fecha del gasto" type="date" required />
          <Field
            name="category"
            label="Categoría"
            options={COST_CATEGORIES}
            required
          />
          <Field name="description" label="Concepto" required />
          <AmountFields />
          <Field
            name="costBasisMxn"
            label="Costo reconocido MXN"
            type="number"
            required
            min={0}
            step="0.01"
            help="Entre subtotal y total, según el IVA que se reconoce como costo."
          />
          <Field name="dueDate" label="Fecha de vencimiento" type="date" />
          <EvidenceField label="Factura o comprobante" />
        </div>
      </RecordForm>
      <RecordForm
        detail={detail}
        reload={reload}
        kind="supplier_payment"
        title="Registrar pago a proveedor"
        description="Vincula el desembolso al gasto correspondiente. Se admiten pagos parciales."
        allowed={detail.access.canConfirmPayments}
        build={(form) => ({
          expenseId: textValue(form, "expenseId"),
          amountMxn: numberValue(form, "amountMxn"),
          paidAt: textValue(form, "paidAt"),
          method: textValue(form, "method"),
          reference: textValue(form, "reference"),
          evidence: textValue(form, "evidence"),
        })}
      >
        <div className="projects-form-grid">
          <RecordSelect
            records={records.filter((record) => record.kind === "expense")}
            name="expenseId"
            label="Gasto a pagar"
          />
          <Field
            name="amountMxn"
            label="Importe pagado MXN"
            type="number"
            required
            min={0.01}
            step="0.01"
          />
          <Field
            name="paidAt"
            label="Fecha real de pago"
            type="date"
            required
          />
          <Field
            name="method"
            label="Método de pago"
            options={[
              "Transferencia",
              "Depósito",
              "Cheque",
              "Efectivo",
              "Otro",
            ]}
            required
          />
          <Field name="reference" label="Referencia" required />
          <EvidenceField label="Comprobante de pago" />
        </div>
      </RecordForm>
      <History
        title="Gastos y pagos registrados"
        records={detail.records.filter((record) =>
          ["expense", "supplier_payment"].includes(record.kind),
        )}
        detail={detail}
      />
    </>
  );
}

export function ExecutionSection({ detail, reload }: SectionProps) {
  const records = activeRecords(detail.records);
  return (
    <>
      <section className="projects-metrics" aria-label="Avance de obra">
        <Metric
          label="Avance físico"
          value={`${quantity(detail.summary.physicalProgressPct)}%`}
        />
        <Metric
          label="Cobrado del contrato"
          value={`${quantity(detail.summary.collectedPct)}%`}
        />
        <Metric label="Por cobrar" value={money(detail.summary.balanceMxn)} />
        <Metric
          label="Estado de compras"
          value={detail.summary.purchasesReleased ? "Liberado" : "Pendiente"}
        />
      </section>
      <RecordForm
        detail={detail}
        reload={reload}
        kind="progress"
        title="Bitácora de avance"
        description="Relaciona el avance físico con la evidencia de los trabajos realizados."
        allowed={detail.access.canExecute}
        build={(form) => ({
          date: textValue(form, "date"),
          responsible: textValue(form, "responsible"),
          percent: numberValue(form, "percent"),
          description: textValue(form, "description"),
          evidence: textValue(form, "evidence"),
          incidents: optionalText(form, "incidents"),
        })}
      >
        <div className="projects-form-grid">
          <Field name="date" label="Fecha de reporte" type="date" required />
          <Field name="responsible" label="Responsable" required />
          <Field
            name="percent"
            label="Avance físico acumulado (%)"
            type="number"
            min={0}
            max={100}
            required
          />
          <Field
            name="description"
            label="Trabajos y materiales utilizados"
            type="textarea"
            required
            wide
          />
          <Field
            name="incidents"
            label="Incidencias y restricciones"
            type="textarea"
            wide
          />
          <EvidenceField label="Evidencia de los trabajos" />
        </div>
      </RecordForm>
      <RecordForm
        detail={detail}
        reload={reload}
        kind="change_order"
        title="Registrar cambio de alcance"
        description="Documenta el impacto antes de ejecutarlo. La variación requiere una decisión independiente."
        allowed={
          (detail.access.canExecute || detail.access.canSell) &&
          detail.access.canReadCosts
        }
        build={(form) => ({
          description: textValue(form, "description"),
          reason: textValue(form, "reason"),
          saleDeltaMxn: numberValue(form, "saleDeltaMxn"),
          saleVatDeltaMxn: numberValue(form, "saleVatDeltaMxn"),
          costDeltaMxn: numberValue(form, "costDeltaMxn"),
          timeDeltaDays: numberValue(form, "timeDeltaDays"),
          evidence: textValue(form, "evidence"),
        })}
      >
        <div className="projects-form-grid">
          <Field
            name="description"
            label="Cambio solicitado"
            type="textarea"
            required
          />
          <Field name="reason" label="Motivo" type="textarea" required />
          <Field
            name="saleDeltaMxn"
            label="Variación total de venta CON IVA MXN"
            type="number"
            step="0.01"
            required
            help="Positivo para adicionales; negativo para una reducción."
          />
          <Field
            name="saleVatDeltaMxn"
            label="IVA incluido en la variación MXN"
            type="number"
            step="0.01"
            required
            defaultValue={0}
            help="Declara el IVA explícitamente. Usa cero si no aplica."
          />
          <Field
            name="costDeltaMxn"
            label="Variación de costo reconocido MXN"
            type="number"
            step="0.01"
            required
          />
          <Field
            name="timeDeltaDays"
            label="Variación de plazo (días)"
            type="number"
            step={1}
            required
          />
          <EvidenceField />
        </div>
      </RecordForm>
      <RecordForm
        detail={detail}
        reload={reload}
        kind="change_approval"
        title="Revisar cambio de alcance"
        allowed={detail.access.canApprove}
        submit="Guardar decisión"
        build={(form) => ({
          changeOrderId: textValue(form, "changeOrderId"),
          decision: textValue(form, "decision"),
          evidence: textValue(form, "evidence"),
          notes: textValue(form, "notes"),
        })}
      >
        <div className="projects-form-grid">
          <RecordSelect
            records={records.filter((record) => record.kind === "change_order")}
            name="changeOrderId"
            label="Cambio por revisar"
          />
          <Field
            name="decision"
            label="Decisión"
            options={[
              { value: "APPROVED", label: "Aprobar" },
              { value: "REJECTED", label: "Rechazar" },
            ]}
            required
          />
          <Field
            name="notes"
            label="Comentarios de la revisión"
            type="textarea"
            required
            wide
          />
          <EvidenceField label="Evidencia de autorización" />
        </div>
      </RecordForm>
      <History
        title="Bitácora y variaciones"
        records={detail.records.filter((record) =>
          ["progress", "change_order", "change_approval"].includes(record.kind),
        )}
        detail={detail}
      />
    </>
  );
}

const closureChecks = [
  "Evidencia fotográfica final",
  "Planos y diagramas finales revisados",
  "Fichas técnicas y manuales entregados",
  "Garantías documentadas",
  "Pruebas y reportes integrados",
  "Interconexión y documentación CFE resueltas o no aplicables",
  "Acta o evidencia de entrega",
  "Pendientes técnicos resueltos",
];
export function ClosureSection({ detail, reload }: SectionProps) {
  return (
    <>
      <section className="projects-metrics" aria-label="Cierre del proyecto">
        <Metric
          label="Cierre técnico"
          value={detail.summary.technicalClosed ? "Completo" : "Pendiente"}
        />
        <Metric
          label="Cierre financiero"
          value={detail.summary.financialClosed ? "Completo" : "Pendiente"}
        />
        <Metric
          label="Saldo por cobrar"
          value={money(detail.summary.balanceMxn)}
        />
        {detail.access.canReadMargins ? (
          <Metric
            label="Utilidad real"
            value={money(detail.summary.actualProfitMxn)}
            help="Venta neta y costos reconocidos"
          />
        ) : (
          <Metric
            label="Avance de obra"
            value={`${detail.summary.physicalProgressPct}%`}
          />
        )}
      </section>
      <RecordForm
        detail={detail}
        reload={reload}
        kind="technical_closure"
        title="Integrar cierre técnico"
        description="Confirma cada punto con la documentación del expediente. Documenta en notas las verificaciones que no apliquen."
        allowed={detail.access.canExecute}
        submit="Registrar cierre técnico"
        build={(form) => ({
          checks: Object.fromEntries(
            closureChecks.map((label, index) => [
              label,
              isChecked(form, `closure-${index}`),
            ]),
          ),
          evidence: textValue(form, "evidence"),
          notes: textValue(form, "notes"),
        })}
      >
        <div className="projects-form-grid">
          {closureChecks.map((label, index) => (
            <Check name={`closure-${index}`} key={label} required>
              {label}
            </Check>
          ))}
        </div>
        <Field
          name="notes"
          label="Resumen de entrega y puntos no aplicables"
          type="textarea"
          required
        />
        <EvidenceField label="Expediente y acta de entrega" />
      </RecordForm>
      <RecordForm
        detail={detail}
        reload={reload}
        kind="financial_closure"
        title="Conciliación administrativa y financiera"
        description="Confirma cobros, gastos y pagos. Una excepción debe tener motivo y respaldo de la persona autorizada."
        allowed={detail.access.canCloseFinancial}
        submit="Registrar cierre financiero"
        build={(form) => ({
          evidence: textValue(form, "evidence"),
          notes: textValue(form, "notes"),
          exceptionReason: optionalText(form, "exceptionReason"),
        })}
      >
        <Field
          name="notes"
          label="Resultado de la conciliación"
          type="textarea"
          required
        />
        <EvidenceField label="Evidencia de conciliación" />
        {detail.access.canApprove ? (
          <Field
            name="exceptionReason"
            label="Motivo de excepción, si aplica"
            type="textarea"
            help="Completa sólo si existe una autorización documentada para cerrar con diferencias."
          />
        ) : null}
      </RecordForm>
      <History
        title="Cierres registrados"
        records={detail.records.filter((record) =>
          ["technical_closure", "financial_closure"].includes(record.kind),
        )}
        detail={detail}
        renderExtra={(record) => (
          <PdfLinks
            projectId={detail.project.id}
            record={record}
            kinds={
              record.kind === "financial_closure" &&
              detail.access.canReadMargins
                ? ["financial"]
                : ["technical"]
            }
          />
        )}
      />
    </>
  );
}
