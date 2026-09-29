"use client";
import { useRef, useState } from "react";
import { ConnectMailboxAction, MailboxCapAction, MailboxStateAction, RevokeMailboxAction } from "@/components/CorreosActions";
import type { DirectLaneOverview } from "@/lib/correos/overview";

/* Buzones como tarjetas compactas en una fila (29-sep, Grant). Al hacer clic se abre una ventana con
   el detalle y las acciones de siempre; lo que hace cada acción no cambia. */

type Mailbox = DirectLaneOverview["mailboxes"][number];

const statusLabels: Record<string, string> = { DISCONNECTED: "Sin conectar", CONNECTED: "Conectado", PAUSED: "En pausa", KILLED: "Apagado" };
const stamp = new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: "America/Mexico_City" });

function tone(m: Mailbox): "ok" | "warn" | "bad" {
  if (m.status === "KILLED" || m.status === "DISCONNECTED" || !m.credential_active) return "bad";
  if (m.status === "PAUSED" || m.last_error || m.sync?.last_error_code) return "warn";
  return "ok";
}
function since(iso: string | null | undefined) {
  if (!iso) return "sin sincronizar";
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return min < 60 ? `sync hace ${min} min` : `sync ${stamp.format(new Date(iso))}`;
}
const rampText = (m: Mailbox) => m.ramp_mode === "SCHEDULE" ? `Semanal ${(m.ramp_schedule ?? []).join("→")} (semana ${(m.ramp_week ?? 0) + 1})` : m.ramp_mode === "AUTO" ? "Automática" : `Fija ${m.fixed_cap}`;

function Card({ m, onOpen }: { m: Mailbox; onOpen: () => void }) {
  const cap = m.ceiling ?? m.cap_max;
  const pct = cap > 0 ? Math.min(100, Math.round((m.sent_today / cap) * 100)) : 0;
  const [user, domain] = m.normalized_email.split("@");
  return (
    <button aria-label={`Abrir ${m.normalized_email}`} className="bz-card" data-tone={tone(m)} onClick={onOpen} type="button">
      <span className="bz-card-top">
        <span className="bz-dot" aria-hidden="true" />
        <span className="bz-mail"><strong>{user}@</strong><span>{domain}</span></span>
      </span>
      <span className="bz-count"><span>Hoy</span><strong>{m.sent_today}</strong><span>/ {cap}</span></span>
      <span className="bz-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
      <span className="bz-foot">
        {m.status !== "CONNECTED" ? <em>{statusLabels[m.status] ?? m.status}</em> : m.last_error ? <em>Con error</em> : <span>{since(m.sync?.last_synced_at)}</span>}
        <span>{m.sent_total} env.</span>
      </span>
    </button>
  );
}

export function MailboxDetail({ m, canOperate, canApprove, onClose }: { m: Mailbox; canOperate: boolean; canApprove: boolean; onClose: () => void }) {
  return (
    <div className="bz-dialog-body">
      <header className="bz-dialog-head">
        <div>
          <h3>{m.normalized_email}</h3>
          <p>{m.is_client_primary ? `Buzón del cliente · techo ${m.cap_max}/día` : `${m.domain} · Teckel`}</p>
        </div>
        <span className="bz-chip" data-tone={tone(m)}>{statusLabels[m.status] ?? m.status}</span>
        <button aria-label="Cerrar" className="bz-close" onClick={onClose} type="button">×</button>
      </header>

      <dl className="bz-facts">
        <div><dt>Hoy</dt><dd>{m.sent_today} de {m.ceiling ?? m.cap_max}{typeof m.new_today === "number" ? <small>nuevos {m.new_today}/{m.new_cap ?? m.effective_cap}</small> : null}{m.queued > 0 ? <small>{m.queued} en cola</small> : null}</dd></div>
        <div><dt>Tope</dt><dd>{rampText(m)} · techo {m.cap_max}{m.first_send_at ? <small>primer envío {stamp.format(new Date(m.first_send_at))}</small> : null}</dd></div>
        <div><dt>Sincronización</dt><dd>{m.sync?.last_synced_at ? stamp.format(new Date(m.sync.last_synced_at)) : "Sin sync"}{m.sync?.last_error_code ? <small className="bz-err">{m.sync.last_error_code}</small> : null}</dd></div>
        <div><dt>Actividad</dt><dd>{m.sent_total} enviados{m.last_error ? <small className="bz-err">{m.last_error}</small> : null}</dd></div>
        <div><dt>Conexión</dt><dd>{m.credential_connected_at ? `Desde ${stamp.format(new Date(m.credential_connected_at))}` : "Sin conectar"}{m.pending_invitation ? <small>Liga vigente hasta {stamp.format(new Date(m.pending_invitation.expires_at))}</small> : null}</dd></div>
      </dl>

      {canOperate ? (
        <div className="bz-actions">
          {m.status !== "KILLED" && !m.credential_active ? <section><h4>Conectar</h4><ConnectMailboxAction email={m.normalized_email} mailboxId={m.mailbox_id} /></section> : null}
          {m.credential_active ? <section><h4>{m.status === "PAUSED" ? "Reanudar" : m.status === "KILLED" ? "Reactivar" : "Pausar o apagar"}</h4><MailboxStateAction canUnkill={canApprove} mailboxId={m.mailbox_id} status={m.status} /></section> : null}
          {m.credential_active ? (
            <details><summary>Tope y rampa</summary>
              <MailboxCapAction capMax={m.cap_max} fixedCap={m.fixed_cap} isClientPrimary={m.is_client_primary} mailboxId={m.mailbox_id} rampAnchorAt={m.ramp_anchor_at ?? null} rampMode={m.ramp_mode} rampSchedule={m.ramp_schedule ?? null} />
            </details>
          ) : null}
          {m.credential_active ? <details className="bz-danger"><summary>Desconectar</summary><RevokeMailboxAction mailboxId={m.mailbox_id} /></details> : null}
        </div>
      ) : null}
    </div>
  );
}

export function CorreosBuzones({ mailboxes, canOperate, canApprove }: { mailboxes: Mailbox[]; canOperate: boolean; canApprove: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const m = mailboxes.find(x => x.mailbox_id === openId) ?? null;
  const connected = mailboxes.filter(x => x.status === "CONNECTED" && x.credential_active).length;
  const sentToday = mailboxes.reduce((s, x) => s + x.sent_today, 0);
  const capToday = mailboxes.filter(x => x.status === "CONNECTED").reduce((s, x) => s + (x.ceiling ?? x.cap_max), 0);

  function open(id: string) { setOpenId(id); dialog.current?.showModal(); }
  function close() { dialog.current?.close(); }

  return (
    <section aria-label="Buzones" className="bz">
      <header className="bz-head">
        <h2>Buzones</h2>
        <span>{connected}/{mailboxes.length} conectados · {sentToday} de {capToday} enviados hoy</span>
      </header>
      <div className="bz-row">
        {mailboxes.map(x => <Card key={x.mailbox_id} m={x} onOpen={() => open(x.mailbox_id)} />)}
      </div>

      <dialog className="bz-dialog" onClick={e => { if (e.target === e.currentTarget) close(); }} onClose={() => setOpenId(null)} ref={dialog}>
        {m ? <MailboxDetail canApprove={canApprove} canOperate={canOperate} m={m} onClose={close} /> : null}
      </dialog>
    </section>
  );
}
