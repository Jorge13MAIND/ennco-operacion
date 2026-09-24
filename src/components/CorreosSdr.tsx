"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SdrCaseView, SdrScreen } from "@/lib/correos/sdr/overview";
import type { RecoveryOverview } from "@/lib/correos/recovery-overview";

const intentLabels: Record<string, string> = { CONTEXT: "Pide contexto", EXPLICIT_INTEREST: "Expresa interés", PRICE: "Pregunta precio", UNSUBSCRIBE: "Solicita baja", OUT_OF_OFFICE: "Ausencia temporal", REFERRAL: "Refiere a otra persona", WRONG_PERSON: "Persona o ubicación incorrecta", NOT_NOW: "Ahora no lo necesita", REJECTION: "Rechazo", COMPLAINT: "Queja", TECHNICAL_COMMITMENT: "Requiere validación técnica", AMBIGUOUS: "Requiere lectura humana" };
const stateLabels: Record<string, string> = { READY: "Pendiente de procesar", REVIEW: "Por revisar", BLOCKED: "Bloqueado", NO_ACTION: "Revisado", SUPPRESSED: "Baja aplicada", MANUAL_HANDLED: "Respondido por una persona", QUEUED: "En cola de envío", SENT: "Enviado" };
async function mutate(body: Record<string, unknown>) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(body) + crypto.randomUUID()));
  const key = Array.from(new Uint8Array(digest)).map(v => v.toString(16).padStart(2, "0")).join("");
  const response = await fetch("/api/v1/operations/correos/sdr", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error === "SDR_FIVE_REVIEWED_CANARIES_REQUIRED" ? "Faltan cinco respuestas elegibles revisadas y enviadas, o las pruebas de aceptación." : result.error === "SDR_REVIEW_STALE" ? "La conversación cambió. Actualiza y vuelve a revisarla." : "La acción no pudo aplicarse. Revisa el caso antes de intentar otra vez.");
  return result;
}
function CaseCard({ item, canOperate }: { item: SdrCaseView; canOperate: boolean }) {
  const router = useRouter(); const [note, setNote] = useState(""); const [status, setStatus] = useState(""); const [busy, setBusy] = useState(false);
  const reviewable = !["QUEUED", "SENT", "SUPPRESSED"].includes(item.state);
  async function act(action: string) {
    setBusy(true); setStatus("");
    try { await mutate({ action, case_id: item.id, ...(action === "ACK" ? {} : { thread_hash: item.thread_hash, note }) }); setStatus(action === "ACK" ? "Aviso recibido y registrado." : "Revisión guardada."); router.refresh(); }
    catch (error) { setStatus(error instanceof Error ? error.message : "No se pudo guardar."); }
    finally { setBusy(false); }
  }
  return <article className="compact-operation-form" style={{ minWidth: 0, overflowWrap: "anywhere" }} aria-label={intentLabels[item.decision?.intent ?? ""] ?? "Respuesta pendiente"}>
    <div className="inline-operation"><strong>{intentLabels[item.decision?.intent ?? ""] ?? "Respuesta pendiente"}</strong><span className="badge">{stateLabels[item.state] ?? "Por revisar"}</span></div>
    <p><strong>{item.contact_email ?? "Identidad pendiente"}</strong> · {item.mailbox_email}<br />{item.subject}</p>
    {item.reply_classification === "UNREVIEWED" ? <p className="notice">La respuesta aún no tiene clasificación comercial revisada. Registra esa decisión en Operación; la sugerencia del SDR no la sustituye.</p> : null}
    <details><summary>Leer conversación completa ({item.conversation.length} mensajes)</summary>{item.conversation.map((m, i) => <div key={i}><p className="fine">{m.from} · {new Date(m.date).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}</p><p style={{ whiteSpace: "pre-wrap" }}>{m.text}</p></div>)}</details>
    {item.decision?.evidence?.map((text, i) => <blockquote key={i}>{text}</blockquote>)}
    <p>{item.next_action}</p>
    {item.decision?.draft ? <details><summary>Borrador sugerido</summary><p style={{ whiteSpace: "pre-wrap" }}>{item.decision.draft}</p></details> : null}
    <p className="fine">La sugerencia del SDR no crea un lead ni una obligación contractual. La clasificación comercial se revisa por separado.</p>
    {canOperate && item.can_ack ? <button className="button secondary" disabled={busy} onClick={() => void act("ACK")}>Confirmar recepción del aviso</button> : null}
    {canOperate && reviewable ? <><label>Nota de revisión<textarea aria-label="Nota de revisión" value={note} onChange={event => setNote(event.target.value)} maxLength={1000} /></label><div className="inline-operation">
      <button className="button secondary" disabled={busy || note.trim().length < 5} onClick={() => void act("REVIEWED")}>Registrar revisión y siguiente acción</button>
      <button className="button secondary" disabled={busy || note.trim().length < 5} onClick={() => void act("RETRY")}>Revisar de nuevo el hilo</button>
      {item.decision?.eligible ? <button className="button" disabled={busy || note.trim().length < 5} onClick={() => void act("APPROVE")}>Aprobar este borrador para envío</button> : null}
    </div></> : null}
    {status ? <p role="status">{status}</p> : null}
  </article>;
}
function UnmatchedCard({ item, canOperate }: { item: RecoveryOverview["unmatched"][number]; canOperate: boolean }) {
  const router = useRouter(); const [note, setNote] = useState(""); const [status, setStatus] = useState(""); const [busy, setBusy] = useState(false);
  async function review(decision: "REVIEWED" | "UNRELATED" | "NEEDS_CONTEXT") {
    setBusy(true); setStatus("");
    try {
      const body = { decision, note: note.trim() };
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(body) + crypto.randomUUID()));
      const key = Array.from(new Uint8Array(digest)).map(v => v.toString(16).padStart(2, "0")).join("");
      const response = await fetch(`/api/v1/operations/correos/sdr/unmatched/${item.id}/review`, {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("No se pudo registrar la revisión. Comprueba el correo antes de reintentar.");
      setStatus("Revisión registrada."); router.refresh();
    } catch (error) { setStatus(error instanceof Error ? error.message : "No se pudo registrar."); }
    finally { setBusy(false); }
  }
  return <article className="compact-operation-form" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
    <div className="inline-operation"><strong>{item.normalized_from}</strong><span className="badge">{item.decision === "NEEDS_CONTEXT" ? "Falta contexto" : "Sin revisar"}</span></div>
    <p>{item.subject}</p><p>{item.next_action}</p>
    <details><summary>Leer correo recuperado</summary><p style={{ whiteSpace: "pre-wrap" }}>{item.body_text ?? "Cuerpo pendiente de recuperación"}</p></details>
    {canOperate ? <><label>Siguiente acción comprobada<textarea aria-label="Siguiente acción del correo recuperado" value={note} onChange={event => setNote(event.target.value)} maxLength={1000} /></label>
      <div className="inline-operation">
        <button className="button secondary" disabled={busy || note.trim().length < 5} onClick={() => void review("REVIEWED")}>Registrar revisión</button>
        <button className="button secondary" disabled={busy || note.trim().length < 5} onClick={() => void review("NEEDS_CONTEXT")}>Falta contexto</button>
        <button className="button secondary" disabled={busy || note.trim().length < 5} onClick={() => void review("UNRELATED")}>No comercial</button>
      </div></> : null}
    {status ? <p role="status">{status}</p> : null}
  </article>;
}
export function CorreosSdr({ screen, canOperate, canAdmin }: { screen: SdrScreen; canOperate: boolean; canAdmin: boolean; userId: string | null }) {
  const router = useRouter(); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  async function mode(value: string) { setBusy(true); try { await mutate({ action: "MODE", mode: value }); setMessage("Modo actualizado."); router.refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo actualizar."); } finally { setBusy(false); } }
  return <section className="panel" aria-label="SDR por email"><div className="panel-head"><div><h2>Atención de respuestas por email</h2><p>Cada conversación tiene una siguiente acción. Los casos delicados requieren revisión humana.</p></div><span className="badge">{!screen.live ? "Demostración" : !screen.available ? "Estado no disponible" : screen.status?.mode === "AUTO" ? "Automático acotado" : screen.status?.mode === "PAUSED" ? "En pausa" : "Revisión humana"}</span></div>
    <div style={{ padding: "20px 24px" }}>
    {!screen.available ? <p role="alert">No se pudo consultar la cola. Esto no significa que no haya respuestas pendientes.</p> : null}
    {screen.status ? <><p>{screen.status.reviewed_canaries}/5 respuestas elegibles revisadas y enviadas. {screen.status.pending_alerts} avisos pendientes de recepción.</p>
      {!screen.status.model_calls_enabled ? <p className="notice">El análisis con IA está pendiente de habilitación. Los casos conservan su siguiente acción para revisión humana.</p> : null}
      {screen.status.legacy_open_incidents > 0 ? <p className="fine">Hay {screen.status.legacy_open_incidents} incidentes anteriores a esta recuperación. Permanecen abiertos para revisión individual.</p> : null}
      {canAdmin ? <div className="inline-operation"><button className="button secondary" disabled={busy || screen.status.mode === "PAUSED"} onClick={() => void mode("PAUSED")}>Pausar SDR</button><button className="button secondary" disabled={busy || screen.status.mode === "REVIEW"} onClick={() => void mode("REVIEW")}>Modo revisión</button><button className="button secondary" disabled={busy || screen.status.reviewed_canaries < 5 || !screen.status.model_calls_enabled} onClick={() => void mode("AUTO")}>Activar clases aprobadas</button></div> : null}</> : null}
    {screen.inventory ? <div className="compact-operation-form"><h3>Contactos para la siguiente campaña</h3>
      <p>{screen.inventory.uncontacted} sin contactar. <strong>{screen.inventory.ready} aptos para incorporar</strong> con investigación y revisión vigente. {screen.inventory.verified_accounts} empresas verificadas y {screen.inventory.promoted_contacts} personas promovidas.</p>
      {screen.inventory.ready === 0 ? <p className="notice">La reserva aún no acredita planta y responsabilidad de compra. Los nuevos contactos permanecen retenidos.</p> : null}
      <details><summary>Ver los primeros {screen.inventory.review_queue.length} por investigar</summary>
        {screen.inventory.review_queue.map(item => <p key={item.contact_id}>{item.full_name} · {item.role_title} · {item.legal_name} ({item.state ?? "ubicación pendiente"}). Empresa: {item.account_research_status}; persona: {item.person_researched ? "investigada" : "pendiente"}; revisión comercial: {item.clearance_decision ?? "pendiente"}.</p>)}
      </details></div> : screen.live ? <p className="notice">No se pudo consultar la aptitud de contactos. No se asume que la reserva esté lista.</p> : null}
    {message ? <p role="status">{message}</p> : null}
    {screen.cases.map(item => <CaseCard key={item.id} item={item} canOperate={canOperate} />)}
    {screen.unmatched.length > 0 ? <h3>Correos recuperados fuera del hilo registrado</h3> : null}
    {screen.unmatched.map(item => <UnmatchedCard key={item.id} item={item} canOperate={canOperate} />)}
    {screen.available && screen.cases.length === 0 ? <p>{screen.live ? "Sin casos en la cola del SDR. La conciliación y las respuestas sin vínculo se revisan por separado." : "La demostración no consulta ni modifica conversaciones reales."}</p> : null}
    </div>
  </section>;
}
