"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  COST_CATEGORIES,
  type JsonRecord,
  type ProjectDetailResponse,
  type ProjectRecord,
  type RecordKind,
} from "@/lib/projects/types";
import {
  Badge,
  DetailList,
  Empty,
  Field,
  Form,
  Panel,
  dateLabel,
  list,
  money,
  num,
  quantity,
  recordName,
  str,
  textValue,
  numberValue,
  useProjectMutation,
} from "./ui";

export type SectionProps = {
  detail: ProjectDetailResponse;
  reload: () => Promise<unknown>;
};
export function RecordForm({
  detail,
  reload,
  kind,
  children,
  build,
  title,
  description,
  submit,
  allowed = true,
}: SectionProps & {
  kind: RecordKind;
  children: ReactNode;
  build: (form: FormData) => JsonRecord;
  title: string;
  description?: string;
  submit?: string;
  allowed?: boolean;
}) {
  const mutation = useProjectMutation(reload);
  if (!allowed) return null;
  return (
    <Panel title={title} description={description}>
      <Form
        mutation={mutation}
        submit={submit}
        disabled={
          detail.readiness.storage === "UNAVAILABLE" || detail.access.readOnly
        }
        onSubmit={(form) =>
          mutation.run(`/api/v1/projects/${detail.project.id}/records`, {
            expectedVersion: detail.project.version,
            kind,
            data: build(form),
          })
        }
      >
        {children}
      </Form>
    </Panel>
  );
}
export function Repeater({
  name,
  label,
  children,
  initialCount = 1,
  max = 100,
}: {
  name: string;
  label: string;
  children: (prefix: string, index: number) => ReactNode;
  initialCount?: number;
  max?: number;
}) {
  const counter = useRef(initialCount);
  const [keys, setKeys] = useState(() =>
    Array.from({ length: initialCount }, (_, index) => `row-${index + 1}`),
  );
  return (
    <fieldset>
      <legend>{label}</legend>
      <input type="hidden" name={`${name}Keys`} value={keys.join(",")} />
      {keys.map((key, index) => (
        <div className="projects-inline-grid" key={key}>
          {children(`${name}.${key}`, index)}
          <button
            className="projects-button"
            data-variant="secondary"
            type="button"
            onClick={() =>
              setKeys((current) => current.filter((value) => value !== key))
            }
            disabled={keys.length <= 1}
            aria-label={`Quitar ${label.toLowerCase()}, fila ${index + 1}`}
          >
            Quitar
          </button>
        </div>
      ))}
      <button
        className="projects-button"
        data-variant="secondary"
        type="button"
        disabled={keys.length >= max}
        onClick={() =>
          setKeys((current) => [...current, `row-${++counter.current}`])
        }
        style={{ marginTop: 14 }}
      >
        + Agregar fila
      </button>
    </fieldset>
  );
}
export function rowsFromForm(
  form: FormData,
  name: string,
  build: (prefix: string, index: number) => JsonRecord,
) {
  return textValue(form, `${name}Keys`)
    .split(",")
    .filter(Boolean)
    .map((key, index) => build(`${name}.${key}`, index));
}
export function CostLines({
  name = "lines",
  mode = "cost",
}: {
  name?: string;
  mode?: "cost" | "purchase" | "budget";
}) {
  return (
    <Repeater
      name={name}
      label={mode === "budget" ? "Presupuesto por categoría" : "Partidas"}
      max={500}
    >
      {(prefix, index) => (
        <>
          <Field
            label={`Categoría ${index + 1}`}
            name={`${prefix}.category`}
            required
            options={COST_CATEGORIES}
          />
          <Field label="Descripción" name={`${prefix}.description`} required />
          {mode === "budget" ? (
            <Field
              label="Presupuesto MXN"
              name={`${prefix}.amountMxn`}
              type="number"
              required
              min={0}
              step="0.01"
            />
          ) : (
            <>
              <Field
                label="Cantidad"
                name={`${prefix}.quantity`}
                type="number"
                required
                min={0.001}
              />
              {mode === "purchase" ? (
                <Field
                  label="Unidad"
                  name={`${prefix}.unit`}
                  required
                  defaultValue="pieza"
                />
              ) : null}
              <Field
                label="Costo unitario MXN"
                name={`${prefix}.unitCostMxn`}
                type="number"
                required
                min={0}
                step="0.01"
              />
            </>
          )}
        </>
      )}
    </Repeater>
  );
}
export function parseCostLines(
  form: FormData,
  name = "lines",
  mode: "cost" | "purchase" | "budget" = "cost",
) {
  return rowsFromForm(form, name, (prefix, index) => ({
    category: textValue(form, `${prefix}.category`),
    description: textValue(form, `${prefix}.description`),
    ...(mode === "budget"
      ? { amountMxn: numberValue(form, `${prefix}.amountMxn`) }
      : {
          quantity: numberValue(form, `${prefix}.quantity`),
          unitCostMxn: numberValue(form, `${prefix}.unitCostMxn`),
          ...(mode === "purchase"
            ? {
                id: `partida-${index + 1}`,
                unit: textValue(form, `${prefix}.unit`),
              }
            : {}),
        }),
  }));
}
export function AmountFields({
  subtotal,
  vat,
  total,
}: {
  subtotal?: number;
  vat?: number;
  total?: number;
}) {
  return (
    <>
      <Field
        label="Subtotal MXN"
        name="subtotalMxn"
        type="number"
        min={0}
        step="0.01"
        required
        defaultValue={subtotal}
      />
      <Field
        label="IVA MXN"
        name="vatMxn"
        type="number"
        min={0}
        step="0.01"
        required
        defaultValue={vat}
      />
      <Field
        label="Total MXN"
        name="totalMxn"
        type="number"
        min={0}
        step="0.01"
        required
        defaultValue={total}
        help="El total debe coincidir con subtotal más IVA."
      />
    </>
  );
}
export const parseAmounts = (form: FormData) => ({
  subtotalMxn: numberValue(form, "subtotalMxn"),
  vatMxn: numberValue(form, "vatMxn"),
  totalMxn: numberValue(form, "totalMxn"),
});

const fieldLabels: Record<string, string> = {
  name: "Nombre",
  description: "Descripción",
  notes: "Notas",
  text: "Nota",
  tariff: "Tarifa",
  periodStart: "Inicio del periodo",
  periodEnd: "Fin del periodo",
  kWh: "Energía (kWh)",
  amountMxn: "Importe MXN",
  demandKw: "Demanda (kW)",
  reactiveKvarh: "Energía reactiva (kvarh)",
  confirmed: "Confirmado",
  source: "Captura",
  responsible: "Responsable",
  scheduledDate: "Fecha programada",
  completedDate: "Levantamiento realizado",
  voltage: "Tensión (V)",
  phases: "Fases",
  transformerKva: "Transformador (kVA)",
  roofType: "Tipo de cubierta",
  availableAreaM2: "Área disponible (m²)",
  acLengthM: "Trayectoria AC (m)",
  dcLengthM: "Trayectoria DC (m)",
  decision: "Decisión",
  evidence: "Evidencia",
  customerEvidence: "Aceptación del cliente",
  reviewedSections: "Secciones revisadas",
  pricingMethod: "Método de precio",
  capacityWp: "Potencia DC (Wp)",
  usdPerWatt: "USD por watt",
  exchangeRate: "Tipo de cambio MXN/USD",
  marginPct: "Margen sobre venta (%)",
  discountPct: "Descuento (%)",
  vatPct: "IVA (%)",
  validUntil: "Vigencia",
  conditions: "Condiciones",
  subtotalMxn: "Subtotal",
  vatMxn: "IVA",
  totalMxn: "Total",
  costMxn: "Costo",
  profitMxn: "Utilidad",
  acceptedAt: "Aceptada el",
  approved: "Autorizado",
  reason: "Motivo",
  scope: "Alcance",
  advanceAmountMxn: "Anticipo requerido",
  startDate: "Inicio previsto",
  durationDays: "Duración (días)",
  terms: "Condiciones comerciales",
  warranties: "Garantías",
  number: "Número",
  date: "Fecha",
  paidAt: "Fecha de pago",
  method: "Método de pago",
  reference: "Referencia",
  supplier: "Proveedor",
  category: "Categoría",
  quantity: "Cantidad",
  unit: "Unidad",
  unitCostMxn: "Costo unitario",
  deliveryDate: "Entrega prevista",
  warranty: "Garantía",
  major: "Compra principal",
  receivedAt: "Recibido el",
  invoiceNumber: "Factura / comprobante",
  costBasisMxn: "Costo reconocido",
  dueDate: "Fecha de vencimiento",
  percent: "Avance físico (%)",
  incidents: "Incidencias",
  saleDeltaMxn: "Adicional de venta con IVA",
  saleVatDeltaMxn: "IVA del adicional",
  costDeltaMxn: "Adicional de costo",
  timeDeltaDays: "Variación de plazo (días)",
  section: "Sección",
  status: "Estado",
  visibility: "Visibilidad",
  exceptionReason: "Excepción documentada",
  sourceId: "Fuente",
  version: "Versión",
  sourceUrl: "Fuente",
  sourceDate: "Fecha de la fuente",
  driveUrl: "Documento en Drive",
};
const valueLabels: Record<string, string> = {
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
  PENDING: "Pendiente",
  SYNCED: "Sincronizado",
  ERROR: "Por resolver",
  MANUAL: "Manual",
  PDF: "PDF",
  OCR: "Extracción asistida",
  USD_PER_WATT: "USD por watt",
  COST_PLUS_MARGIN: "Costo más margen sobre venta",
  TEAM: "Equipo del proyecto",
  ADMIN: "Dirección y Administración",
  PURCHASES: "Compras",
};
function presentValue(key: string, value: unknown): ReactNode {
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "number")
    return key.endsWith("Mxn") ? money(value) : quantity(value, 4);
  if (Array.isArray(value) && value.every((item) => typeof item === "string"))
    return value.join(", ");
  if (typeof value !== "string") return null;
  if (
    key === "driveUrl" &&
    /^https:\/\/(drive|docs)\.google\.com\//.test(value)
  )
    return (
      <a href={value} target="_blank" rel="noreferrer">
        Abrir documento ↗
      </a>
    );
  if (
    /Date$|At$|^date$|periodStart|periodEnd|validUntil/.test(key) &&
    /^\d{4}-\d{2}-\d{2}/.test(value)
  )
    return dateLabel(value);
  return valueLabels[value] ?? value;
}
export function History({
  title = "Registros del expediente",
  records,
  detail,
  renderExtra,
}: {
  title?: string;
  records: ProjectRecord[];
  detail: ProjectDetailResponse;
  renderExtra?: (record: ProjectRecord) => ReactNode;
}) {
  const reversed = new Set(
    detail.records
      .filter((record) => record.kind === "reversal")
      .map((record) => str(record.data, "recordId")),
  );
  return (
    <Panel
      title={title}
      description="Cada registro conserva su fecha y revisión."
    >
      {records.length ? (
        [...records].reverse().map((record) => {
          const values = Object.entries(record.data)
            .filter(
              ([key, value]) =>
                fieldLabels[key] &&
                value !== undefined &&
                value !== "" &&
                (detail.access.canReadCosts ||
                  ![
                    "unitCostMxn",
                    "costMxn",
                    "costBasisMxn",
                    "costDeltaMxn",
                  ].includes(key)) &&
                (detail.access.canReadMargins ||
                  !["marginPct", "profitMxn"].includes(key)),
            )
            .map(
              ([key, value]) =>
                [fieldLabels[key], presentValue(key, value)] as [
                  string,
                  ReactNode,
                ],
            );
          const lineItems = list(record.data.lines).length
            ? list(record.data.lines)
            : detail.access.canReadCosts
              ? list(record.data.costLines)
              : [];
          return (
            <article className="projects-record" key={record.id}>
              <header>
                <h3>{recordName(record)}</h3>
                <div className="projects-toolbar">
                  {reversed.has(record.id) ? (
                    <Badge tone="danger">Revertido</Badge>
                  ) : null}
                  <Badge>Rev. {record.revision}</Badge>
                  <time dateTime={record.createdAt}>
                    {dateLabel(record.createdAt)}
                  </time>
                </div>
              </header>
              <DetailList values={values} />
              {lineItems.length ? (
                <div className="projects-table-wrap" style={{ marginTop: 16 }}>
                  <table className="projects-table">
                    <thead>
                      <tr>
                        <th>Partida</th>
                        <th>Cantidad</th>
                        {detail.access.canReadCosts ? (
                          <th>Importe / costo</th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {lineItems.map((line, index) => (
                        <tr key={index}>
                          <td>
                            {str(line, "description") ||
                              str(line, "lineId") ||
                              `Partida ${index + 1}`}
                            <small>{str(line, "category")}</small>
                          </td>
                          <td>
                            {line.quantity !== undefined
                              ? quantity(num(line, "quantity"))
                              : "—"}{" "}
                            {str(line, "unit")}
                          </td>
                          {detail.access.canReadCosts ? (
                            <td>
                              {line.amountMxn !== undefined
                                ? money(num(line, "amountMxn"))
                                : line.unitCostMxn !== undefined
                                  ? money(
                                      num(line, "quantity") *
                                        num(line, "unitCostMxn"),
                                    )
                                  : "—"}
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {renderExtra?.(record)}
            </article>
          );
        })
      ) : (
        <Empty
          title="Todavía no hay registros"
          description="Los datos y documentos que guardes en esta sección aparecerán aquí."
        />
      )}
    </Panel>
  );
}
