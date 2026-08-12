"use client";

import { useState } from "react";

type MutationStatus = "idle" | "pending" | "done" | "error";

function Result({ status }: { status: MutationStatus }) {
  if (status === "idle") return null;
  if (status === "pending") return <span className="fine">Guardando...</span>;
  if (status === "done") return <span className="status">Guardado</span>;
  return <span className="status blocked">Rechazado por gate</span>;
}

async function mutate(url: string, body?: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error("MUTATION_REJECTED");
}

async function mutateWithResult<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("MUTATION_REJECTED");
  return response.json() as Promise<T>;
}

export function CompleteTaskButton({ taskId }: { taskId: string }) {
  const [status, setStatus] = useState<MutationStatus>("idle");
  async function run() {
    setStatus("pending");
    try {
      await mutate(`/api/v1/operations/tasks/${taskId}/complete`);
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }
  return (
    <div className="inline-operation">
      <button className="text-button" disabled={status === "pending" || status === "done"} onClick={() => void run()} type="button">Marcar hecha</button>
      <Result status={status} />
    </div>
  );
}

export function ReplyReviewAction({ providerEventId }: { providerEventId: string }) {
  const [status, setStatus] = useState<MutationStatus>("idle");
  async function submit(formData: FormData) {
    setStatus("pending");
    try {
      await mutate(`/api/v1/operations/provider-events/${providerEventId}/review`, {
        classification: String(formData.get("classification")),
      });
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }
  return (
    <form action={(data) => void submit(data)} className="inline-review-form">
      <select aria-label="Clasificar respuesta" name="classification">
        <option value="POSITIVE">Positiva</option>
        <option value="NEUTRAL">Neutral</option>
        <option value="NEGATIVE">Negativa</option>
      </select>
      <button className="text-button" disabled={status === "pending" || status === "done"} type="submit">Guardar</button>
      <Result status={status} />
    </form>
  );
}

export function LeadQualificationAction({ leadId, qualified }: { leadId: string; qualified: boolean }) {
  const [status, setStatus] = useState<MutationStatus>("idle");
  const [evidenceStatus, setEvidenceStatus] = useState<MutationStatus>("idle");
  const [opportunityStatus, setOpportunityStatus] = useState<MutationStatus>("idle");
  const [evidenceRecords, setEvidenceRecords] = useState<Array<{
    id: string;
    criterion: "industrial_over_100_kwp" | "outside_annex_a" | "verified_target_role" | "explicit_interest" | "monthly_spend_mxn";
    value: true | number;
  }>>([]);
  const labels = {
    industrial_over_100_kwp: "Proyecto industrial mayor a 100 kWp",
    outside_annex_a: "Fuera del Anexo A",
    verified_target_role: "Rol objetivo verificado",
    explicit_interest: "Interés explícito",
    monthly_spend_mxn: "Gasto mensual mayor a $20,000 MXN",
  } as const;
  const byCriterion = new Map(evidenceRecords.map((record) => [record.criterion, record]));
  const qualificationReady = byCriterion.has("industrial_over_100_kwp")
    && byCriterion.has("outside_annex_a")
    && byCriterion.has("verified_target_role")
    && (byCriterion.has("explicit_interest") || byCriterion.has("monthly_spend_mxn"));

  async function recordEvidence(formData: FormData) {
    setEvidenceStatus("pending");
    const criterion = String(formData.get("criterion")) as keyof typeof labels;
    const value = criterion === "monthly_spend_mxn" ? Number(formData.get("evidenceValue")) : true;
    try {
      const result = await mutateWithResult<{ evidence_record_id: string; criterion: keyof typeof labels }>(
        `/api/v1/operations/leads/${leadId}/evidence`,
        {
          criterion,
          value,
          sourceUrl: String(formData.get("sourceUrl") ?? ""),
          sourceName: String(formData.get("sourceName") ?? ""),
          observedAt: new Date(String(formData.get("observedAt"))).toISOString(),
          confidence: String(formData.get("confidence")),
        },
      );
      setEvidenceRecords((current) => [
        ...current.filter((record) => record.criterion !== result.criterion),
        { id: result.evidence_record_id, criterion: result.criterion, value },
      ]);
      setEvidenceStatus("done");
    } catch {
      setEvidenceStatus("error");
    }
  }

  async function submit() {
    setStatus("pending");
    const spend = byCriterion.get("monthly_spend_mxn");
    try {
      await mutate(`/api/v1/operations/leads/${leadId}/qualify`, {
        industrialOver100Kwp: byCriterion.has("industrial_over_100_kwp"),
        outsideAnnexA: byCriterion.has("outside_annex_a"),
        verifiedTargetRole: byCriterion.has("verified_target_role"),
        explicitInterest: byCriterion.has("explicit_interest"),
        monthlySpendMxn: typeof spend?.value === "number" ? spend.value : null,
        evidenceRecordIds: evidenceRecords.map((record) => record.id),
      });
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }
  async function createOpportunity() {
    setOpportunityStatus("pending");
    try {
      await mutate(`/api/v1/operations/leads/${leadId}/opportunity`);
      setOpportunityStatus("done");
    } catch {
      setOpportunityStatus("error");
    }
  }
  if (qualified || status === "done") {
    return (
      <div className="inline-operation">
        <button className="text-button" disabled={opportunityStatus === "pending" || opportunityStatus === "done"} onClick={() => void createOpportunity()} type="button">
          Crear oportunidad
        </button>
        <Result status={opportunityStatus} />
      </div>
    );
  }
  return (
    <details className="operation-details">
      <summary>Calificar</summary>
      <form action={(data) => void recordEvidence(data)} className="compact-operation-form">
        <strong>Registrar evidencia verificable</strong>
        <label>Criterio<select name="criterion" required>
          {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>Monto, sólo para gasto mensual<input defaultValue="25001" min="20001" name="evidenceValue" type="number" /></label>
        <label>URL de la fuente<input name="sourceUrl" placeholder="https://" required type="url" /></label>
        <label>Nombre de la fuente<input maxLength={200} name="sourceName" required type="text" /></label>
        <label>Fecha observada<input name="observedAt" required type="datetime-local" /></label>
        <label>Confianza<select defaultValue="VERIFIED" name="confidence"><option value="VERIFIED">Verificada</option><option value="HIGH">Alta</option></select></label>
        <button className="button secondary" disabled={evidenceStatus === "pending"} type="submit">Guardar evidencia</button>
        <Result status={evidenceStatus} />
      </form>
      {evidenceRecords.length > 0 ? (
        <ul aria-label="Evidencia registrada" className="fine">
          {evidenceRecords.map((record) => <li key={record.criterion}>{labels[record.criterion]}</li>)}
        </ul>
      ) : <p className="fine">Faltan cuatro evidencias independientes. Ningún UUID se acepta sin un registro ligado al lead.</p>}
      <form action={() => void submit()} className="compact-operation-form">
        <button className="button" disabled={!qualificationReady || status === "pending"} type="submit">Aplicar gate estricto</button>
        <Result status={status} />
      </form>
    </details>
  );
}

export function OpportunityTransitionAction({ opportunityId, meetingId }: { opportunityId: string; meetingId?: string }) {
  const [transitionStatus, setTransitionStatus] = useState<MutationStatus>("idle");
  const [meetingStatus, setMeetingStatus] = useState<MutationStatus>("idle");
  const [paymentStatus, setPaymentStatus] = useState<MutationStatus>("idle");
  async function transition(formData: FormData) {
    setTransitionStatus("pending");
    try {
      await mutate(`/api/v1/operations/opportunities/${opportunityId}/transition`, {
        stage: String(formData.get("stage")),
        economicBuyer: formData.get("economicBuyer") === "on",
        activePain: formData.get("activePain") === "on",
        businessImpact: formData.get("businessImpact") === "on",
        timingUnder90Days: formData.get("timingUnder90Days") === "on",
        valueMxn: Number(formData.get("value") || 0) || null,
        nextAction: String(formData.get("nextAction") || "") || null,
        nextActionAt: formData.get("nextActionAt") ? new Date(String(formData.get("nextActionAt"))).toISOString() : null,
      });
      setTransitionStatus("done");
    } catch {
      setTransitionStatus("error");
    }
  }
  async function meeting(formData: FormData) {
    setMeetingStatus("pending");
    try {
      if (meetingId) {
        await mutate(`/api/v1/operations/meetings/${meetingId}/outcome`, {
          heldAt: new Date(String(formData.get("heldAt"))).toISOString(),
          attendanceVerified: true,
          outcomeNotes: String(formData.get("notes") || ""),
        });
      } else {
        await mutate(`/api/v1/operations/opportunities/${opportunityId}/meetings`, {
          scheduledAt: new Date(String(formData.get("scheduledAt"))).toISOString(),
        });
      }
      setMeetingStatus("done");
    } catch {
      setMeetingStatus("error");
    }
  }
  async function payment(formData: FormData) {
    setPaymentStatus("pending");
    try {
      await mutate(`/api/v1/operations/opportunities/${opportunityId}/payments`, {
        amountMxn: Number(formData.get("amountMxn")),
        paidAt: new Date(String(formData.get("paidAt"))).toISOString(),
        observedAt: new Date(String(formData.get("observedAt"))).toISOString(),
        sourceUrl: String(formData.get("sourceUrl")),
        sourceName: String(formData.get("sourceName")),
        confidence: String(formData.get("confidence")),
      });
      setPaymentStatus("done");
    } catch {
      setPaymentStatus("error");
    }
  }
  return (
    <details className="operation-details">
      <summary>Actualizar</summary>
      <form action={(data) => void transition(data)} className="compact-operation-form">
        <label>Etapa<select name="stage" required>
          {[
            "PROSPECTING", "CONVERSATION", "MEETING_CONFIRMED", "DISCOVERY_HELD", "QUALIFIED",
            "TECHNICAL_VISIT", "PROPOSAL", "DECISION", "CLOSED_WON", "CLOSED_LOST",
          ].map((stage) => <option key={stage} value={stage}>{stage}</option>)}
        </select></label>
        <label>Valor MXN<input min="1" name="value" type="number" /></label>
        <fieldset>
          <legend>Calificación estricta de oportunidad</legend>
          <label><input name="economicBuyer" type="checkbox" /> Comprador económico identificado</label>
          <label><input name="activePain" type="checkbox" /> Dolor activo</label>
          <label><input name="businessImpact" type="checkbox" /> Impacto de negocio</label>
          <label><input name="timingUnder90Days" type="checkbox" /> Plazo menor a 90 días</label>
        </fieldset>
        <label>Siguiente acción<input name="nextAction" type="text" /></label>
        <label>Fecha<input name="nextActionAt" type="datetime-local" /></label>
        <button className="button" disabled={transitionStatus === "pending"} type="submit">Guardar transición</button>
        <Result status={transitionStatus} />
      </form>
      {meetingId ? (
        <form action={(data) => void meeting(data)} className="compact-operation-form subform">
          <strong>Resultado de reunión</strong>
          <label>Hora realizada<input name="heldAt" required type="datetime-local" /></label>
          <label>Notas verificables<textarea maxLength={10000} name="notes" required /></label>
          <button className="button" disabled={meetingStatus === "pending"} type="submit">Registrar asistencia</button>
          <Result status={meetingStatus} />
        </form>
      ) : (
        <form action={(data) => void meeting(data)} className="compact-operation-form subform">
          <strong>Programar reunión</strong>
          <label>Fecha y hora<input name="scheduledAt" required type="datetime-local" /></label>
          <button className="button" disabled={meetingStatus === "pending" || meetingStatus === "done"} type="submit">Programar</button>
          <Result status={meetingStatus} />
        </form>
      )}
      <form action={(data) => void payment(data)} className="compact-operation-form subform">
        <strong>Registrar primer pago verificado</strong>
        <p className="fine">El gate sólo lo acepta en CLOSED_WON. La comisión se calcula automáticamente si la atribución está vigente.</p>
        <label>Monto MXN<input min="1" name="amountMxn" required type="number" /></label>
        <label>Fecha de pago<input name="paidAt" required type="datetime-local" /></label>
        <label>Fecha de verificación<input name="observedAt" required type="datetime-local" /></label>
        <label>URL de evidencia<input name="sourceUrl" placeholder="https://" required type="url" /></label>
        <label>Nombre de la fuente<input maxLength={200} name="sourceName" required type="text" /></label>
        <label>Confianza<select defaultValue="VERIFIED" name="confidence"><option value="VERIFIED">Verificada</option><option value="HIGH">Alta</option></select></label>
        <button className="button" disabled={paymentStatus === "pending" || paymentStatus === "done"} type="submit">Registrar pago</button>
        <Result status={paymentStatus} />
      </form>
    </details>
  );
}
