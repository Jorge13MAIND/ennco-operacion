"use client";
import { useMemo, useState } from "react";
import { commercialText } from "@/lib/correos/sdr/reply-text";
import { useRouter } from "next/navigation";
import type { SdrCaseView, SdrScreen } from "@/lib/correos/sdr/overview";
import type { RecoveryOverview } from "@/lib/correos/recovery-overview";

/* Atención de respuestas: bandeja a la izquierda y conversación a la derecha (29-sep, Grant).
   Desde el 20-oct es solo para ver al lead y lo que mandó el motor: las respuestas se contestan desde
   el correo (Grant). Por eso no hay caja para escribir ni acciones que manden algo; queda solo
   confirmar un aviso (ACK). El bloque mide lo que la pantalla y cada columna se desplaza por dentro. */

const intentLabels: Record<string, string> = { CONTEXT: "Pide contexto", EXPLICIT_INTEREST: "Expresa interés", PRICE: "Pregunta precio", UNSUBSCRIBE: "Solicita baja", OUT_OF_OFFICE: "Ausencia temporal", REFERRAL: "Refiere a otra persona", WRONG_PERSON: "Persona o ubicación incorrecta", NOT_NOW: "Ahora no lo necesita", REJECTION: "Rechazo", COMPLAINT: "Queja", TECHNICAL_COMMITMENT: "Requiere validación técnica", AMBIGUOUS: "Requiere lectura humana" };
const stateLabels: Record<string, string> = { READY: "Pendiente de procesar", REVIEW: "Por revisar", BLOCKED: "Bloqueado", NO_ACTION: "Revisado", SUPPRESSED: "Baja aplicada", MANUAL_HANDLED: "Respondido por una persona", QUEUED: "En cola de envío", SENT: "Enviado" };

/** Prioridad visible: 1 oportunidad (piden visita, precio, interés), 2 requiere lectura, 3 cierre. */
const PRIORITY: Record<string, 1 | 2 | 3> = {
  EXPLICIT_INTEREST: 1, TECHNICAL_COMMITMENT: 1, PRICE: 1, REFERRAL: 1,
  CONTEXT: 2, AMBIGUOUS: 2, WRONG_PERSON: 2, COMPLAINT: 2,
  NOT_NOW: 3, REJECTION: 3, UNSUBSCRIBE: 3, OUT_OF_OFFICE: 3,
};
const DONE_STATES = ["QUEUED", "SENT", "SUPPRESSED", "NO_ACTION", "MANUAL_HANDLED"];

type Unmatched = RecoveryOverview["unmatched"][number];
type Row =
  | { kind: "case"; id: string; item: SdrCaseView; priority: 1 | 2 | 3; who: string; company: string; subject: string; preview: string; at: number; mailbox: string; intent: string }
  | { kind: "unmatched"; id: string; item: Unmatched; priority: 2; who: string; company: string; subject: string; preview: string; at: number; mailbox: string; intent: string };
type Group = "todas" | "oportunidades" | "revisar" | "aviso" | "resueltas" | "sinvinculo";
type Sort = "urgencia" | "recientes" | "antiguas";

async function mutate(body: Record<string, unknown>) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(body) + crypto.randomUUID()));
  const key = Array.from(new Uint8Array(digest)).map(v => v.toString(16).padStart(2, "0")).join("");
  const response = await fetch("/api/v1/operations/correos/sdr", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error === "SDR_FIVE_REVIEWED_CANARIES_REQUIRED" ? "Faltan cinco respuestas elegibles revisadas y enviadas, o las pruebas de aceptación." : result.error === "SDR_REVIEW_STALE" ? "La conversación cambió. Actualiza y vuelve a revisarla." : "La acción no pudo aplicarse. Revisa el caso antes de intentar otra vez.");
  return result;
}

const domainOf = (email: string | null | undefined) => (email ?? "").split("@")[1] ?? "";
const companyOf = (email: string | null | undefined) => {
  const d = domainOf(email).split(".")[0] ?? "";
  return d ? d.charAt(0).toUpperCase() + d.slice(1) : "Empresa pendiente";
};
const clip = (text: string, n = 140) => { const t = text.replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
function ago(ms: number) {
  if (!Number.isFinite(ms)) return "";
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ayer" : `hace ${d} días`;
}
const fullDate = (iso: string) => new Date(iso).toLocaleString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "medium", timeStyle: "short" });

function toRows(screen: SdrScreen): Row[] {
  const cases: Row[] = screen.cases.map(item => {
    const inbound = [...item.conversation].reverse().find(m => !m.from.toLowerCase().includes(item.mailbox_email.toLowerCase()));
    const intent = item.decision?.intent ?? "";
    return {
      kind: "case", id: item.id, item, priority: PRIORITY[intent] ?? 2,
      who: item.contact_email ?? "Identidad pendiente", company: companyOf(item.contact_email),
      subject: item.subject ?? "Sin asunto", preview: clip(inbound?.text ?? item.next_action),
      at: Date.parse(inbound?.date ?? item.updated_at), mailbox: item.mailbox_email, intent,
    };
  });
  const unmatched: Row[] = screen.unmatched.map(item => ({
    kind: "unmatched", id: item.id, item, priority: 2, who: item.normalized_from, company: companyOf(item.normalized_from),
    subject: item.subject ?? "Sin asunto", preview: clip(item.body_text ?? item.next_action), at: Number.NaN, mailbox: "", intent: "",
  }));
  return [...cases, ...unmatched];
}

function groupOf(row: Row): Group[] {
  if (row.kind === "unmatched") return ["sinvinculo", "revisar"];
  const g: Group[] = [];
  if (row.priority === 1 && !DONE_STATES.includes(row.item.state)) g.push("oportunidades");
  if (!DONE_STATES.includes(row.item.state)) g.push("revisar");
  if (row.item.can_ack) g.push("aviso");
  if (DONE_STATES.includes(row.item.state)) g.push("resueltas");
  return g;
}

function IntentChip({ row }: { row: Row }) {
  if (row.kind === "unmatched") return <span className="sdr-chip" data-tone="2">Sin vínculo</span>;
  return <span className="sdr-chip" data-tone={row.priority}>{intentLabels[row.intent] ?? "Respuesta pendiente"}</span>;
}

/** Lo que escribió la persona, sin firma, avisos legales, imágenes incrustadas ni el correo citado. */
function visibleText(text: string): string {
  return commercialText(text)
    .replace(/\[(cid:[^\]]*|confidential|confidencial|external|externo|ext)\]/gi, "")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function Message({ from, date, text, ours }: { from: string; date: string | null; text: string; ours: boolean }) {
  const [full, setFull] = useState(false);
  const short = visibleText(text);
  const trimmed = short.length > 0 && short.length < text.trim().length - 8;
  return (
    <div className="sdr-msg" data-ours={ours ? "" : undefined}>
      <p className="sdr-msg-meta">{ours ? "ENNCO" : from}{date ? ` · ${fullDate(date)}` : ""}</p>
      <p className="sdr-msg-text">{full || !trimmed ? text.trim() : short}</p>
      {trimmed ? <button className="sdr-msg-more" onClick={() => setFull(v => !v)} type="button">{full ? "Ver menos" : "Ver completo"}</button> : null}
    </div>
  );
}

/** Abre la conversación en el último mensaje. */
const scrollToEnd = (el: HTMLDivElement | null) => { if (el) el.scrollTop = el.scrollHeight; };

function CaseDetail({ row, canOperate, onBack }: { row: Extract<Row, { kind: "case" }>; canOperate: boolean; onBack: (() => void) | null }) {
  const item = row.item;
  const router = useRouter(); const [status, setStatus] = useState(""); const [busy, setBusy] = useState(false);
  async function ack() {
    setBusy(true); setStatus("");
    try { await mutate({ action: "ACK", case_id: item.id }); setStatus("Aviso recibido y registrado."); router.refresh(); }
    catch (error) { setStatus(error instanceof Error ? error.message : "No se pudo guardar."); }
    finally { setBusy(false); }
  }
  return (
    <article className="sdr-detail-body" aria-label={intentLabels[row.intent] ?? "Respuesta pendiente"}>
      <div className="sdr-detail-top">
        {onBack ? <button className="sdr-back" onClick={onBack} type="button">← Volver a la bandeja</button> : null}
        <header className="sdr-detail-head">
          <div className="sdr-detail-who">
            <h3>{row.who}</h3>
            <p>{row.company} · respondió a <strong>{item.mailbox_email}</strong></p>
          </div>
          <div className="sdr-detail-chips">
            <IntentChip row={row} />
            <span className="sdr-chip" data-tone="state">{stateLabels[item.state] ?? "Por revisar"}</span>
          </div>
        </header>
        <p className="sdr-subject">{row.subject}{Number.isFinite(row.at) ? <span> · {ago(row.at)}</span> : null}</p>
        <div className="sdr-next"><span>Siguiente acción</span><p>{item.next_action}</p></div>
      </div>

      <div className="sdr-thread" aria-label="Conversación" ref={scrollToEnd} tabIndex={0}>
        {item.conversation.length === 0 ? <p className="sdr-hint">Sin mensajes recuperados de este hilo.</p> : null}
        {item.conversation.map((m, i) => (
          <Message date={m.date} from={m.from} key={i} ours={m.from.toLowerCase().includes(item.mailbox_email.toLowerCase())} text={m.text} />
        ))}
      </div>

      <footer className="sdr-detail-foot">
        {item.decision?.evidence?.length ? (
          <details className="sdr-evidence"><summary>Por qué lo clasificó así</summary>{item.decision.evidence.map((text, i) => <blockquote key={i}>{text}</blockquote>)}</details>
        ) : null}
        <div className="sdr-foot-row">
          <p className="sdr-fine">Solo lectura: las respuestas se contestan desde el correo. La clasificación del SDR no crea un lead ni una obligación contractual.</p>
          {canOperate && item.can_ack ? <button className="sdr-btn" data-primary="" disabled={busy} onClick={() => void ack()} type="button">Confirmar aviso</button> : null}
        </div>
        {status ? <p className="sdr-status" role="status">{status}</p> : null}
      </footer>
    </article>
  );
}

function UnmatchedDetail({ row, onBack }: { row: Extract<Row, { kind: "unmatched" }>; onBack: (() => void) | null }) {
  const item = row.item;
  return (
    <article className="sdr-detail-body">
      <div className="sdr-detail-top">
        {onBack ? <button className="sdr-back" onClick={onBack} type="button">← Volver a la bandeja</button> : null}
        <header className="sdr-detail-head">
          <div className="sdr-detail-who"><h3>{row.who}</h3><p>Correo recuperado fuera del hilo registrado</p></div>
          <div className="sdr-detail-chips"><IntentChip row={row} /><span className="sdr-chip" data-tone="state">{item.decision === "NEEDS_CONTEXT" ? "Falta contexto" : "Sin revisar"}</span></div>
        </header>
        <p className="sdr-subject">{row.subject}</p>
        <div className="sdr-next"><span>Siguiente acción</span><p>{item.next_action}</p></div>
      </div>
      <div className="sdr-thread" aria-label="Conversación" ref={scrollToEnd} tabIndex={0}>
        <Message date={null} from={row.who} ours={false} text={item.body_text ?? "Cuerpo pendiente de recuperación"} />
      </div>
      <footer className="sdr-detail-foot"><p className="sdr-fine">Solo lectura: este correo no quedó ligado a un envío del motor; se atiende desde el correo.</p></footer>
    </article>
  );
}

const GROUPS: Array<{ key: Group; label: string }> = [
  { key: "todas", label: "Todas" }, { key: "oportunidades", label: "Oportunidades" }, { key: "revisar", label: "Por revisar" },
  { key: "aviso", label: "Aviso pendiente" }, { key: "resueltas", label: "Resueltas" }, { key: "sinvinculo", label: "Sin vínculo" },
];

export function CorreosSdr({ screen, canOperate, canAdmin }: { screen: SdrScreen; canOperate: boolean; canAdmin: boolean; userId: string | null }) {
  const router = useRouter(); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const [group, setGroup] = useState<Group>("revisar");
  const [search, setSearch] = useState("");
  const [intent, setIntent] = useState("");
  const [mailbox, setMailbox] = useState("");
  const [sort, setSort] = useState<Sort>("urgencia");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  async function mode(value: string) { setBusy(true); try { await mutate({ action: "MODE", mode: value }); setMessage("Modo actualizado."); router.refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo actualizar."); } finally { setBusy(false); } }

  const rows = useMemo(() => toRows(screen), [screen]);
  const counts = useMemo(() => {
    const c: Record<Group, number> = { todas: rows.length, oportunidades: 0, revisar: 0, aviso: 0, resueltas: 0, sinvinculo: 0 };
    for (const r of rows) for (const g of groupOf(r)) c[g] += 1;
    return c;
  }, [rows]);
  const mailboxes = useMemo(() => [...new Set(rows.map(r => r.mailbox).filter(Boolean))].sort(), [rows]);
  const intents = useMemo(() => [...new Set(rows.map(r => r.intent).filter(Boolean))].sort(), [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("es");
    const list = rows.filter(r => (group === "todas" || groupOf(r).includes(group))
      && (!intent || r.intent === intent) && (!mailbox || r.mailbox === mailbox)
      && (!q || `${r.who} ${r.company} ${r.subject} ${r.preview}`.toLocaleLowerCase("es").includes(q)));
    const time = (r: Row) => (Number.isFinite(r.at) ? r.at : 0);
    return list.sort((a, b) => sort === "recientes" ? time(b) - time(a)
      : sort === "antiguas" ? time(a) - time(b)
      // Urgencia: oportunidades primero y, dentro de cada nivel, quien lleva más tiempo esperando.
      : a.priority - b.priority || time(a) - time(b));
  }, [rows, group, intent, mailbox, search, sort]);

  const selected = visible.find(r => r.id === selectedId) ?? visible[0] ?? null;
  const modeLabel = !screen.live ? "Demostración" : !screen.available ? "Estado no disponible" : screen.status?.mode === "AUTO" ? "Automático acotado" : screen.status?.mode === "PAUSED" ? "En pausa" : "Revisión humana";

  return (
    <>
      <section aria-label="SDR por email" className="panel sdr">
        <header className="sdr-head">
          <div>
            <h2>Atención de respuestas</h2>
            <p>Cada conversación tiene una siguiente acción. Las oportunidades van primero.</p>
          </div>
          <div className="sdr-head-tools">
            <span className="sdr-chip" data-tone="state">{modeLabel}</span>
            {screen.status ? <button aria-expanded={showConfig} className="sdr-btn" onClick={() => setShowConfig(v => !v)} type="button">Configuración del SDR</button> : null}
          </div>
        </header>

        {!screen.available ? <p className="sdr-alert" role="alert">No se pudo consultar la cola. Esto no significa que no haya respuestas pendientes.</p> : null}

        {showConfig && screen.status ? (
          <div className="sdr-config">
            <p><strong>{screen.status.reviewed_canaries}/5</strong> respuestas elegibles revisadas y enviadas · <strong>{screen.status.pending_alerts}</strong> avisos pendientes de recepción.</p>
            {!screen.status.model_calls_enabled ? <p className="sdr-hint">El análisis con IA está pendiente de habilitación. Los casos conservan su siguiente acción para revisión humana.</p> : null}
            {screen.status.legacy_open_incidents > 0 ? <p className="sdr-hint">Hay {screen.status.legacy_open_incidents} incidentes anteriores a esta recuperación. Permanecen abiertos para revisión individual.</p> : null}
            {canAdmin ? (
              <div className="sdr-actions-row">
                <button className="sdr-btn" disabled={busy || screen.status.mode === "PAUSED"} onClick={() => void mode("PAUSED")} type="button">Pausar SDR</button>
                <button className="sdr-btn" disabled={busy || screen.status.mode === "REVIEW"} onClick={() => void mode("REVIEW")} type="button">Modo revisión</button>
                <button className="sdr-btn" disabled={busy || screen.status.reviewed_canaries < 5 || !screen.status.model_calls_enabled} onClick={() => void mode("AUTO")} type="button">Activar clases aprobadas</button>
              </div>
            ) : null}
            {message ? <p className="sdr-status" role="status">{message}</p> : null}
          </div>
        ) : null}

        <nav aria-label="Filtrar respuestas" className="sdr-tabs">
          {GROUPS.map(g => (
            <button aria-pressed={group === g.key} className="sdr-tab" data-tone={g.key} key={g.key} onClick={() => setGroup(g.key)} type="button">
              <span>{g.label}</span><strong>{counts[g.key]}</strong>
            </button>
          ))}
        </nav>

        <div className="sdr-filters">
          <label className="sdr-search"><span className="sdr-sr">Buscar</span><input onChange={e => setSearch(e.target.value)} placeholder="Buscar por correo, empresa o texto…" type="search" value={search} /></label>
          <select aria-label="Intención" onChange={e => setIntent(e.target.value)} value={intent}>
            <option value="">Todas las intenciones</option>
            {intents.map(i => <option key={i} value={i}>{intentLabels[i] ?? i}</option>)}
          </select>
          <select aria-label="Buzón" onChange={e => setMailbox(e.target.value)} value={mailbox}>
            <option value="">Todos los buzones</option>
            {mailboxes.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <select aria-label="Orden" onChange={e => setSort(e.target.value as Sort)} value={sort}>
            <option value="urgencia">Urgentes primero</option>
            <option value="recientes">Más recientes</option>
            <option value="antiguas">Más antiguas</option>
          </select>
        </div>

        <div className="sdr-split" data-open={selectedId ? "" : undefined}>
          <ul aria-label="Respuestas" className="sdr-list">
            {visible.length === 0 ? (
              <li className="sdr-empty">{screen.live ? "No hay respuestas con estos filtros." : "La demostración no consulta ni modifica conversaciones reales."}</li>
            ) : visible.map(r => (
              <li key={r.id}>
                <button aria-current={selected?.id === r.id ? "true" : undefined} className="sdr-card" data-priority={r.priority} onClick={() => setSelectedId(r.id)} type="button">
                  <span className="sdr-card-top"><strong>{r.who}</strong><time>{ago(r.at)}</time></span>
                  <span className="sdr-card-mid"><span>{r.company}</span><IntentChip row={r} /></span>
                  <span className="sdr-card-subject">{r.subject}</span>
                  <span className="sdr-card-preview">{r.preview}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="sdr-detail">
            {!selected ? <p className="sdr-empty">Elige una respuesta para leerla.</p>
              // La llave cambia al abrir en celular: el detalle se vuelve a montar visible y abre en el último mensaje.
              : selected.kind === "case" ? <CaseDetail canOperate={canOperate} key={`${selected.id}:${selectedId ? "abierto" : "bandeja"}`} onBack={selectedId ? () => setSelectedId(null) : null} row={selected} />
              : <UnmatchedDetail key={`${selected.id}:${selectedId ? "abierto" : "bandeja"}`} onBack={selectedId ? () => setSelectedId(null) : null} row={selected} />}
          </div>
        </div>
      </section>

      {screen.inventory ? (
        <details className="panel sdr-inventory">
          <summary>
            <span><strong>Contactos para la siguiente campaña</strong></span>
            <span className="sdr-inventory-kpis">{screen.inventory.uncontacted} sin contactar · <strong>{screen.inventory.ready} aptos</strong> · {screen.inventory.verified_accounts} empresas verificadas · {screen.inventory.promoted_contacts} personas promovidas</span>
          </summary>
          <div className="sdr-inventory-body">
            {screen.inventory.ready === 0 ? <p className="sdr-hint">La reserva aún no acredita planta y responsabilidad de compra. Los nuevos contactos permanecen retenidos.</p> : null}
            <table>
              <thead><tr><th>Persona</th><th>Empresa</th><th>Estado</th><th>Empresa investigada</th><th>Persona</th><th>Revisión comercial</th></tr></thead>
              <tbody>
                {screen.inventory.review_queue.map(item => (
                  <tr key={item.contact_id}>
                    <td>{item.full_name}<small>{item.role_title}</small></td><td>{item.legal_name}</td><td>{item.state ?? "Pendiente"}</td>
                    <td>{item.account_research_status}</td><td>{item.person_researched ? "Investigada" : "Pendiente"}</td><td>{item.clearance_decision ?? "Pendiente"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : screen.live ? <p className="sdr-alert">No se pudo consultar la aptitud de contactos. No se asume que la reserva esté lista.</p> : null}
    </>
  );
}
