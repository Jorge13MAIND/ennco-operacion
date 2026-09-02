import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Route } from "next";
import Link from "next/link";
import { z } from "zod";

import {
  ApproveCampaignAction,
  CampaignStateAction,
  ConnectMailboxAction,
  CreateCampaignAction,
  EnrollContactsAction,
  MailboxCapAction,
  MailboxStateAction,
  ReplyAction,
  RevokeMailboxAction,
} from "@/components/CorreosActions";
import { MetricValue } from "@/components/MetricValue";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { loadDirectLaneScreen, type DirectLaneOverview } from "@/lib/correos/overview";
import { DIRECT_LANE_VARIANT_LABELS } from "@/lib/correos/roles";
import { operationalLabel } from "@/lib/operations/presentation";

export const dynamic = "force-dynamic";

const stamp = new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: "America/Mexico_City" });
const dayStamp = new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short", timeZone: "America/Mexico_City" });

const mailboxStatusLabels: Record<string, string> = {
  DISCONNECTED: "Sin conectar",
  CONNECTED: "Conectado",
  PAUSED: "En pausa",
  KILLED: "Apagado",
};

const messageStatusLabels: Record<string, string> = {
  DRY_RUN: "Sombra",
  QUEUED: "En cola",
  SENDING: "Enviando",
  SENT: "Enviado",
  DELIVERED: "Entregado",
  FAILED: "Falló",
  BOUNCED: "Rebotó",
  QUARANTINED: "Cuarentena",
};

const playbookSchema = z.object({
  responses: z.array(z.object({ intent: z.string(), body: z.string() })),
}).passthrough();

const intentLabels: Record<string, string> = {
  POSITIVE: "Positiva: sí me interesa",
  REFERRAL: "Referido: habla con…",
  NOT_NOW: "Ahora no",
  WHAT_IS_THIS: "¿Qué es esto?",
  PRICE_OBJECTION: "Objeción de precio",
  CHEAPER_VENDOR: "Tienen uno más barato",
  INTERNAL_ALIGNMENT: "Lo tengo que ver internamente",
  COMMERCIAL_COMMITMENT: "Piden compromiso comercial",
  UNSUBSCRIBE: "Baja",
};

async function loadPlaybookTemplates(): Promise<Array<{ intent: string; label: string; body: string }>> {
  try {
    const raw = await readFile(resolve(process.cwd(), "data/campaigns/response-playbook-v1.json"), "utf8");
    return playbookSchema.parse(JSON.parse(raw)).responses.map((response) => ({
      intent: response.intent,
      label: intentLabels[response.intent] ?? response.intent,
      body: response.body,
    }));
  } catch {
    return [];
  }
}

function Flag({ label, ok, okText, badText }: { label: string; ok: boolean; okText: string; badText: string }) {
  return <div><span>{label}</span><strong className={`status ${ok ? "" : "blocked"}`}>{ok ? okText : badText}</strong></div>;
}

function firstName(fullName: string | null | undefined): string {
  return (fullName ?? "").trim().split(/\s+/u)[0] || "hola";
}

function sumEnrollments(overview: DirectLaneOverview, statuses: string[]): number {
  return overview.campaigns.reduce((total, campaign) => total + statuses.reduce((inner, status) => inner + (campaign.enrollments[status] ?? 0), 0), 0);
}

export default async function CorreosPage() {
  const access = await requireOperationsAccess();
  const [screen, templates] = await Promise.all([loadDirectLaneScreen(access), loadPlaybookTemplates()]);
  const { overview } = screen;
  const live = screen.evidenceClass === "live";
  const canOperate = live && access.role !== "auditor_readonly";
  const connectedMailboxes = overview.mailboxes.filter((mailbox) => mailbox.status === "CONNECTED" && mailbox.credential_active);
  const capTotal = connectedMailboxes.reduce((total, mailbox) => total + mailbox.effective_cap, 0);
  const engineOpen = !overview.flags.global_kill_switch && overview.flags.external_send_allowed && overview.flags.annex_a_ready && screen.released && screen.mode === "live";
  const runningCampaign = overview.campaigns.find((campaign) => campaign.state === "RUNNING") ?? overview.campaigns[0] ?? null;

  return (
    <main className="shell section operations-main" id="main-content" tabIndex={-1}>
      <header className="operations-page-heading">
        <div>
          <p className="eyebrow">Control Room · Correos</p>
          <h1>Motor de <span className="cr-accent-text">correos</span>.</h1>
          <p>Carril directo: los buzones que ya tenemos, el copy aprobado y las respuestas en un solo lugar. Verdad operativa {stamp.format(new Date(screen.generatedAt))}.</p>
        </div>
        {screen.evidenceClass === "live" ? null : <span className="badge">{operationalLabel(screen.evidenceClass)}</span>}
      </header>

      <section aria-label="Estado del carril directo" className={`command-status ${engineOpen ? "ready" : "blocked"}`}>
        <div className="command-status-primary">
          <span>Carril directo</span>
          <strong>{!screen.released ? "NO LIBERADO" : screen.mode === "shadow" ? "MODO SOMBRA" : engineOpen ? "ENVIANDO" : "BLOQUEADO"}</strong>
          <p>{!screen.released
            ? "ENNCO_DIRECT_LANE_RELEASED no está en true en este ambiente: los crons responden HOLD y nadie puede conectar buzones."
            : screen.mode === "shadow"
              ? "El motor reclama toques y los deja como Sombra sin tocar Gmail. Cambiar ENNCO_DIRECT_LANE_MODE a live enciende el envío real."
              : engineOpen
                ? `Un correo por buzón conectado cada 5 minutos, lunes a viernes de 09:30 a 13:30. Tope de hoy: ${capTotal} entre ${connectedMailboxes.length} buzón(es).`
                : "Algún candado global está cerrado. Revisa las banderas de la derecha antes de esperar envíos."}</p>
        </div>
        <div className="command-status-facts">
          <Flag badText="ACTIVO" label="Kill switch" ok={!overview.flags.global_kill_switch} okText="INACTIVO" />
          <Flag badText="NO" label="Envío externo" ok={overview.flags.external_send_allowed} okText="AUTORIZADO" />
          <Flag badText="SIN APLICAR" label="Anexo A" ok={overview.flags.annex_a_ready} okText="APLICADO" />
          <Flag badText="CERRADA" label="Ventana" ok={overview.flags.send_window_open} okText="ABIERTA" />
        </div>
      </section>

      {!live ? (
        <div className="notice operations-disclosure">
          <strong>Modo sintético.</strong>
          <p>Los buzones, la campaña y las respuestas de esta pantalla son un ejemplo para recorrer el flujo. Ninguna acción escribe en la base.</p>
        </div>
      ) : null}

      <section aria-label="Resultado del carril" className="metric-grid operations-metrics">
        <div className="metric"><span>Enviados hoy</span><strong><MetricValue value={overview.totals.sent_today} /></strong></div>
        <div className="metric"><span>En sombra hoy</span><strong><MetricValue value={overview.totals.shadow_today} /></strong></div>
        <div className="metric"><span>En cola</span><strong><MetricValue value={overview.totals.queued} /></strong></div>
        <div className="metric"><span>Fallidos hoy</span><strong><MetricValue value={overview.totals.failed_today} /></strong></div>
        <div className="metric"><span>Toques vencidos</span><strong><MetricValue value={overview.totals.due_now} /></strong></div>
        <div className="metric"><span>Respuestas sin clasificar</span><strong><MetricValue value={overview.totals.replies_unreviewed} /></strong></div>
        <div className="metric"><span>Enviados en total</span><strong><MetricValue value={overview.totals.sent_total} /></strong></div>
        <div className="metric"><span>Secuencias activas</span><strong><MetricValue value={sumEnrollments(overview, ["PENDING", "ACTIVE"])} /></strong></div>
      </section>

      <section className="panel">
        <div className="panel-head portal-panel-head">
          <div>
            <h2>Buzones</h2>
            <p>Cada buzón se conecta con una liga de consentimiento que abre su dueño. El de ENNCO queda listo para el día que Paco la abra.</p>
          </div>
          <span className="badge">{connectedMailboxes.length}/{overview.mailboxes.length} conectados</span>
        </div>
        <div aria-label="Tabla: Buzones" className="table-wrap" role="region" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>Buzón</th><th>Estado</th><th>Hoy</th><th>Rampa</th><th>Respuestas</th><th>Última actividad</th>{canOperate ? <th>Acción</th> : null}
              </tr>
            </thead>
            <tbody>
              {overview.mailboxes.map((mailbox) => {
                const blocked = mailbox.status !== "CONNECTED" || !mailbox.credential_active;
                return (
                  <tr key={mailbox.mailbox_id}>
                    <td data-label="Buzón">
                      <strong>{mailbox.normalized_email}</strong>
                      <br /><span className="fine">{mailbox.is_client_primary ? "Buzón del cliente · techo 20/día" : `${mailbox.domain} · Teckel`}</span>
                    </td>
                    <td data-label="Estado">
                      <span className={`status ${blocked ? "blocked" : ""}`}>{mailboxStatusLabels[mailbox.status] ?? mailbox.status}</span>
                      {mailbox.pending_invitation ? <><br /><span className="fine">Liga vigente hasta {stamp.format(new Date(mailbox.pending_invitation.expires_at))}</span></> : null}
                      {mailbox.credential_connected_at ? <><br /><span className="fine">Conectado {stamp.format(new Date(mailbox.credential_connected_at))}</span></> : null}
                    </td>
                    <td data-label="Hoy">{mailbox.sent_today}/{mailbox.effective_cap}{mailbox.queued > 0 ? <><br /><span className="fine">{mailbox.queued} en cola</span></> : null}</td>
                    <td data-label="Rampa">{mailbox.ramp_mode === "AUTO" ? "Automática" : `Fija ${mailbox.fixed_cap}`} · techo {mailbox.cap_max}{mailbox.first_send_at ? <><br /><span className="fine">Primer envío {stamp.format(new Date(mailbox.first_send_at))}</span></> : null}</td>
                    <td data-label="Respuestas">{mailbox.sync?.last_synced_at ? `Sync ${stamp.format(new Date(mailbox.sync.last_synced_at))}` : "Sin sync"}{mailbox.sync?.last_error_code ? <><br /><span className="status blocked">{mailbox.sync.last_error_code}</span></> : null}</td>
                    <td data-label="Última actividad">{mailbox.last_error ? <span className="status blocked">{mailbox.last_error}</span> : `${mailbox.sent_total} enviados`}</td>
                    {canOperate ? (
                      <td data-label="Acción">
                        {mailbox.status !== "KILLED" && !mailbox.credential_active ? <ConnectMailboxAction email={mailbox.normalized_email} mailboxId={mailbox.mailbox_id} /> : null}
                        {mailbox.credential_active ? <MailboxStateAction canUnkill={screen.canApprove} mailboxId={mailbox.mailbox_id} status={mailbox.status} /> : null}
                        {mailbox.credential_active ? <details><summary className="fine">Tope y rampa</summary><MailboxCapAction capMax={mailbox.cap_max} fixedCap={mailbox.fixed_cap} isClientPrimary={mailbox.is_client_primary} mailboxId={mailbox.mailbox_id} rampMode={mailbox.ramp_mode} /></details> : null}
                        {mailbox.credential_active ? <details><summary className="fine">Desconectar</summary><RevokeMailboxAction mailboxId={mailbox.mailbox_id} /></details> : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head portal-panel-head">
          <div>
            <h2>Campaña</h2>
            <p>Se aprueba una vez; los toques 2 a 8 salen solos. Una respuesta detiene la secuencia de ese contacto.</p>
          </div>
          <span className="badge">{overview.enrollable_contacts} contactos listos para inscribir</span>
        </div>
        {overview.campaigns.length === 0 ? (
          <div className="empty-state">
            <strong>Sin campaña</strong>
            <p>Crea la campaña con el copy aprobado. Queda en borrador hasta que teckel_admin la apruebe.</p>
            {canOperate ? <CreateCampaignAction /> : null}
          </div>
        ) : overview.campaigns.map((campaign) => (
          <div className="compact-operation-form" key={campaign.campaign_id} style={{ marginBottom: 12 }}>
            <div className="inline-operation">
              <strong>{campaign.name}</strong>
              <span className={`status ${campaign.state === "RUNNING" ? "" : "blocked"}`}>{campaign.state === "RUNNING" ? "En marcha" : campaign.state === "PAUSED" ? "En pausa" : campaign.state === "DRAFT" ? "Borrador" : "Terminada"}</span>
              <span className="fine">Copia en respuestas: {campaign.cc_on_reply_email ?? "ninguna"} · manifiesto {campaign.manifest_sha256.slice(0, 12)}</span>
            </div>
            <div className="inline-operation">
              {(["PENDING", "ACTIVE", "REPLIED", "COMPLETED", "PAUSED", "BOUNCED", "UNSUBSCRIBED", "SUPPRESSED"] as const).map((status) => (
                <span className="fine" key={status}>{status.toLowerCase()} <strong>{campaign.enrollments[status] ?? 0}</strong></span>
              ))}
            </div>
            <div className="inline-operation">
              {Object.entries(campaign.by_variant).map(([key, count]) => (
                <span className="fine" key={key}>{DIRECT_LANE_VARIANT_LABELS[key as keyof typeof DIRECT_LANE_VARIANT_LABELS] ?? key}: <strong>{count}</strong></span>
              ))}
            </div>
            {canOperate && campaign.state === "DRAFT" ? (screen.canApprove ? <ApproveCampaignAction campaignId={campaign.campaign_id} /> : <span className="fine">Pendiente de aprobación por teckel_admin.</span>) : null}
            {canOperate ? <CampaignStateAction campaignId={campaign.campaign_id} state={campaign.state} /> : null}
            {canOperate && campaign.state !== "COMPLETED" ? (
              <EnrollContactsAction campaignId={campaign.campaign_id} enrollable={overview.enrollable_contacts} mailboxes={connectedMailboxes.map((mailbox) => ({ id: mailbox.mailbox_id, email: mailbox.normalized_email }))} />
            ) : null}
          </div>
        ))}
        {overview.unverified_contacts > 0 ? <p className="fine">{overview.unverified_contacts} contactos sin verificar no entran a ninguna secuencia (rebotes &lt; 2%). Verificación: <Link href={"/operacion/empresas" as Route}>Empresas</Link>.</p> : null}
        {overview.upcoming.length > 0 ? (
          <p className="fine">Próximos toques: {overview.upcoming.map((item) => `${dayStamp.format(new Date(`${item.day}T12:00:00-06:00`))} · ${item.touches}`).join(" — ")}</p>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-head portal-panel-head">
          <div>
            <h2>Respuestas del carril</h2>
            <p>Clasificar es en <Link href={"/operacion/respuestas" as Route}>Respuestas</Link>. Contestar es aquí: sale en el hilo y copia a quien indique la campaña.</p>
          </div>
          <span className="badge">{overview.pending_replies.length} recientes</span>
        </div>
        {overview.pending_replies.length === 0 ? (
          <div className="empty-state"><strong>Sin respuestas</strong><p>Cuando un prospecto conteste, aparece aquí y llega un aviso por Telegram.</p></div>
        ) : overview.pending_replies.map((reply) => (
          <div className="compact-operation-form" key={reply.provider_event_id} style={{ marginBottom: 12 }}>
            <div className="inline-operation">
              <strong>{reply.contact ?? reply.from_email}</strong>
              <span className="fine">{reply.role_title ?? ""} · {reply.account ?? ""} · {stamp.format(new Date(reply.observed_at))} · {reply.mailbox_email}</span>
              <span className={`status ${reply.classification === "UNREVIEWED" ? "blocked" : ""}`}>{reply.classification === "UNREVIEWED" ? "Sin clasificar" : operationalLabel(reply.classification)}</span>
              {reply.already_answered ? <span className="status">Respondida</span> : null}
            </div>
            <p style={{ whiteSpace: "pre-wrap", margin: 0 }}><strong>{reply.subject}</strong>{"\n"}{reply.body_text || "(sin cuerpo capturado; ábrela en el buzón)"}</p>
            {canOperate && !reply.already_answered ? (
              <ReplyAction cc={runningCampaign?.cc_on_reply_email ?? null} firstName={firstName(reply.contact)} providerEventId={reply.provider_event_id} templates={templates} />
            ) : null}
          </div>
        ))}
      </section>

      <section className="panel">
        <div className="panel-head portal-panel-head">
          <div>
            <h2>Actividad</h2>
            <p>Lo que salió, lo que entró y lo que falló. Último tick: {overview.last_tick ? `${overview.last_tick.outcome} · ${stamp.format(new Date(overview.last_tick.created_at))}` : "sin ticks"}.</p>
          </div>
          <span className="badge">{overview.recent_messages.length} registros</span>
        </div>
        {overview.recent_messages.length === 0 ? (
          <div className="empty-state"><strong>Sin actividad</strong><p>El motor no ha reclamado ningún correo todavía.</p></div>
        ) : (
          <div aria-label="Tabla: Actividad" className="table-wrap" role="region" tabIndex={0}>
            <table>
              <thead><tr><th>Cuándo</th><th>Tipo</th><th>Buzón</th><th>Contraparte</th><th>Asunto</th><th>Estado</th></tr></thead>
              <tbody>
                {overview.recent_messages.map((message) => (
                  <tr key={message.message_id}>
                    <td data-label="Cuándo">{stamp.format(new Date(message.sent_at ?? message.created_at))}</td>
                    <td data-label="Tipo">{message.kind === "INBOUND" ? "Respuesta recibida" : message.kind === "REPLY" ? `Respuesta enviada${message.cc && message.cc.length > 0 ? ` · cc ${message.cc.join(", ")}` : ""}` : `Toque ${message.touch_number ?? "?"}`}</td>
                    <td data-label="Buzón">{message.mailbox_email ?? "—"}</td>
                    <td data-label="Contraparte">{message.contact ?? message.counterparty ?? "—"}<br /><span className="fine">{message.account ?? message.counterparty ?? ""}</span></td>
                    <td data-label="Asunto">{message.subject ?? "—"}</td>
                    <td data-label="Estado">
                      <span className={`status ${/FAILED|BOUNCED|QUARANTINED/u.test(message.status) ? "blocked" : ""}`}>{messageStatusLabels[message.status] ?? operationalLabel(message.status)}</span>
                      {message.last_error && message.last_error !== "SENT" ? <><br /><span className="fine">{message.last_error}</span></> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
