"use client";

import { useState } from "react";
import {
  DOCUMENT_SECTIONS,
  PROJECT_STAGES,
  STAGE_LABELS,
  type JsonRecord,
  type ProjectStage,
} from "@/lib/projects/types";
import { CrmLinkFields } from "./CrmLinkFields";
import { History, RecordForm, type SectionProps } from "./records";
import {
  Badge,
  Check,
  EvidenceField,
  Field,
  Form,
  MutationResult,
  Notice,
  Panel,
  RecordSelect,
  activeRecords,
  dateLabel,
  isChecked,
  list,
  num,
  numberValue,
  obj,
  optionalNumber,
  optionalText,
  str,
  textValue,
  useProjectMutation,
} from "./ui";

export function ProjectData({ detail, reload }: SectionProps) {
  const { project, access } = detail;
  const mutation = useProjectMutation(reload);
  return (
    <>
      <Panel
        title="Datos del proyecto"
        description="La información general se comparte con el resto del expediente."
      >
        <Form
          mutation={mutation}
          submit="Guardar datos"
          disabled={
            !access.canEdit || detail.readiness.storage === "UNAVAILABLE"
          }
          onSubmit={(form) =>
            mutation.run(
              `/api/v1/projects/${project.id}`,
              {
                expectedVersion: project.version,
                name: textValue(form, "name"),
                customerName: textValue(form, "customerName"),
                contactName: textValue(form, "contactName"),
                email: textValue(form, "email"),
                phone: textValue(form, "phone"),
                location: textValue(form, "location"),
                scope: textValue(form, "scope"),
                data: {
                  accountId: optionalText(form, "accountId") ?? null,
                  opportunityId: optionalText(form, "opportunityId") ?? null,
                  ownerName: textValue(form, "ownerName"),
                  dueDate: optionalText(form, "dueDate") ?? null,
                  latitude: optionalNumber(form, "latitude") ?? null,
                  longitude: optionalNumber(form, "longitude") ?? null,
                },
              },
              "PATCH",
            )
          }
        >
          <div className="projects-form-grid">
            <Field
              name="name"
              label="Nombre del proyecto"
              required
              defaultValue={project.name}
            />
            <Field
              name="customerName"
              label="Cliente o razón social"
              required
              defaultValue={project.customerName}
            />
            <Field
              name="contactName"
              label="Contacto"
              defaultValue={project.contactName}
            />
            <Field
              name="email"
              label="Correo electrónico"
              type="email"
              defaultValue={project.email}
            />
            <Field
              name="phone"
              label="Teléfono"
              type="tel"
              defaultValue={project.phone}
            />
            <Field
              name="location"
              label="Ubicación"
              defaultValue={project.location}
            />
            <Field
              name="ownerName"
              label="Responsable ENNCO"
              defaultValue={str(project.data, "ownerName")}
            />
            <Field
              name="dueDate"
              label="Fecha objetivo"
              type="date"
              defaultValue={str(project.data, "dueDate")}
            />
            <Field
              name="latitude"
              label="Latitud"
              type="number"
              min={-90}
              max={90}
              defaultValue={
                typeof project.data.latitude === "number"
                  ? project.data.latitude
                  : undefined
              }
            />
            <Field
              name="longitude"
              label="Longitud"
              type="number"
              min={-180}
              max={180}
              defaultValue={
                typeof project.data.longitude === "number"
                  ? project.data.longitude
                  : undefined
              }
            />
            <CrmLinkFields
              initialAccount={str(project.data, "accountId")}
              initialOpportunity={str(project.data, "opportunityId")}
            />
            <Field
              name="scope"
              label="Necesidad y alcance"
              type="textarea"
              wide
              defaultValue={project.scope}
            />
          </div>
        </Form>
      </Panel>
      {access.canEdit ? <StageForm detail={detail} reload={reload} /> : null}
      <RecordForm
        detail={detail}
        reload={reload}
        kind="note"
        title="Agregar nota al expediente"
        allowed={access.canEdit}
        build={(form) => ({ text: textValue(form, "text") })}
      >
        <Field
          label="Nota"
          name="text"
          type="textarea"
          required
          help="Acuerdos, pendientes o contexto que el equipo necesita conservar."
        />
      </RecordForm>
      <History
        title="Notas de seguimiento"
        records={detail.records.filter((record) => record.kind === "note")}
        detail={detail}
      />
    </>
  );
}
function StageForm({ detail, reload }: SectionProps) {
  const mutation = useProjectMutation(reload);
  return (
    <Panel
      title="Etapa y seguimiento"
      description="La etapa principal organiza el Control Maestro. Los registros del expediente respaldan cada avance."
    >
      <Form
        mutation={mutation}
        submit="Actualizar seguimiento"
        disabled={detail.readiness.storage === "UNAVAILABLE"}
        onSubmit={(form) =>
          mutation.run(
            `/api/v1/projects/${detail.project.id}`,
            {
              expectedVersion: detail.project.version,
              stage: textValue(form, "stage") as ProjectStage,
              lifecycle: textValue(form, "lifecycle"),
            },
            "PATCH",
          )
        }
      >
        <div className="projects-form-grid">
          <Field
            label="Etapa principal"
            name="stage"
            required
            defaultValue={detail.project.stage}
            options={PROJECT_STAGES.map((value) => ({
              value,
              label: STAGE_LABELS[value],
            }))}
          />
          <Field
            label="Situación"
            name="lifecycle"
            required
            defaultValue={detail.project.lifecycle}
            options={[
              { value: "ACTIVE", label: "Activo" },
              { value: "PAUSED", label: "En pausa" },
              { value: "CANCELLED", label: "Cancelado" },
              { value: "LOST", label: "No concretado" },
            ]}
          />
        </div>
      </Form>
    </Panel>
  );
}

export function DocumentUpload({
  detail,
  reload,
  onUploaded,
  section = "Información del cliente",
}: SectionProps & {
  onUploaded?: (result: JsonRecord) => void;
  section?: string;
}) {
  const mutation = useProjectMutation(reload);
  return (
    <Panel
      title="Agregar un documento"
      description="PDF, JPG o PNG, hasta 4 MB. El archivo se identifica por proyecto y sección."
    >
      <Form
        mutation={mutation}
        submit="Guardar documento"
        disabled={!detail.access.canEdit || detail.readiness.demo}
        onSubmit={async (form) => {
          form.set("expectedVersion", String(detail.project.version));
          if (!textValue(form, "revisionId")) form.delete("revisionId");
          const result = await mutation.run<JsonRecord>(
            `/api/v1/projects/${detail.project.id}/documents`,
            form,
          );
          if (result) onUploaded?.(result);
          return result;
        }}
      >
        <div className="projects-form-grid">
          <label className="projects-field" data-wide="true">
            <span>Archivo *</span>
            <input
              name="file"
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              required
            />
            <small>
              Conserva el documento completo y legible; evita fotografías
              recortadas.
            </small>
          </label>
          <Field
            name="section"
            label="Sección del expediente"
            required
            defaultValue={section}
            options={DOCUMENT_SECTIONS}
          />
          <Field
            name="visibility"
            label="Quién puede consultar"
            required
            defaultValue="TEAM"
            options={[
              { value: "TEAM", label: "Equipo del proyecto" },
              ...(detail.access.canConfirmPayments
                ? [{ value: "ADMIN", label: "Dirección y Administración" }]
                : []),
              ...(detail.access.canPurchase
                ? [{ value: "PURCHASES", label: "Equipo de Compras" }]
                : []),
            ]}
          />
          <RecordSelect
            name="revisionId"
            label="Relacionado con un registro"
            records={activeRecords(detail.records).filter(
              (record) => !["document", "reversal"].includes(record.kind),
            )}
            required={false}
          />
        </div>
      </Form>
    </Panel>
  );
}

export function ReceiptsSection({ detail, reload }: SectionProps) {
  const [candidate, setCandidate] = useState<JsonRecord | null>(null);
  const [candidateDocument, setCandidateDocument] = useState("");
  const [candidateSource, setCandidateSource] = useState<"PDF" | "OCR">("PDF");
  const active = activeRecords(detail.records);
  function onUploaded(result: JsonRecord) {
    const extraction = obj(result.extraction);
    const values = obj(extraction.candidate ?? extraction.fields ?? extraction);
    setCandidateSource(
      str(extraction, "method") === "LOCAL_OCR" ? "OCR" : "PDF",
    );
    setCandidate(values);
    setCandidateDocument(str(obj(result.document), "id"));
  }
  return (
    <>
      <Notice>
        <strong>Confirma la lectura antes de usarla</strong>
        <p>
          Captura cada periodo como aparece en el recibo. Los meses faltantes
          permanecen pendientes; un consumo bimestral se conserva como
          bimestral.
        </p>
      </Notice>
      {detail.access.canEdit ? (
        <DocumentUpload
          detail={detail}
          reload={reload}
          onUploaded={onUploaded}
        />
      ) : null}
      {candidate ? (
        <Notice tone="warning">
          <strong>Documento recibido: revisa los datos sugeridos</strong>
          <p>
            La extracción no confirma ningún importe. Compara las fechas,
            energía, tarifa y cargos con el documento original y completa los
            campos vacíos.
          </p>
        </Notice>
      ) : null}
      <RecordForm
        detail={detail}
        reload={reload}
        kind="receipt"
        title="Registrar consumo"
        description="Puedes guardar la lectura pendiente o confirmar que coincide con el recibo."
        allowed={detail.access.canEdit}
        build={(form) => ({
          documentId: optionalText(form, "documentId"),
          periodStart: textValue(form, "periodStart"),
          periodEnd: textValue(form, "periodEnd"),
          kWh: numberValue(form, "kWh"),
          tariff: textValue(form, "tariff"),
          amountMxn: optionalNumber(form, "amountMxn"),
          demandKw: optionalNumber(form, "demandKw"),
          reactiveKvarh: optionalNumber(form, "reactiveKvarh"),
          source: candidate ? candidateSource : "MANUAL",
          confirmed: isChecked(form, "confirmed"),
          notes: optionalText(form, "notes"),
        })}
      >
        <div className="projects-form-grid" key={candidateDocument || "manual"}>
          <RecordSelect
            label="Recibo original"
            name="documentId"
            records={active.filter((record) => record.kind === "document")}
            required={false}
            defaultValue={candidateDocument}
          />
          <Field
            label="Tarifa CFE"
            name="tariff"
            required
            defaultValue={candidate ? str(candidate, "tariff") : undefined}
            placeholder="Ej. 1, DAC, PDBT, GDMTO, GDMTH"
          />
          <Field
            label="Inicio del periodo"
            name="periodStart"
            type="date"
            required
            defaultValue={candidate ? str(candidate, "periodStart") : undefined}
          />
          <Field
            label="Fin del periodo"
            name="periodEnd"
            type="date"
            required
            defaultValue={candidate ? str(candidate, "periodEnd") : undefined}
          />
          <Field
            label="Energía consumida (kWh)"
            name="kWh"
            type="number"
            min={0}
            required
            defaultValue={
              candidate && typeof candidate.kWh === "number"
                ? candidate.kWh
                : undefined
            }
          />
          <Field
            label="Total del recibo MXN"
            name="amountMxn"
            type="number"
            min={0}
            step="0.01"
            defaultValue={
              candidate && typeof candidate.amountMxn === "number"
                ? candidate.amountMxn
                : undefined
            }
          />
          <Field
            label="Demanda (kW)"
            name="demandKw"
            type="number"
            min={0}
            defaultValue={
              candidate && typeof candidate.demandKw === "number"
                ? candidate.demandKw
                : undefined
            }
          />
          <Field
            label="Energía reactiva (kvarh)"
            name="reactiveKvarh"
            type="number"
            min={0}
          />
          <Field
            label="Observaciones de la lectura"
            name="notes"
            type="textarea"
            wide
          />
          <Check name="confirmed">
            Revisé los datos contra el recibo y confirmo esta lectura.
          </Check>
        </div>
      </RecordForm>
      <History
        title="Historial de consumo"
        records={detail.records.filter((record) => record.kind === "receipt")}
        detail={detail}
      />
    </>
  );
}

const surveyChecks = [
  "Instalación eléctrica existente",
  "Transformador",
  "Tableros y protecciones",
  "Conductores",
  "Sistema de puesta a tierra",
  "Punto de interconexión",
  "Condiciones estructurales",
  "Área y trayectorias",
  "Accesos y restricciones",
  "Evidencia fotográfica",
];
export function SurveySection({ detail, reload }: SectionProps) {
  const documents = activeRecords(detail.records).filter(
    (record) => record.kind === "document",
  );
  return (
    <>
      <RecordForm
        detail={detail}
        reload={reload}
        kind="survey"
        title="Levantamiento técnico"
        description="Registra las condiciones observadas en sitio, las mediciones y la evidencia que utilizará Ingeniería."
        allowed={detail.access.canExecute}
        build={(form) => ({
          scheduledDate: optionalText(form, "scheduledDate"),
          completedDate: optionalText(form, "completedDate"),
          responsible: textValue(form, "responsible"),
          voltage: numberValue(form, "voltage"),
          phases: numberValue(form, "phases"),
          transformerKva: optionalNumber(form, "transformerKva"),
          roofType: textValue(form, "roofType"),
          availableAreaM2: optionalNumber(form, "availableAreaM2"),
          acLengthM: optionalNumber(form, "acLengthM"),
          dcLengthM: optionalNumber(form, "dcLengthM"),
          checks: Object.fromEntries(
            surveyChecks.map((label, index) => [
              label,
              isChecked(form, `check-${index}`),
            ]),
          ),
          notes: textValue(form, "notes"),
          evidenceIds: form.getAll("evidenceIds").map(String),
        })}
      >
        <div className="projects-form-grid">
          <Field label="Visita programada" name="scheduledDate" type="date" />
          <Field label="Visita realizada" name="completedDate" type="date" />
          <Field
            label="Responsable del levantamiento"
            name="responsible"
            required
          />
          <Field
            label="Tensión de operación (V)"
            name="voltage"
            type="number"
            min={1}
            required
          />
          <Field
            label="Fases"
            name="phases"
            required
            options={[
              { value: "1", label: "Monofásico" },
              { value: "2", label: "Dos fases" },
              { value: "3", label: "Trifásico" },
            ]}
          />
          <Field
            label="Transformador (kVA)"
            name="transformerKva"
            type="number"
            min={0.01}
          />
          <Field
            label="Tipo de cubierta / estructura"
            name="roofType"
            required
          />
          <Field
            label="Área disponible (m²)"
            name="availableAreaM2"
            type="number"
            min={0.01}
          />
          <Field
            label="Trayectoria AC, longitud de ida (m)"
            name="acLengthM"
            type="number"
            min={0}
          />
          <Field
            label="Trayectoria DC, longitud de ida (m)"
            name="dcLengthM"
            type="number"
            min={0}
          />
        </div>
        <fieldset style={{ marginTop: 24 }}>
          <legend>Revisión en sitio</legend>
          <div className="projects-form-grid">
            {surveyChecks.map((label, index) => (
              <Check name={`check-${index}`} key={label}>
                {label}
              </Check>
            ))}
          </div>
        </fieldset>
        <Field
          label="Condiciones particulares y pendientes"
          name="notes"
          type="textarea"
        />
        {documents.length ? (
          <fieldset style={{ marginTop: 20 }}>
            <legend>Documentos de evidencia</legend>
            {documents.map((document) => (
              <label className="projects-check" key={document.id}>
                <input type="checkbox" name="evidenceIds" value={document.id} />
                <span>
                  {str(document.data, "name")} · {str(document.data, "section")}
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="projects-help">
            Agrega fotografías o documentos en la pestaña Documentos para
            vincularlos al levantamiento.
          </p>
        )}
      </RecordForm>
      <History
        title="Levantamientos guardados"
        records={detail.records.filter((record) => record.kind === "survey")}
        detail={detail}
        renderExtra={(record) => (
          <div className="projects-value-list" style={{ marginTop: 16 }}>
            {Object.entries(obj(record.data.checks)).map(([label, checked]) => (
              <Badge key={label} tone={checked ? "success" : "warning"}>
                {checked ? "✓" : "Pendiente"} {label}
              </Badge>
            ))}
          </div>
        )}
      />
    </>
  );
}

export function DocumentsSection({ detail, reload }: SectionProps) {
  const mutation = useProjectMutation(reload);
  const setup = activeRecords(detail.records)
    .filter((record) => record.kind === "drive_setup")
    .at(-1);
  const folderId = setup ? str(setup.data, "folderId") : "";
  const folderUrl = folderId
    ? `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`
    : "";
  return (
    <>
      <Panel
        title="Carpeta del proyecto en Drive"
        description="El folio reúne la documentación de cliente, levantamiento, ingeniería, propuesta, contrato, compras, ejecución y cierre."
      >
        <div className="projects-toolbar">
          <Badge
            tone={
              detail.readiness.drive === "CONNECTED" ? "success" : "warning"
            }
          >
            {detail.readiness.drive === "CONNECTED"
              ? "Drive conectado"
              : detail.readiness.drive === "CONFIGURED"
                ? "Conexión configurada"
                : "Conexión pendiente"}
          </Badge>
          {folderUrl && /^https:\/\/drive\.google\.com\//.test(folderUrl) ? (
            <a
              className="projects-button"
              data-variant="secondary"
              href={folderUrl}
              target="_blank"
              rel="noreferrer"
            >
              Abrir carpeta ↗
            </a>
          ) : null}
          {detail.access.canConfirmPayments ? (
            <button
              className="projects-button"
              disabled={
                mutation.pending ||
                detail.readiness.demo ||
                detail.readiness.drive === "NOT_CONFIGURED"
              }
              onClick={() =>
                void mutation.run(
                  `/api/v1/projects/${detail.project.id}/drive`,
                  { expectedVersion: detail.project.version },
                )
              }
              type="button"
            >
              Crear o sincronizar carpeta
            </button>
          ) : null}
          <MutationResult mutation={mutation} />
        </div>
        {detail.readiness.drive === "NOT_CONFIGURED" ? (
          <p className="projects-help">
            La conexión de Drive debe completarse antes de sincronizar. El
            expediente conserva su información mientras tanto.
          </p>
        ) : null}
        <div className="projects-value-list" style={{ marginTop: 18 }}>
          {DOCUMENT_SECTIONS.map((section) => (
            <span key={section}>{section}</span>
          ))}
        </div>
      </Panel>
      {detail.access.canEdit ? (
        <DocumentUpload detail={detail} reload={reload} />
      ) : null}
      <History
        title="Documentos del expediente"
        records={detail.records.filter((record) => record.kind === "document")}
        detail={detail}
        renderExtra={(record) => (
          <a
            className="projects-button"
            data-variant="secondary"
            href={`/api/v1/projects/${detail.project.id}/documents/${record.id}`}
            target="_blank"
            rel="noreferrer"
            style={{ marginTop: 16 }}
          >
            Abrir documento ↗
          </a>
        )}
      />
      {detail.access.canApprove ? (
        <RecordForm
          detail={detail}
          reload={reload}
          kind="reversal"
          title="Corregir un registro"
          description="La reversión conserva el registro original y documenta el motivo. Después puedes capturar el registro correcto."
          submit="Registrar reversión"
          build={(form) => ({
            recordId: textValue(form, "recordId"),
            reason: textValue(form, "reason"),
            evidence: textValue(form, "evidence"),
          })}
        >
          <div className="projects-form-grid">
            <RecordSelect
              records={activeRecords(detail.records).filter(
                (record) => !["reversal", "calculation"].includes(record.kind),
              )}
              name="recordId"
              label="Registro a revertir"
            />
            <Field
              name="reason"
              label="Motivo de la corrección"
              type="textarea"
              required
            />
            <EvidenceField />
          </div>
        </RecordForm>
      ) : null}
    </>
  );
}

export function PaymentSchedule({ data }: { data: JsonRecord }) {
  const schedule = list(data.schedule);
  if (!schedule.length) return null;
  return (
    <div className="projects-table-wrap" style={{ marginTop: 18 }}>
      <table className="projects-table">
        <thead>
          <tr>
            <th>Pago</th>
            <th>Programado</th>
            <th>Importe</th>
            <th>Condición</th>
          </tr>
        </thead>
        <tbody>
          {schedule.map((payment, index) => (
            <tr key={str(payment, "id", String(index))}>
              <td>{str(payment, "label")}</td>
              <td>{dateLabel(str(payment, "dueDate"))}</td>
              <td>
                {new Intl.NumberFormat("es-MX", {
                  style: "currency",
                  currency: "MXN",
                }).format(num(payment, "amountMxn"))}
              </td>
              <td>{str(payment, "condition", "Según contrato")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
