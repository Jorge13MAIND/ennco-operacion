"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { isoToLocal, localToIso, sendCrmCommand } from "@/components/crm/crm-client";
import {
  QUALIFICATION_KEYS, QUALIFICATION_LABELS, SERVICES, SERVICE_LABELS, STAGE_LABELS, personName, stageRequirements,
  type CrmRecord, type CrmService, type CrmStage, type CrmUser, type QualificationKey,
} from "@/lib/crm/model";

const CLOSE_REASONS = ["No le interesa", "Ahora no", "Ya tiene proveedor", "Sin presupuesto", "Persona equivocada o ya no está", "No respondió más", "Precio", "Otro"];

function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className="crm-dialog" aria-label={title} onClose={onClose} onCancel={onClose}>
      <div className="crm-dialog-head">
        <h2>{title}</h2>
        <button type="button" className="crm-icon-button" onClick={onClose} aria-label="Cerrar">×</button>
      </div>
      {children}
    </dialog>
  );
}

/** Lo que falta para mover una tarjeta a una etapa (proceso de Paco); se captura aquí y se mueve. */
export function MoveDialog({ record, stage, users, onClose, onDone }: {
  record: CrmRecord; stage: CrmStage; users: CrmUser[];
  onClose: () => void; onDone: (message: string) => void;
}) {
  const missing = stageRequirements(record, stage);
  const [qualification, setQualification] = useState<Record<QualificationKey, boolean>>(
    () => Object.fromEntries(QUALIFICATION_KEYS.map((k) => [k, record.qualification[k] === true])) as Record<QualificationKey, boolean>);
  const [nextAction, setNextAction] = useState(record.next_action ?? "");
  const [nextAt, setNextAt] = useState(isoToLocal(record.next_action_at));
  const [owner, setOwner] = useState(record.owner_user_id ?? "");
  const [value, setValue] = useState(record.value_mxn ? String(record.value_mxn) : "");
  const [reason, setReason] = useState("");
  const [otherReason, setOtherReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    const closeReason = reason === "Otro" ? otherReason.trim() : reason;
    const outcome = await sendCrmCommand({ op: "MOVER", payload: {
      record_id: record.id, stage, expected_revision: record.revision,
      ...(missing.includes("calificacion") ? { qualification } : {}),
      ...(missing.includes("siguiente") ? { next_action: nextAction, next_action_at: localToIso(nextAt), owner_user_id: owner } : {}),
      ...(missing.includes("valor") ? { value_mxn: Number(value) || 0 } : {}),
      ...(missing.includes("motivo") ? { close_reason: closeReason } : {}),
    } });
    setBusy(false);
    if (outcome.ok) onDone(outcome.message); else setError(outcome.message);
  }

  return (
    <Modal open title={`Mover a ${STAGE_LABELS[stage]}`} onClose={onClose}>
      <form className="crm-form" onSubmit={submit}>
        <p className="crm-dialog-lead"><strong>{record.full_name}</strong>{record.company_name ? ` · ${record.company_name}` : ""}</p>
        {missing.includes("calificacion") ? (
          <fieldset className="crm-fieldset">
            <legend>Condiciones de calificación (informe de Paco)</legend>
            {QUALIFICATION_KEYS.map((key) => (
              <label key={key} className="crm-check">
                <input type="checkbox" checked={qualification[key]} onChange={(e) => setQualification({ ...qualification, [key]: e.target.checked })} />
                <span>{QUALIFICATION_LABELS[key]}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {missing.includes("siguiente") ? (
          <fieldset className="crm-fieldset">
            <legend>Siguiente acción</legend>
            <label className="crm-field"><span>Qué sigue</span>
              <input required maxLength={500} value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="Llamar para agendar el levantamiento" /></label>
            <div className="crm-field-row">
              <label className="crm-field"><span>Cuándo</span>
                <input required type="datetime-local" value={nextAt} onChange={(e) => setNextAt(e.target.value)} /></label>
              <label className="crm-field"><span>Responsable</span>
                <select required value={owner} onChange={(e) => setOwner(e.target.value)}>
                  <option value="">Elegir</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{personName(u.email)}</option>)}
                </select></label>
            </div>
          </fieldset>
        ) : null}
        {missing.includes("valor") ? (
          <label className="crm-field"><span>Valor de la venta (MXN)</span>
            <input required type="number" min={1} step="1" value={value} onChange={(e) => setValue(e.target.value)} /></label>
        ) : null}
        {missing.includes("motivo") ? (
          <label className="crm-field"><span>Motivo</span>
            <select required value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Elegir</option>
              {CLOSE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {reason === "Otro" ? <input required maxLength={500} value={otherReason} onChange={(e) => setOtherReason(e.target.value)} placeholder="Escribe el motivo" /> : null}
          </label>
        ) : null}
        {error ? <p className="crm-error" role="alert">{error}</p> : null}
        <div className="crm-dialog-actions">
          <button type="button" className="crm-button" onClick={onClose}>Cancelar</button>
          <button type="submit" className="crm-button" data-primary="true" disabled={busy}>{busy ? "Guardando…" : `Mover a ${STAGE_LABELS[stage]}`}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Alta a mano: referidos, llamadas o eventos que no llegaron por correo. */
export function NewContactDialog({ users, defaultOwner, onClose, onDone }: {
  users: CrmUser[]; defaultOwner: string | null; onClose: () => void; onDone: (message: string, recordId?: string) => void;
}) {
  const empty = { full_name: "", company_name: "", role_title: "", email: "", phone: "", city: "", state: "", service_interest: "", value_mxn: "", note: "", source: "MANUAL", owner_user_id: defaultOwner ?? "" };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof empty) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    const outcome = await sendCrmCommand({ op: "CREAR", payload: {
      full_name: form.full_name.trim(), company_name: form.company_name, role_title: form.role_title, email: form.email.trim(),
      phone: form.phone, city: form.city, state: form.state, service_interest: form.service_interest as CrmService | "",
      value_mxn: form.value_mxn ? Number(form.value_mxn) : "", note: form.note, owner_user_id: form.owner_user_id,
      source: form.source === "REFERIDO" ? "REFERIDO" : "MANUAL",
    } });
    setBusy(false);
    if (outcome.ok) onDone(outcome.message, outcome.recordId); else setError(outcome.message);
  }

  return (
    <Modal open title="Nuevo contacto" onClose={onClose}>
      <form className="crm-form" onSubmit={submit}>
        <div className="crm-field-row">
          <label className="crm-field"><span>Nombre *</span><input required maxLength={200} value={form.full_name} onChange={set("full_name")} /></label>
          <label className="crm-field"><span>Origen</span>
            <select value={form.source} onChange={set("source")}><option value="MANUAL">Agregado a mano</option><option value="REFERIDO">Referido</option></select></label>
        </div>
        <div className="crm-field-row">
          <label className="crm-field"><span>Empresa</span><input maxLength={200} value={form.company_name} onChange={set("company_name")} /></label>
          <label className="crm-field"><span>Puesto</span><input maxLength={200} value={form.role_title} onChange={set("role_title")} /></label>
        </div>
        <div className="crm-field-row">
          <label className="crm-field"><span>Correo</span><input type="email" maxLength={200} value={form.email} onChange={set("email")} /></label>
          <label className="crm-field"><span>Teléfono o WhatsApp</span><input inputMode="tel" maxLength={40} value={form.phone} onChange={set("phone")} /></label>
        </div>
        <div className="crm-field-row">
          <label className="crm-field"><span>Ciudad</span><input maxLength={120} value={form.city} onChange={set("city")} /></label>
          <label className="crm-field"><span>Estado</span><input maxLength={120} value={form.state} onChange={set("state")} /></label>
        </div>
        <div className="crm-field-row">
          <label className="crm-field"><span>Servicio de interés</span>
            <select value={form.service_interest} onChange={set("service_interest")}>
              <option value="">Sin definir</option>{SERVICES.map((s) => <option key={s} value={s}>{SERVICE_LABELS[s]}</option>)}
            </select></label>
          <label className="crm-field"><span>Valor estimado (MXN)</span><input type="number" min={0} step="1" value={form.value_mxn} onChange={set("value_mxn")} /></label>
        </div>
        <label className="crm-field"><span>Responsable</span>
          <select value={form.owner_user_id} onChange={set("owner_user_id")}>
            {users.map((u) => <option key={u.id} value={u.id}>{personName(u.email)}</option>)}
          </select></label>
        <label className="crm-field"><span>Nota</span><textarea rows={3} maxLength={5000} value={form.note} onChange={set("note")} placeholder="De dónde salió, qué necesita…" /></label>
        {error ? <p className="crm-error" role="alert">{error}</p> : null}
        <div className="crm-dialog-actions">
          <button type="button" className="crm-button" onClick={onClose}>Cancelar</button>
          <button type="submit" className="crm-button" data-primary="true" disabled={busy}>{busy ? "Guardando…" : "Agregar al CRM"}</button>
        </div>
      </form>
    </Modal>
  );
}
