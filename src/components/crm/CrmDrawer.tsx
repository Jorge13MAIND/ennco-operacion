"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { fetchCrmDetail, isoToLocal, localToIso, sendCrmCommand } from "@/components/crm/crm-client";
import { commercialText } from "@/lib/correos/sdr/reply-text";
import {
  ACTIVITY_LABELS, CRM_STAGES, INTENT_LABELS, NOTE_KINDS, QUALIFICATION_KEYS, QUALIFICATION_LABELS, SERVICES, SERVICE_LABELS,
  STAGE_LABELS, STAGE_TONES, formatDateTime, formatMxn, isOverdue, isQualified, personName, relativeDay, whatsappLink,
  type CrmDetail, type CrmEmail, type CrmActivity, type CrmRecord, type CrmService, type CrmStage, type CrmUser, type NoteKind,
} from "@/lib/crm/model";

type Tab = "resumen" | "actividad" | "tareas";
type TimelineItem = { at: string; email?: CrmEmail; activity?: CrmActivity };

export function CrmDrawer({ recordId, fallback, users, canEdit, refreshKey, onClose, onMove, onChanged }: {
  recordId: string; fallback: CrmRecord | null; users: CrmUser[]; canEdit: boolean; refreshKey: string;
  onClose: () => void; onMove: (record: CrmRecord, stage: CrmStage) => void; onChanged: (message: string) => void;
}) {
  // El padre monta una ficha nueva por contacto (key), así que el estado arranca limpio.
  const [detail, setDetail] = useState<CrmDetail | null>(null);
  const [tab, setTab] = useState<Tab>("resumen");
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [version, setVersion] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    let alive = true;
    fetchCrmDetail(recordId).then((loaded) => { if (alive && loaded) setDetail(loaded); });
    return () => { alive = false; };
  }, [recordId, refreshKey, version]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.querySelector("dialog[open]")) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const record = detail?.record ?? fallback;
  async function run(command: Parameters<typeof sendCrmCommand>[0]): Promise<boolean> {
    const outcome = await sendCrmCommand(command);
    setNotice({ tone: outcome.ok ? "ok" : "bad", text: outcome.message });
    if (outcome.ok) { onChanged(outcome.message); setVersion((v) => v + 1); }
    return outcome.ok;
  }

  if (!record) return null;
  const wa = whatsappLink(record.phone);
  return (
    <aside className="crm-drawer" aria-labelledby="crm-drawer-title">
      <div className="crm-drawer-head">
        <div className="crm-drawer-title">
          <h2 id="crm-drawer-title" ref={heading} tabIndex={-1}>{record.full_name}</h2>
          <p>{[record.role_title, record.company_name].filter(Boolean).join(" · ") || "Sin empresa"}</p>
        </div>
        <button type="button" className="crm-icon-button" onClick={onClose} aria-label="Cerrar ficha">×</button>
      </div>

      <div className="crm-drawer-meta">
        <label className="crm-inline-field"><span>Etapa</span>
          <select value={record.stage} disabled={!canEdit} data-tone={STAGE_TONES[record.stage]}
            onChange={(e) => onMove(record, e.target.value as CrmStage)}>
            {CRM_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
          </select></label>
        <label className="crm-inline-field"><span>Responsable</span>
          <select value={record.owner_user_id ?? ""} disabled={!canEdit}
            onChange={(e) => void run({ op: "ACTUALIZAR", payload: { record_id: record.id, owner_user_id: e.target.value } })}>
            <option value="">Sin responsable</option>
            {users.map((u) => <option key={u.id} value={u.id}>{personName(u.email)}</option>)}
          </select></label>
      </div>

      <div className="crm-contact-links">
        {record.email ? <a href={`mailto:${record.email}`} className="crm-chip" data-tone="info">{record.email}</a> : null}
        {record.phone ? <a href={`tel:${record.phone}`} className="crm-chip">{record.phone}</a> : null}
        {wa ? <a href={wa} target="_blank" rel="noreferrer" className="crm-chip" data-tone="good">WhatsApp</a> : null}
        {record.reply_intent ? <span className="crm-chip">{INTENT_LABELS[record.reply_intent] ?? record.reply_intent}</span> : null}
        {record.source !== "CORREO" ? <span className="crm-chip">{record.source === "REFERIDO" ? "Referido" : "Agregado a mano"}</span> : null}
      </div>

      {notice ? <p className={notice.tone === "ok" ? "crm-ok" : "crm-error"} role="status">{notice.text}</p> : null}

      <div className="crm-tabs" role="tablist" aria-label="Secciones de la ficha">
        {(["resumen", "actividad", "tareas"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className="crm-tab" onClick={() => setTab(t)}>
            {t === "resumen" ? "Resumen" : t === "actividad" ? `Actividad${detail ? ` (${detail.activities.length + detail.emails.length})` : ""}` : `Tareas${detail ? ` (${detail.tasks.filter((x) => x.status === "PENDIENTE").length})` : ""}`}
          </button>
        ))}
      </div>

      <div className="crm-drawer-body">
        {tab === "resumen" ? <Summary key={`${record.id}:${record.revision}:${record.updated_at}`} record={record} canEdit={canEdit} run={run} /> : null}
        {tab === "actividad" ? <Activity record={record} detail={detail} canEdit={canEdit} run={run} /> : null}
        {tab === "tareas" ? <Tasks record={record} detail={detail} users={users} canEdit={canEdit} run={run} /> : null}
      </div>
    </aside>
  );
}

type Run = (command: Parameters<typeof sendCrmCommand>[0]) => Promise<boolean>;

function Summary({ record, canEdit, run }: { record: CrmRecord; canEdit: boolean; run: Run }) {
  const [nextAction, setNextAction] = useState(record.next_action ?? "");
  const [nextAt, setNextAt] = useState(isoToLocal(record.next_action_at));
  const [fields, setFields] = useState(() => fieldsOf(record));
  const qualified = isQualified(record);
  const nextReady = Boolean(record.next_action?.trim() && record.next_action_at && record.owner_user_id);

  async function saveNext(event: FormEvent) {
    event.preventDefault();
    await run({ op: "ACTUALIZAR", payload: { record_id: record.id, next_action: nextAction, next_action_at: localToIso(nextAt) } });
  }
  async function saveFields(event: FormEvent) {
    event.preventDefault();
    await run({ op: "ACTUALIZAR", payload: { record_id: record.id, ...fields, email: fields.email.trim(),
      value_mxn: fields.value_mxn === "" ? "" : Number(fields.value_mxn), service_interest: fields.service_interest as CrmService | "" } });
  }
  const set = (key: keyof ReturnType<typeof fieldsOf>) => (e: { target: { value: string } }) => setFields({ ...fields, [key]: e.target.value });

  return (
    <div className="crm-summary">
      {record.last_reply_body ? (
        <section className="crm-section">
          <h3>Lo que respondió <span className="crm-muted">{relativeDay(record.last_reply_at)}{record.mailbox_email ? ` · a ${record.mailbox_email}` : ""}</span></h3>
          <blockquote className="crm-quote">{commercialText(record.last_reply_body)}</blockquote>
        </section>
      ) : null}

      <section className="crm-section">
        <h3>Siguiente acción {record.next_action_at ? <span className={isOverdue(record.next_action_at) ? "crm-due" : "crm-muted"} data-overdue={isOverdue(record.next_action_at)}>{relativeDay(record.next_action_at)}</span> : null}</h3>
        <form className="crm-form crm-form-inline" onSubmit={saveNext}>
          <input aria-label="Qué sigue" maxLength={500} value={nextAction} disabled={!canEdit} onChange={(e) => setNextAction(e.target.value)} placeholder="Llamar para agendar visita" />
          <input aria-label="Cuándo" type="datetime-local" value={nextAt} disabled={!canEdit} onChange={(e) => setNextAt(e.target.value)} />
          {canEdit ? <button type="submit" className="crm-button" data-primary="true">Guardar</button> : null}
        </form>
      </section>

      <section className="crm-section">
        <h3>Calificación <span className="crm-muted">{qualified && nextReady ? "Cumple las 5 condiciones" : "Informe de Paco: las 5 para avanzar"}</span></h3>
        <ul className="crm-checklist">
          {QUALIFICATION_KEYS.map((key) => (
            <li key={key}><label className="crm-check">
              <input type="checkbox" checked={record.qualification[key] === true} disabled={!canEdit}
                onChange={(e) => void run({ op: "CALIFICAR", payload: { record_id: record.id,
                  qualification: Object.fromEntries(QUALIFICATION_KEYS.map((k) => [k, k === key ? e.target.checked : record.qualification[k] === true])) as Record<typeof key, boolean> } })} />
              <span>{QUALIFICATION_LABELS[key]}</span></label></li>
          ))}
          <li className="crm-check" data-auto="true"><input type="checkbox" checked={nextReady} disabled readOnly aria-label="Siguiente acción con responsable y fecha" />
            <span>Siguiente acción con responsable y fecha <span className="crm-muted">(se llena arriba)</span></span></li>
        </ul>
      </section>

      {record.stage === "PERDIDO" || record.stage === "DESCARTADO" ? (
        <section className="crm-section"><h3>Motivo de cierre</h3><p>{record.close_reason ?? "Sin motivo"}</p></section>
      ) : null}

      <section className="crm-section">
        <h3>Datos</h3>
        <form className="crm-form" onSubmit={saveFields}>
          <div className="crm-field-row">
            <label className="crm-field"><span>Nombre</span><input required maxLength={200} value={fields.full_name} disabled={!canEdit} onChange={set("full_name")} /></label>
            <label className="crm-field"><span>Puesto</span><input maxLength={200} value={fields.role_title} disabled={!canEdit} onChange={set("role_title")} /></label>
          </div>
          <div className="crm-field-row">
            <label className="crm-field"><span>Empresa</span><input maxLength={200} value={fields.company_name} disabled={!canEdit} onChange={set("company_name")} /></label>
            <label className="crm-field"><span>Teléfono o WhatsApp</span><input inputMode="tel" maxLength={40} value={fields.phone} disabled={!canEdit} onChange={set("phone")} /></label>
          </div>
          <div className="crm-field-row">
            <label className="crm-field"><span>Correo</span><input type="email" maxLength={200} value={fields.email} disabled={!canEdit} onChange={set("email")} /></label>
            <label className="crm-field"><span>Ciudad y estado</span>
              <span className="crm-pair"><input aria-label="Ciudad" maxLength={120} value={fields.city} disabled={!canEdit} onChange={set("city")} />
              <input aria-label="Estado" maxLength={120} value={fields.state} disabled={!canEdit} onChange={set("state")} /></span></label>
          </div>
          <div className="crm-field-row">
            <label className="crm-field"><span>Servicio de interés</span>
              <select value={fields.service_interest} disabled={!canEdit} onChange={set("service_interest")}>
                <option value="">Sin definir</option>{SERVICES.map((s) => <option key={s} value={s}>{SERVICE_LABELS[s]}</option>)}
              </select></label>
            <label className="crm-field"><span>Valor estimado (MXN){record.value_mxn ? ` · ${formatMxn(record.value_mxn)}` : ""}</span>
              <input type="number" min={0} step="1" value={fields.value_mxn} disabled={!canEdit} onChange={set("value_mxn")} /></label>
          </div>
          {canEdit ? <div className="crm-dialog-actions"><button type="submit" className="crm-button">Guardar datos</button></div> : null}
        </form>
      </section>
    </div>
  );
}

function fieldsOf(record: CrmRecord) {
  return {
    full_name: record.full_name, role_title: record.role_title ?? "", company_name: record.company_name ?? "", phone: record.phone ?? "",
    email: record.email ?? "", city: record.city ?? "", state: record.state ?? "", service_interest: record.service_interest ?? "",
    value_mxn: record.value_mxn === null ? "" : String(record.value_mxn),
  };
}

function Activity({ record, detail, canEdit, run }: { record: CrmRecord; detail: CrmDetail | null; canEdit: boolean; run: Run }) {
  const [kind, setKind] = useState<NoteKind>("NOTA");
  const [body, setBody] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    if (await run({ op: "NOTA", payload: { record_id: record.id, kind, body } })) setBody("");
  }
  const items: TimelineItem[] = detail ? [
    ...detail.emails.map((email) => ({ at: email.at, email })),
    ...detail.activities.map((activity) => ({ at: activity.created_at, activity })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()) : [];
  return (
    <div className="crm-activity">
      {canEdit ? (
        <form className="crm-composer" onSubmit={save}>
          <div className="crm-segmented" role="radiogroup" aria-label="Tipo de registro">
            {NOTE_KINDS.map((k) => <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}>{ACTIVITY_LABELS[k]}</button>)}
          </div>
          <textarea rows={3} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={kind === "LLAMADA" ? "¿Qué se habló en la llamada?" : "Escribe una nota…"} aria-label="Nota" />
          <div className="crm-dialog-actions"><button type="submit" className="crm-button" data-primary="true" disabled={!body.trim()}>Guardar {(ACTIVITY_LABELS[kind] ?? "nota").toLowerCase()}</button></div>
        </form>
      ) : null}
      {!detail ? <p className="crm-muted">Cargando historial…</p> : items.length === 0 ? <p className="crm-empty">Sin actividad todavía.</p> : (
        <ol className="crm-timeline">
          {items.map((item) => item.email ? <EmailItem key={`e${item.email.id}`} email={item.email} /> : <ActivityItem key={`a${item.activity!.id}`} activity={item.activity!} />)}
        </ol>
      )}
    </div>
  );
}

function EmailItem({ email }: { email: CrmEmail }) {
  const inbound = email.direction === "INBOUND";
  const text = inbound ? commercialText(email.body ?? "") : (email.body ?? "");
  return (
    <li className="crm-tl-item" data-kind={inbound ? "in" : "out"}>
      <span className="crm-tl-dot" aria-hidden="true" />
      <div className="crm-tl-body">
        <p className="crm-tl-head"><strong>{inbound ? "Respondió" : email.touch_number ? `Le enviamos el toque ${email.touch_number}` : "Le contestamos"}</strong>
          <span className="crm-muted"> · {formatDateTime(email.at)}{email.mailbox_email ? ` · ${email.mailbox_email}` : ""}</span></p>
        {email.subject ? <p className="crm-tl-subject">{email.subject}</p> : null}
        <details><summary>{text.slice(0, 140) || "(sin texto)"}{text.length > 140 ? "…" : ""}</summary><p className="crm-tl-text">{text}</p></details>
        {email.cc_emails.length ? <p className="crm-muted">CC: {email.cc_emails.join(", ")}</p> : null}
      </div>
    </li>
  );
}

function ActivityItem({ activity }: { activity: CrmActivity }) {
  const stage = activity.kind === "CAMBIO_ETAPA" ? `${STAGE_LABELS[activity.data.de as CrmStage] ?? activity.data.de ?? ""} → ${STAGE_LABELS[activity.data.a as CrmStage] ?? activity.data.a ?? ""}` : null;
  return (
    <li className="crm-tl-item" data-kind={activity.kind.toLowerCase()}>
      <span className="crm-tl-dot" aria-hidden="true" />
      <div className="crm-tl-body">
        <p className="crm-tl-head"><strong>{ACTIVITY_LABELS[activity.kind] ?? activity.kind}</strong>
          <span className="crm-muted"> · {formatDateTime(activity.created_at)} · {activity.actor_email ? personName(activity.actor_email) : "Sistema"}</span></p>
        {stage ? <p className="crm-tl-subject">{stage}</p> : null}
        {activity.body ? <p className="crm-tl-text">{activity.body}</p> : null}
      </div>
    </li>
  );
}

function Tasks({ record, detail, users, canEdit, run }: { record: CrmRecord; detail: CrmDetail | null; users: CrmUser[]; canEdit: boolean; run: Run }) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [owner, setOwner] = useState(record.owner_user_id ?? "");
  async function save(event: FormEvent) {
    event.preventDefault();
    if (await run({ op: "TAREA_CREAR", payload: { record_id: record.id, title, due_at: localToIso(due), owner_user_id: owner } })) { setTitle(""); setDue(""); }
  }
  return (
    <div className="crm-tasks">
      {canEdit ? (
        <form className="crm-form" onSubmit={save}>
          <label className="crm-field"><span>Nueva tarea</span><input required minLength={2} maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Enviar cotización del levantamiento" /></label>
          <div className="crm-field-row">
            <label className="crm-field"><span>Vence</span><input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></label>
            <label className="crm-field"><span>Responsable</span>
              <select value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="">Sin responsable</option>{users.map((u) => <option key={u.id} value={u.id}>{personName(u.email)}</option>)}
              </select></label>
          </div>
          <div className="crm-dialog-actions"><button type="submit" className="crm-button" data-primary="true">Agregar tarea</button></div>
        </form>
      ) : null}
      {!detail ? <p className="crm-muted">Cargando tareas…</p> : detail.tasks.length === 0 ? <p className="crm-empty">Sin tareas.</p> : (
        <ul className="crm-task-list">
          {detail.tasks.map((task) => (
            <li key={task.id} data-status={task.status.toLowerCase()}>
              <label className="crm-check">
                <input type="checkbox" checked={task.status === "HECHA"} disabled={!canEdit || task.status === "CANCELADA"}
                  onChange={(e) => void run({ op: "TAREA_ESTADO", payload: { task_id: task.id, status: e.target.checked ? "HECHA" : "PENDIENTE" } })} />
                <span>{task.title}</span>
              </label>
              <span className="crm-muted">
                {task.due_at ? <span className={task.status === "PENDIENTE" && isOverdue(task.due_at) ? "crm-due" : undefined}>{formatDateTime(task.due_at)} · </span> : null}
                {personName(task.owner_email)}
              </span>
              {canEdit && task.status === "PENDIENTE" ? (
                <button type="button" className="crm-text-button" onClick={() => void run({ op: "TAREA_ESTADO", payload: { task_id: task.id, status: "CANCELADA" } })}>Cancelar</button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
