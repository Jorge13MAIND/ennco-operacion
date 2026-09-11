"use client";

import { useState } from "react";
import type {
  CatalogEntry,
  JsonRecord,
  ProjectRecord,
} from "@/lib/projects/types";
import {
  AmountFields,
  CostLines,
  History,
  RecordForm,
  Repeater,
  parseAmounts,
  parseCostLines,
  rowsFromForm,
  type SectionProps,
} from "./records";
import { PaymentSchedule } from "./ProjectIntake";
import {
  Check,
  DetailList,
  EvidenceField,
  Field,
  Metric,
  Notice,
  RecordSelect,
  activeRecords,
  isChecked,
  list,
  money,
  num,
  numberValue,
  optionalNumber,
  optionalText,
  obj,
  quantity,
  str,
  textValue,
  useResource,
} from "./ui";

export function PdfLinks({
  projectId,
  record,
  kinds,
}: {
  projectId: string;
  record: ProjectRecord;
  kinds: ("proposal" | "technical" | "financial" | "contract")[];
}) {
  const labels = {
    proposal: "PDF para cliente",
    technical: "Expediente técnico",
    financial: "Reporte financiero interno",
    contract: "Borrador de contrato",
  };
  return (
    <div className="projects-toolbar" style={{ marginTop: 18 }}>
      {kinds.map((kind) => (
        <a
          className="projects-button"
          data-variant="secondary"
          href={`/api/v1/projects/${projectId}/pdf?kind=${kind}&revision=${record.id}`}
          target="_blank"
          rel="noreferrer"
          key={kind}
        >
          {labels[kind]} ↗
        </a>
      ))}
    </div>
  );
}
export function ProposalsSection({ detail, reload }: SectionProps) {
  const active = activeRecords(detail.records);
  const proposals = active.filter((record) => record.kind === "proposal");
  const approvedChanges = active.filter(
    (record) =>
      record.kind === "change_order" &&
      active.some(
        (approval) =>
          approval.kind === "change_approval" &&
          str(approval.data, "changeOrderId") === record.id &&
          str(approval.data, "decision") === "APPROVED",
      ),
  );
  const [method, setMethod] = useState("COST_PLUS_MARGIN");
  const catalogs = useResource<{ entries: CatalogEntry[] }>(
    "/api/v1/projects/catalogs",
  );
  const [exchangeId, setExchangeId] = useState("");
  const exchangeEntries = (catalogs.data?.entries ?? []).filter(
    (entry) =>
      entry.category === "EXCHANGE_RATE" && entry.status === "APPROVED",
  );
  const exchange = exchangeEntries.find((entry) => entry.id === exchangeId);
  return (
    <>
      <Notice>
        <strong>De la ingeniería a la propuesta</strong>
        <p>
          Elige un cálculo del expediente y un método de precio. Una propuesta
          aceptada conserva sus importes y condiciones, aunque después cambie el
          catálogo.
        </p>
      </Notice>
      {detail.access.canSell && !detail.access.canReadCosts ? (
        <Notice>
          La elaboración de costos y márgenes está a cargo de los usuarios
          autorizados. Aquí puedes consultar las propuestas y registrar la
          aceptación del cliente.
        </Notice>
      ) : null}
      <RecordForm
        detail={detail}
        reload={reload}
        kind="proposal"
        title="Preparar una propuesta"
        description="El precio final y la rentabilidad se calculan al guardar. El margen corresponde a utilidad sobre venta, antes de IVA."
        allowed={detail.access.canSell && detail.access.canReadCosts}
        submit="Guardar nueva propuesta"
        build={(form) => ({
          name: textValue(form, "name"),
          calculationId: optionalText(form, "calculationId"),
          pricingMethod: method,
          capacityWp: numberValue(form, "capacityWp"),
          ...(method === "USD_PER_WATT"
            ? {
                usdPerWatt: numberValue(form, "usdPerWatt"),
                exchangeRate: exchange
                  ? num(exchange.data, "rateMxnPerUsd")
                  : numberValue(form, "exchangeRate"),
                ...(exchange
                  ? {
                      exchangeRateSource: {
                        catalogId: exchange.id,
                        version: exchange.version,
                        sourceUrl: exchange.sourceUrl,
                        sourceDate: exchange.sourceDate,
                      },
                    }
                  : {}),
              }
            : { marginPct: numberValue(form, "marginPct") }),
          discountPct: numberValue(form, "discountPct"),
          vatPct: numberValue(form, "vatPct"),
          costLines: parseCostLines(form, "costLines"),
          annualOperatingCostMxn: optionalNumber(
            form,
            "annualOperatingCostMxn",
          ),
          validUntil: textValue(form, "validUntil"),
          conditions: textValue(form, "conditions"),
          notes: optionalText(form, "notes"),
        })}
      >
        <div className="projects-form-grid">
          <Field
            label="Nombre de la propuesta"
            name="name"
            required
            placeholder="Propuesta inicial / revisión de alcance"
          />
          <RecordSelect
            label="Cálculo del expediente"
            name="calculationId"
            records={active.filter((record) => record.kind === "calculation")}
            required={false}
          />
          <Field
            label="Potencia instalada DC (Wp)"
            name="capacityWp"
            type="number"
            required
            min={1}
            help="Suma de potencia nominal de los módulos, expresada en watts."
          />
          <label className="projects-field">
            <span>Método de precio *</span>
            <select
              name="pricingMethod"
              value={method}
              onChange={(event) => setMethod(event.target.value)}
              required
            >
              <option value="COST_PLUS_MARGIN">
                Costo más margen sobre venta
              </option>
              <option value="USD_PER_WATT">Precio en USD por watt</option>
            </select>
          </label>
          {method === "USD_PER_WATT" ? (
            <>
              <Field
                label="Precio USD/W"
                name="usdPerWatt"
                type="number"
                required
                min={0.0001}
              />
              <label className="projects-field">
                <span>Fuente de tipo de cambio</span>
                <select
                  value={exchangeId}
                  onChange={(event) => setExchangeId(event.target.value)}
                >
                  <option value="">
                    Tipo comercial documentado manualmente
                  </option>
                  {exchangeEntries.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name} · v{entry.version}
                    </option>
                  ))}
                </select>
              </label>
              {exchange ? (
                <DetailList
                  values={[
                    [
                      "Tipo de cambio MXN/USD",
                      quantity(num(exchange.data, "rateMxnPerUsd"), 6),
                    ],
                    [
                      "Fuente conservada",
                      `${exchange.name} · v${exchange.version}`,
                    ],
                  ]}
                />
              ) : (
                <Field
                  label="Tipo de cambio MXN/USD"
                  name="exchangeRate"
                  type="number"
                  required
                  min={0.0001}
                  help="Se conserva en esta revisión; documenta su procedencia en las condiciones."
                />
              )}
            </>
          ) : (
            <Field
              label="Margen sobre venta (%)"
              name="marginPct"
              type="number"
              required
              min={0}
              max={99}
              help="Ejemplo: 20% de margen significa que el costo representa 80% de la venta, antes de descuento e IVA."
            />
          )}
          <Field
            label="Descuento (%)"
            name="discountPct"
            type="number"
            required
            min={0}
            max={100}
            defaultValue={0}
          />
          <Field
            label="IVA (%)"
            name="vatPct"
            type="number"
            required
            min={0}
            max={100}
            help="Confirma el porcentaje aplicable a esta propuesta."
          />
          <Field
            label="Vigencia hasta"
            name="validUntil"
            type="date"
            required
          />
        </div>
        <div style={{ marginBlock: 24 }}>
          <CostLines name="costLines" />
        </div>
        <Field
          label="Operación y mantenimiento anual estimado antes de IVA MXN"
          name="annualOperatingCostMxn"
          type="number"
          min={0}
          step="0.01"
          help="Opcional para retorno simple. Captura cero sólo si es el supuesto explícito de esta propuesta."
        />
        <Field
          name="conditions"
          label="Condiciones de la propuesta"
          type="textarea"
          required
          help="Alcance, inclusiones, exclusiones, forma de pago y condiciones de ejecución."
        />
        <Field name="notes" label="Notas internas" type="textarea" />
      </RecordForm>
      <History
        title="Propuestas y revisiones"
        records={detail.records.filter((record) => record.kind === "proposal")}
        detail={detail}
        renderExtra={(record) => (
          <>
            <ProposalEconomics record={record} />
            <PdfLinks
              projectId={detail.project.id}
              record={record}
              kinds={[
                "proposal",
                ...(detail.access.canEngineer ? ["technical" as const] : []),
              ]}
            />
          </>
        )}
      />
      <RecordForm
        detail={detail}
        reload={reload}
        kind="proposal_acceptance"
        title="Registrar aceptación del cliente"
        description="Selecciona la revisión exacta que aceptó el cliente y guarda su evidencia."
        allowed={detail.access.canSell}
        submit="Guardar aceptación"
        build={(form) => ({
          proposalId: textValue(form, "proposalId"),
          acceptedAt: textValue(form, "acceptedAt"),
          customerEvidence: textValue(form, "customerEvidence"),
        })}
      >
        <div className="projects-form-grid">
          <RecordSelect
            label="Propuesta aceptada"
            name="proposalId"
            records={proposals}
          />
          <Field
            label="Fecha de aceptación"
            name="acceptedAt"
            type="date"
            required
          />
          <EvidenceField
            name="customerEvidence"
            label="Evidencia de aceptación"
          />
        </div>
      </RecordForm>
      <RecordForm
        detail={detail}
        reload={reload}
        kind="budget"
        title="Presupuesto autorizado"
        description="La base de comparación contra compras y gastos reales. Una nueva versión conserva las anteriores."
        allowed={detail.access.canApprove && detail.access.canReadCosts}
        submit="Guardar presupuesto"
        build={(form) => ({
          name: textValue(form, "name"),
          proposalId: optionalText(form, "proposalId"),
          lines: parseCostLines(form, "lines", "budget"),
          includedChangeOrderIds: form
            .getAll("includedChangeOrderIds")
            .map(String),
          reason: textValue(form, "reason"),
          approved: isChecked(form, "approved"),
        })}
      >
        <div className="projects-form-grid">
          <Field name="name" label="Nombre del presupuesto" required />
          <RecordSelect
            label="Propuesta de referencia"
            name="proposalId"
            records={proposals}
            required={false}
          />
          <Field
            name="reason"
            label="Justificación del presupuesto"
            type="textarea"
            required
            wide
          />
        </div>
        <div style={{ marginBlock: 24 }}>
          <CostLines mode="budget" />
        </div>
        <fieldset>
          <legend>Adicionales ya incluidos en estas cantidades</legend>
          <p className="projects-help">
            Marca sólo los adicionales cuyo costo ya integraste en las partidas
            de este presupuesto.
          </p>
          {approvedChanges.length ? (
            approvedChanges.map((change) => (
              <label className="projects-check" key={change.id}>
                <input
                  type="checkbox"
                  name="includedChangeOrderIds"
                  value={change.id}
                />
                <span>
                  {str(change.data, "description")} ·{" "}
                  {money(num(change.data, "costDeltaMxn"))}
                </span>
              </label>
            ))
          ) : (
            <p className="projects-help">Sin adicionales aprobados.</p>
          )}
        </fieldset>
        <Check name="approved">
          Autorizo este presupuesto como base de control del proyecto.
        </Check>
      </RecordForm>
      {detail.access.canReadCosts ? (
        <History
          title="Versiones del presupuesto"
          records={detail.records.filter((record) => record.kind === "budget")}
          detail={detail}
        />
      ) : null}
    </>
  );
}

function ProposalEconomics({ record }: { record: ProjectRecord }) {
  const economics = obj(record.data.economics);
  if (!Object.keys(economics).length) return null;
  return (
    <div style={{ marginTop: 18 }}>
      {typeof economics.simplePaybackYears === "number" ? (
        <DetailList
          values={[
            [
              "Recuperación simple estimada",
              `${quantity(economics.simplePaybackYears)} años`,
            ],
          ]}
        />
      ) : (
        <Notice tone="warning">
          {str(
            economics,
            "missingReason",
            "La estimación de retorno requiere ahorro anual documentado y costo de operación explícito.",
          )}
        </Notice>
      )}
      <p className="projects-help">
        Retorno simple sin financiamiento, valor presente ni degradación.
        Depende de los supuestos de esta revisión.
      </p>
    </div>
  );
}

const legalFields = [
  ["legalNameEnnco", "Razón social ENNCO"],
  ["enncoRfc", "RFC ENNCO"],
  ["enncoAddress", "Domicilio ENNCO"],
  ["enncoRepresentative", "Representante ENNCO"],
  ["customerLegalName", "Razón social del cliente"],
  ["customerRfc", "RFC del cliente"],
  ["customerAddress", "Domicilio del cliente"],
  ["customerRepresentative", "Representante del cliente"],
  ["jurisdiction", "Jurisdicción acordada"],
  ["workmanshipWarranty", "Garantía de mano de obra"],
  ["equipmentWarranty", "Garantía de equipos"],
  ["scopeExclusions", "Exclusiones del alcance"],
] as const;

export function ContractSection({ detail, reload }: SectionProps) {
  const records = activeRecords(detail.records);
  const proposals = records.filter((record) => record.kind === "proposal");
  const [selected, setSelected] = useState(proposals.at(-1)?.id ?? "");
  const proposal = proposals.find((record) => record.id === selected);
  const acceptances = records.filter(
    (record) =>
      record.kind === "proposal_acceptance" &&
      str(record.data, "proposalId") === selected,
  );
  return (
    <>
      <Notice tone="warning">
        <strong>Contrato y propuesta deben coincidir</strong>
        <p>
          La plantilla descargable es un borrador. Conserva la versión firmada y
          registra sus condiciones y calendario de pagos.
        </p>
      </Notice>
      <RecordForm
        detail={detail}
        reload={reload}
        kind="contract"
        title="Registrar contrato y plan de pagos"
        description="Las parcialidades deben sumar el total contratado. El anticipo y la liberación de compras se verifican por separado."
        allowed={detail.access.canConfirmPayments || detail.access.canApprove}
        submit="Guardar contrato"
        build={(form) => ({
          proposalId: selected,
          acceptanceId: optionalText(form, "acceptanceId"),
          documentId: optionalText(form, "documentId"),
          evidence: textValue(form, "evidence"),
          scope: textValue(form, "scope"),
          ...parseAmounts(form),
          advanceAmountMxn: numberValue(form, "advanceAmountMxn"),
          startDate: optionalText(form, "startDate"),
          durationDays: optionalNumber(form, "durationDays"),
          schedule: rowsFromForm(form, "schedule", (prefix, index) => ({
            id: `pago-${index + 1}`,
            label: textValue(form, `${prefix}.label`),
            amountMxn: numberValue(form, `${prefix}.amountMxn`),
            dueDate: textValue(form, `${prefix}.dueDate`),
            condition: optionalText(form, `${prefix}.condition`),
          })),
          legalDetails: Object.fromEntries(
            legalFields.map(([key]) => [
              key,
              optionalText(form, `legal-${key}`),
            ]),
          ),
          terms: textValue(form, "terms"),
          warranties: textValue(form, "warranties"),
        })}
      >
        <div className="projects-form-grid">
          <label className="projects-field">
            <span>Propuesta final *</span>
            <select
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              required
            >
              <option value="">Seleccionar…</option>
              {proposals.map((record) => (
                <option value={record.id} key={record.id}>
                  {str(record.data, "name")} ·{" "}
                  {money(num(record.data, "totalMxn"))}
                </option>
              ))}
            </select>
          </label>
          <RecordSelect
            label="Aceptación documentada"
            name="acceptanceId"
            records={acceptances}
            required={false}
          />
          <RecordSelect
            label="Archivo del contrato"
            name="documentId"
            records={records.filter((record) => record.kind === "document")}
            required={false}
          />
          <EvidenceField label="Evidencia del contrato autorizado" />
        </div>
        <div
          className="projects-form-grid"
          key={selected}
          style={{ marginBlock: 20 }}
        >
          <AmountFields
            subtotal={proposal ? num(proposal.data, "subtotalMxn") : undefined}
            vat={proposal ? num(proposal.data, "vatMxn") : undefined}
            total={proposal ? num(proposal.data, "totalMxn") : undefined}
          />
          <Field
            label="Anticipo requerido MXN"
            name="advanceAmountMxn"
            type="number"
            min={0}
            step="0.01"
            required
          />
          <Field
            label="Fecha tentativa de inicio"
            name="startDate"
            type="date"
          />
          <Field
            label="Duración estimada (días)"
            name="durationDays"
            type="number"
            min={1}
            step={1}
          />
        </div>
        <Field
          name="scope"
          label="Alcance contratado"
          type="textarea"
          required
          defaultValue={detail.project.scope}
        />
        <div style={{ marginBlock: 24 }}>
          <Repeater name="schedule" label="Plan de pagos" max={100}>
            {(prefix, index) => (
              <>
                <Field
                  name={`${prefix}.label`}
                  label={`Pago ${index + 1}`}
                  required
                  placeholder="Anticipo / avance / liquidación"
                />
                <Field
                  name={`${prefix}.amountMxn`}
                  label="Importe MXN"
                  type="number"
                  required
                  min={0.01}
                  step="0.01"
                />
                <Field
                  name={`${prefix}.dueDate`}
                  label="Fecha programada"
                  type="date"
                  required
                />
                <Field name={`${prefix}.condition`} label="Condición de pago" />
              </>
            )}
          </Repeater>
        </div>
        <Field
          name="terms"
          label="Condiciones comerciales y responsabilidades"
          type="textarea"
          required
        />
        <Field
          name="warranties"
          label="Garantías acordadas"
          type="textarea"
          required
        />
        <details className="projects-disclosure">
          <summary>Identidad legal y detalle de garantías</summary>
          <p className="projects-help">
            Completa estos datos antes de firmar. El borrador identifica los
            campos pendientes.
          </p>
          <div className="projects-form-grid">
            {legalFields.map(([key, label]) => (
              <Field key={key} name={`legal-${key}`} label={label} />
            ))}
          </div>
        </details>
      </RecordForm>
      <History
        title="Contratos registrados"
        records={detail.records.filter((record) => record.kind === "contract")}
        detail={detail}
        renderExtra={(record) => (
          <>
            <PaymentSchedule data={record.data} />
            <PdfLinks
              projectId={detail.project.id}
              record={record}
              kinds={["contract"]}
            />
          </>
        )}
      />
    </>
  );
}

export function CollectionSection({ detail, reload }: SectionProps) {
  const records = activeRecords(detail.records);
  const contracts = records.filter((record) => record.kind === "contract");
  const invoices = records.filter(
    (record) => record.kind === "customer_invoice",
  );
  const [contractId, setContractId] = useState(contracts.at(-1)?.id ?? "");
  const contract = contracts.find((record) => record.id === contractId);
  const schedule = currentSchedule(records, contract);
  const s = detail.summary;
  return (
    <>
      <section className="projects-metrics" aria-label="Cobranza">
        <Metric label="Contratado" value={money(s.contractedMxn)} />
        <Metric label="Facturado" value={money(s.invoicedMxn)} />
        <Metric label="Cobrado confirmado" value={money(s.collectedMxn)} />
        <Metric label="Saldo pendiente" value={money(s.balanceMxn)} />
      </section>
      {s.nextPayment ? (
        <Notice>
          <strong>Próximo pago: {s.nextPayment.label}</strong>
          <p>
            {money(s.nextPayment.amountMxn)} · programado para{" "}
            {s.nextPayment.dueDate}
          </p>
        </Notice>
      ) : null}
      <RecordForm
        detail={detail}
        reload={reload}
        kind="customer_invoice"
        title="Registrar factura al cliente"
        description="Registra una factura ya emitida y vincula su evidencia."
        allowed={detail.access.canConfirmPayments}
        build={(form) => ({
          contractId: textValue(form, "contractId"),
          number: textValue(form, "number"),
          date: textValue(form, "date"),
          ...parseAmounts(form),
          evidence: textValue(form, "evidence"),
        })}
      >
        <div className="projects-form-grid">
          <RecordSelect
            name="contractId"
            label="Contrato"
            records={contracts}
          />
          <Field name="number" label="Folio de factura" required />
          <Field name="date" label="Fecha de emisión" type="date" required />
          <AmountFields />
          <EvidenceField label="Factura emitida" />
        </div>
      </RecordForm>
      <RecordForm
        detail={detail}
        reload={reload}
        kind="customer_payment"
        title="Registrar pago del cliente"
        description="Una transferencia recibida cuenta para cobranza después de la confirmación de Administración."
        allowed={detail.access.canConfirmPayments}
        build={(form) => ({
          contractId,
          invoiceId: optionalText(form, "invoiceId"),
          scheduleId: optionalText(form, "scheduleId"),
          amountMxn: numberValue(form, "amountMxn"),
          paidAt: textValue(form, "paidAt"),
          method: textValue(form, "method"),
          reference: textValue(form, "reference"),
          evidence: textValue(form, "evidence"),
          confirmed: isChecked(form, "confirmed"),
        })}
      >
        <div className="projects-form-grid">
          <label className="projects-field">
            <span>Contrato *</span>
            <select
              value={contractId}
              onChange={(event) => setContractId(event.target.value)}
              required
            >
              <option value="">Seleccionar…</option>
              {contracts.map((record) => (
                <option value={record.id} key={record.id}>
                  Contrato · revisión {record.revision}
                </option>
              ))}
            </select>
          </label>
          <RecordSelect
            records={invoices.filter(
              (record) => str(record.data, "contractId") === contractId,
            )}
            name="invoiceId"
            label="Factura relacionada"
            required={false}
          />
          <Field
            name="scheduleId"
            label="Parcialidad del plan"
            options={schedule.map((payment) => ({
              value: str(payment, "id"),
              label: `${str(payment, "label")} · ${money(num(payment, "amountMxn"))}`,
            }))}
          />
          <Field
            name="amountMxn"
            label="Importe recibido MXN"
            type="number"
            required
            min={0.01}
            step="0.01"
          />
          <Field
            name="paidAt"
            label="Fecha real de recepción"
            type="date"
            required
          />
          <Field
            name="method"
            label="Método de pago"
            required
            options={[
              "Transferencia",
              "Depósito",
              "Cheque",
              "Efectivo",
              "Otro",
            ]}
          />
          <Field
            name="reference"
            label="Referencia bancaria o comprobante"
            required
          />
          <EvidenceField label="Evidencia de recepción" />
          <Check name="confirmed">
            Administración verificó la recepción de este pago.
          </Check>
        </div>
      </RecordForm>
      <ScheduleRevision detail={detail} reload={reload} />
      <PaymentAllocation detail={detail} reload={reload} />
      <History
        title="Facturas y cobros"
        records={detail.records.filter((record) =>
          ["customer_invoice", "customer_payment"].includes(record.kind),
        )}
        detail={detail}
      />
    </>
  );
}

function currentSchedule(
  records: ProjectRecord[],
  contract: ProjectRecord | undefined,
): JsonRecord[] {
  const revision = records
    .filter(
      (record) =>
        record.kind === "payment_schedule" &&
        str(record.data, "contractId") === contract?.id,
    )
    .at(-1);
  return list(revision?.data.schedule ?? contract?.data.schedule);
}

function ScheduleRevision({ detail, reload }: SectionProps) {
  const records = activeRecords(detail.records);
  const contracts = records.filter((record) => record.kind === "contract");
  const [contractId, setContractId] = useState(contracts.at(-1)?.id ?? "");
  const contract = contracts.find((record) => record.id === contractId);
  const calendar = currentSchedule(records, contract);
  const calendarKey =
    records
      .filter(
        (record) =>
          record.kind === "payment_schedule" &&
          str(record.data, "contractId") === contractId,
      )
      .at(-1)?.id ?? contractId;
  return (
    <>
      <RecordForm
        detail={detail}
        reload={reload}
        kind="payment_schedule"
        title="Nueva revisión del calendario"
        description="Ajusta fechas y parcialidades tras un acuerdo o adicional aprobado. Conserva los identificadores de pagos existentes; el contrato original permanece en su historial."
        allowed={detail.access.canConfirmPayments}
        submit="Guardar revisión del calendario"
        build={(form) => ({
          contractId,
          schedule: rowsFromForm(form, "revisedSchedule", (row) => ({
            id: textValue(form, `${row}.id`),
            label: textValue(form, `${row}.label`),
            amountMxn: numberValue(form, `${row}.amountMxn`),
            dueDate: textValue(form, `${row}.dueDate`),
            condition: optionalText(form, `${row}.condition`),
          })),
          reason: textValue(form, "reason"),
          evidence: textValue(form, "evidence"),
        })}
      >
        <label className="projects-field">
          <span>Contrato del calendario *</span>
          <select
            value={contractId}
            onChange={(event) => setContractId(event.target.value)}
            required
          >
            <option value="">Seleccionar…</option>
            {contracts.map((record) => (
              <option key={record.id} value={record.id}>
                Contrato · revisión {record.revision}
              </option>
            ))}
          </select>
        </label>
        <Notice>
          Venta vigente del expediente:{" "}
          <strong>{money(detail.summary.contractedMxn)}</strong>. El calendario
          debe conciliar con el contrato y sus adicionales aprobados; una
          parcialidad no puede quedar por debajo de lo ya asignado.
        </Notice>
        <div style={{ marginBlock: 20 }}>
          <Repeater
            key={calendarKey}
            name="revisedSchedule"
            label="Calendario revisado"
            initialCount={Math.max(1, calendar.length)}
            max={100}
          >
            {(row) => {
              const position =
                Number(row.split(".").at(-1)?.replace("row-", "")) - 1;
              const original = calendar[position] ?? {};
              return (
                <>
                  <input
                    type="hidden"
                    name={`${row}.id`}
                    value={str(
                      original,
                      "id",
                      `pago-rev-${detail.project.version}-${position + 1}`,
                    )}
                  />
                  <Field
                    name={`${row}.label`}
                    label="Nombre de la parcialidad"
                    required
                    defaultValue={str(original, "label")}
                  />
                  <Field
                    name={`${row}.amountMxn`}
                    label="Importe de la parcialidad MXN"
                    type="number"
                    min={0.01}
                    step="0.01"
                    required
                    defaultValue={
                      original.amountMxn === undefined
                        ? undefined
                        : num(original, "amountMxn")
                    }
                  />
                  <Field
                    name={`${row}.dueDate`}
                    label="Fecha programada"
                    type="date"
                    required
                    defaultValue={str(original, "dueDate")}
                  />
                  <Field
                    name={`${row}.condition`}
                    label="Condición de pago"
                    defaultValue={str(original, "condition")}
                  />
                </>
              );
            }}
          </Repeater>
        </div>
        <Field
          name="reason"
          label="Motivo de la revisión del calendario"
          type="textarea"
          required
        />
        <EvidenceField label="Acuerdo del calendario" />
      </RecordForm>
      <History
        title="Revisiones del calendario"
        records={detail.records.filter(
          (record) => record.kind === "payment_schedule",
        )}
        detail={detail}
        renderExtra={(record) => <PaymentSchedule data={record.data} />}
      />
    </>
  );
}

function PaymentAllocation({ detail, reload }: SectionProps) {
  const records = activeRecords(detail.records);
  const payments = records.filter(
    (record) =>
      record.kind === "customer_payment" && record.data.confirmed === true,
  );
  const [paymentId, setPaymentId] = useState("");
  const payment = payments.find((record) => record.id === paymentId);
  const contract = records.find(
    (record) =>
      record.kind === "contract" &&
      record.id === str(payment?.data ?? {}, "contractId"),
  );
  const schedule = currentSchedule(records, contract);
  return (
    <>
      <RecordForm
        detail={detail}
        reload={reload}
        kind="customer_payment_allocation"
        title="Asignar cobro a parcialidades"
        description="Distribuye un pago confirmado entre las parcialidades de su contrato. La suma debe ser igual al pago; la asignación no agrega dinero a la cobranza."
        allowed={detail.access.canConfirmPayments}
        submit="Guardar asignación del cobro"
        build={(form) => ({
          paymentId,
          allocations: rowsFromForm(form, "allocations", (row) => ({
            scheduleId: textValue(form, `${row}.scheduleId`),
            amountMxn: numberValue(form, `${row}.amountMxn`),
          })),
          reason: textValue(form, "reason"),
          evidence: textValue(form, "evidence"),
        })}
      >
        <label className="projects-field">
          <span>Pago confirmado *</span>
          <select
            value={paymentId}
            onChange={(event) => setPaymentId(event.target.value)}
            required
          >
            <option value="">Seleccionar…</option>
            {payments.map((record) => (
              <option key={record.id} value={record.id}>
                {str(record.data, "reference")} ·{" "}
                {money(num(record.data, "amountMxn"))}
              </option>
            ))}
          </select>
        </label>
        {payment ? (
          <Notice>
            Importe que debes distribuir:{" "}
            <strong>{money(num(payment.data, "amountMxn"))}</strong>. Una nueva
            asignación sustituye la distribución anterior de este pago y
            conserva su historial.
          </Notice>
        ) : null}
        <div style={{ marginBlock: 20 }}>
          <Repeater
            key={paymentId}
            name="allocations"
            label="Parcialidades del cobro"
            max={100}
          >
            {(row) => (
              <>
                <Field
                  name={`${row}.scheduleId`}
                  label="Parcialidad"
                  required
                  options={schedule.map((item) => ({
                    value: str(item, "id"),
                    label: `${str(item, "label")} · ${money(num(item, "amountMxn"))}`,
                  }))}
                />
                <Field
                  name={`${row}.amountMxn`}
                  label="Importe asignado MXN"
                  type="number"
                  min={0.01}
                  step="0.01"
                  required
                />
              </>
            )}
          </Repeater>
        </div>
        <Field
          name="reason"
          label="Motivo de la distribución"
          type="textarea"
          required
        />
        <EvidenceField label="Evidencia de asignación" />
      </RecordForm>
      <History
        title="Asignaciones de cobros"
        records={detail.records.filter(
          (record) => record.kind === "customer_payment_allocation",
        )}
        detail={detail}
        renderExtra={(record) => {
          const original = payments.find(
            (item) => item.id === str(record.data, "paymentId"),
          );
          const related = records.find(
            (item) =>
              item.kind === "contract" &&
              item.id === str(original?.data ?? {}, "contractId"),
          );
          const calendar = currentSchedule(records, related);
          return (
            <div style={{ marginTop: 16 }}>
              <p>
                Pago:{" "}
                {str(
                  original?.data ?? {},
                  "reference",
                  "Consultar registro original",
                )}
              </p>
              <DetailList
                values={list(record.data.allocations).map((allocation) => [
                  str(
                    calendar.find(
                      (item) =>
                        str(item, "id") === str(allocation, "scheduleId"),
                    ) ?? {},
                    "label",
                    "Parcialidad registrada",
                  ),
                  money(num(allocation, "amountMxn")),
                ])}
              />
            </div>
          );
        }}
      />
    </>
  );
}
