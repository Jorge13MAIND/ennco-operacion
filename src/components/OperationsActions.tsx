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

export function LeadQualificationAction({ leadId }: { leadId: string }) {
  const [status, setStatus] = useState<MutationStatus>("idle");
  async function submit(formData: FormData) {
    setStatus("pending");
    const evidenceRecordIds = String(formData.get("evidence") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    try {
      await mutate(`/api/v1/operations/leads/${leadId}/qualify`, {
        industrialOver100Kwp: formData.get("over100") === "on",
        outsideAnnexA: formData.get("outsideAnnex") === "on",
        verifiedTargetRole: formData.get("role") === "on",
        explicitInterest: formData.get("interest") === "on",
        monthlySpendMxn: Number(formData.get("spend") || 0),
        evidenceRecordIds,
      });
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }
  return (
    <details className="operation-details">
      <summary>Calificar</summary>
      <form action={(data) => void submit(data)} className="compact-operation-form">
        <label><input name="over100" required type="checkbox" /> Proyecto industrial mayor a 100 kWp</label>
        <label><input name="outsideAnnex" required type="checkbox" /> Fuera del Anexo A</label>
        <label><input name="role" required type="checkbox" /> Rol objetivo verificado</label>
        <label><input name="interest" type="checkbox" /> Interés explícito</label>
        <label>Gasto mensual MXN<input min="0" name="spend" type="number" /></label>
        <label>ID de evidencia<input name="evidence" placeholder="UUID, UUID" required type="text" /></label>
        <button className="button" disabled={status === "pending" || status === "done"} type="submit">Aplicar gate estricto</button>
        <Result status={status} />
      </form>
    </details>
  );
}

export function OpportunityTransitionAction({ opportunityId, meetingId }: { opportunityId: string; meetingId?: string }) {
  const [transitionStatus, setTransitionStatus] = useState<MutationStatus>("idle");
  const [meetingStatus, setMeetingStatus] = useState<MutationStatus>("idle");
  async function transition(formData: FormData) {
    setTransitionStatus("pending");
    try {
      await mutate(`/api/v1/operations/opportunities/${opportunityId}/transition`, {
        stage: String(formData.get("stage")),
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
    if (!meetingId) return;
    setMeetingStatus("pending");
    try {
      await mutate(`/api/v1/operations/meetings/${meetingId}/outcome`, {
        heldAt: new Date(String(formData.get("heldAt"))).toISOString(),
        attendanceVerified: true,
        outcomeNotes: String(formData.get("notes") || ""),
      });
      setMeetingStatus("done");
    } catch {
      setMeetingStatus("error");
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
      ) : null}
    </details>
  );
}
