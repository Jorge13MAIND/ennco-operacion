"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type MutationStatus = "idle" | "pending" | "done" | "error";

type PendingCommand = { payloadKey: string; idempotencyKey: string };

function newIdempotencyKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function selectCommand(current: PendingCommand | undefined, payload: unknown): PendingCommand {
  const payloadKey = JSON.stringify(payload);
  return current?.payloadKey === payloadKey ? current : { payloadKey, idempotencyKey: newIdempotencyKey() };
}

async function mutate<T = unknown>(url: string, body: unknown, idempotencyKey: string): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as ({ error?: unknown } & T) | null;
  if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : "MUTATION_REJECTED");
  return payload as T;
}

const errorLabels: Record<string, string> = {
  DIRECT_LANE_NOT_RELEASED: "El carril directo no está liberado en este ambiente (ENNCO_DIRECT_LANE_RELEASED).",
  DIRECT_LANE_OPERATOR_REQUIRED: "Tu cuenta no tiene rol de operador.",
  DIRECT_LANE_APPROVAL_REQUIRES_ADMIN: "Aprobar la campaña exige teckel_admin.",
  DIRECT_LANE_CREDENTIAL_MISSING: "El buzón no tiene credencial activa; primero conéctalo.",
  DIRECT_LANE_NO_CONNECTED_MAILBOX: "No hay ningún buzón conectado.",
  DIRECT_LANE_CLIENT_MAILBOX_CAP_LIMIT: "El buzón del cliente no puede pasar de 20 al día.",
  DIRECT_LANE_CAMPAIGN_DUPLICATE: "Ya existe una campaña con este mismo copy.",
  DIRECT_LANE_RUNTIME_HOLD: "Botón de apagado activo o envío externo no autorizado.",
  DIRECT_LANE_MAILBOX_NOT_CONNECTED: "El buzón no está conectado.",
  DIRECT_LANE_RECIPIENT_NOT_ELIGIBLE: "El destinatario está suprimido o no verificado.",
  DIRECT_LANE_DAILY_CAP_EXCEEDED: "Ese buzón ya alcanzó su tope de hoy.",
  ANNEX_A_NOT_READY: "El Anexo A no está aplicado en producción (Infraestructura → Anexo A).",
  SYNTHETIC_MUTATION_DISABLED: "En modo demo no se guardan cambios.",
};

function Result({ status, error }: { status: MutationStatus; error?: string }) {
  if (status === "idle") return null;
  if (status === "pending") return <span aria-live="polite" className="fine" role="status">Guardando...</span>;
  if (status === "done") return <span aria-live="polite" className="status" role="status">Guardado</span>;
  return <span aria-live="assertive" className="status blocked" role="alert">{(error && errorLabels[error]) ?? error ?? "Rechazado por gate"}</span>;
}

function useMutation() {
  const router = useRouter();
  const [status, setStatus] = useState<MutationStatus>("idle");
  const [error, setError] = useState<string | undefined>(undefined);
  const pending = useRef<PendingCommand | undefined>(undefined);
  async function run<T = unknown>(url: string, body: unknown, options?: { keepDone?: boolean }): Promise<T | null> {
    setStatus("pending");
    setError(undefined);
    const command = selectCommand(pending.current, body);
    pending.current = command;
    try {
      const result = await mutate<T>(url, body, command.idempotencyKey);
      pending.current = undefined;
      setStatus("done");
      router.refresh();
      if (!options?.keepDone) setTimeout(() => setStatus("idle"), 2_500);
      return result;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "MUTATION_REJECTED");
      setStatus("error");
      return null;
    }
  }
  return { status, error, run };
}

export function ConnectMailboxAction({ mailboxId, email }: { mailboxId: string; email: string }) {
  const { status, error, run } = useMutation();
  const [invitationUrl, setInvitationUrl] = useState<string | null>(null);
  async function connect() {
    const result = await run<{ invitation_url: string | null; expires_at: string }>(`/api/v1/operations/correos/mailboxes/${mailboxId}/connect`, {}, { keepDone: true });
    if (result) setInvitationUrl(result.invitation_url);
  }
  return (
    <div className="inline-operation">
      <button className="text-button" disabled={status === "pending"} onClick={() => void connect()} type="button">Generar liga de conexión</button>
      <Result error={error} status={status} />
      {invitationUrl ? (
        <div className="compact-operation-form subform" style={{ minWidth: 0, width: "100%" }}>
          <strong>Liga para {email} (se muestra una sola vez, vence en 7 días):</strong>
          <input aria-label={`Liga de conexión de ${email}`} readOnly value={invitationUrl} onFocus={(event) => event.currentTarget.select()} />
          <span className="fine">Ábrela en un navegador donde puedas iniciar sesión como {email}. Para el buzón del cliente, envíasela a él.</span>
        </div>
      ) : null}
    </div>
  );
}

export function MailboxStateAction({ mailboxId, status: currentStatus, canUnkill }: { mailboxId: string; status: "DISCONNECTED" | "CONNECTED" | "PAUSED" | "KILLED"; canUnkill: boolean }) {
  const { status, error, run } = useMutation();
  const next = currentStatus === "CONNECTED" ? "PAUSED" : currentStatus === "PAUSED" ? "CONNECTED" : null;
  if (currentStatus === "DISCONNECTED") return null;
  if (currentStatus === "KILLED" && !canUnkill) return <span className="status blocked">Apagado (reactivar exige teckel_admin)</span>;
  async function submit(formData: FormData) {
    const target = String(formData.get("target"));
    await run(`/api/v1/operations/correos/mailboxes/${mailboxId}/configure`, { status: target, reason: String(formData.get("reason")) });
  }
  return (
    <form action={(data) => void submit(data)} className="inline-operation">
      <input name="target" type="hidden" value={currentStatus === "KILLED" ? "CONNECTED" : (next ?? "PAUSED")} />
      <label>Motivo<input maxLength={200} minLength={3} name="reason" required /></label>
      <button className="text-button" disabled={status === "pending"} type="submit">
        {currentStatus === "KILLED" ? "Reactivar" : next === "PAUSED" ? "Pausar" : "Reanudar"}
      </button>
      {currentStatus !== "KILLED" ? (
        <button className="text-button" disabled={status === "pending"} onClick={(event) => {
          const form = event.currentTarget.form;
          if (!form) return;
          const reason = String(new FormData(form).get("reason") ?? "");
          if (reason.length < 3) return;
          void run(`/api/v1/operations/correos/mailboxes/${mailboxId}/configure`, { status: "KILLED", reason });
        }} type="button">Apagar</button>
      ) : null}
      <Result error={error} status={status} />
    </form>
  );
}

export function MailboxCapAction({ mailboxId, rampMode, fixedCap, capMax, isClientPrimary }: { mailboxId: string; rampMode: "AUTO" | "FIXED"; fixedCap: number; capMax: number; isClientPrimary: boolean }) {
  const { status, error, run } = useMutation();
  async function submit(formData: FormData) {
    await run(`/api/v1/operations/correos/mailboxes/${mailboxId}/configure`, {
      ramp_mode: String(formData.get("ramp_mode")),
      fixed_cap: Number(formData.get("fixed_cap")),
      cap_max: Number(formData.get("cap_max")),
      reason: String(formData.get("reason")),
    });
  }
  return (
    <form action={(data) => void submit(data)} className="compact-operation-form">
      <label>Rampa
        <select defaultValue={rampMode} name="ramp_mode">
          <option value="AUTO">Automática 5 → 10 → 20 → 40 por semana</option>
          <option value="FIXED">Fija</option>
        </select>
      </label>
      <label>Tope fijo (si la rampa es fija)<input defaultValue={fixedCap} max={100} min={0} name="fixed_cap" type="number" /></label>
      <label>Techo diario<input defaultValue={capMax} max={isClientPrimary ? 20 : 100} min={0} name="cap_max" type="number" /></label>
      <label>Motivo<input maxLength={200} minLength={3} name="reason" required /></label>
      <button className="text-button" disabled={status === "pending"} type="submit">Guardar tope</button>
      <Result error={error} status={status} />
    </form>
  );
}

export function RevokeMailboxAction({ mailboxId }: { mailboxId: string }) {
  const { status, error, run } = useMutation();
  async function submit(formData: FormData) {
    await run(`/api/v1/operations/correos/mailboxes/${mailboxId}/revoke`, { reason: String(formData.get("reason")) });
  }
  return (
    <form action={(data) => void submit(data)} className="inline-operation">
      <label>Motivo<input maxLength={200} minLength={3} name="reason" required /></label>
      <button className="text-button" disabled={status === "pending"} type="submit">Desconectar</button>
      <Result error={error} status={status} />
    </form>
  );
}

export function CreateCampaignAction() {
  const { status, error, run } = useMutation();
  async function submit(formData: FormData) {
    const cc = String(formData.get("cc_on_reply_email") ?? "").trim();
    await run("/api/v1/operations/correos/campaigns", { name: String(formData.get("name")), cc_on_reply_email: cc || null }, { keepDone: true });
  }
  return (
    <form action={(data) => void submit(data)} className="compact-operation-form">
      <label>Nombre de la campaña<input defaultValue="ENNCO · Bajío industrial" maxLength={120} minLength={3} name="name" required /></label>
      <label>Copiar a (cuando un prospecto responda)<input defaultValue="francisco.cuellar@ennco.com.mx" name="cc_on_reply_email" type="email" /></label>
      <span className="fine">Se crea con el copy congelado: 8 toques × 4 variantes (dirección, mantenimiento, seguridad e higiene, compras), días 0 · 3 · 7 · 14 · 28 · 42 · 60 · 75.</span>
      <button className="text-button" disabled={status === "pending" || status === "done"} type="submit">Crear campaña (borrador)</button>
      <Result error={error} status={status} />
    </form>
  );
}

export function ApproveCampaignAction({ campaignId }: { campaignId: string }) {
  const { status, error, run } = useMutation();
  return (
    <div className="inline-operation">
      <button className="text-button" disabled={status === "pending" || status === "done"} onClick={() => void run(`/api/v1/operations/correos/campaigns/${campaignId}/approve`, { confirm: true }, { keepDone: true })} type="button">
        Aprobar y poner en marcha
      </button>
      <Result error={error} status={status} />
    </div>
  );
}

export function CampaignStateAction({ campaignId, state }: { campaignId: string; state: "RUNNING" | "PAUSED" | "COMPLETED" | "DRAFT" }) {
  const { status, error, run } = useMutation();
  if (state === "DRAFT" || state === "COMPLETED") return null;
  const target = state === "RUNNING" ? "PAUSED" : "RUNNING";
  async function submit(formData: FormData) {
    await run(`/api/v1/operations/correos/campaigns/${campaignId}/state`, { state: target, reason: String(formData.get("reason")) });
  }
  return (
    <form action={(data) => void submit(data)} className="inline-operation">
      <label>Motivo<input maxLength={200} minLength={3} name="reason" required /></label>
      <button className="text-button" disabled={status === "pending"} type="submit">{target === "PAUSED" ? "Pausar campaña" : "Reanudar campaña"}</button>
      <Result error={error} status={status} />
    </form>
  );
}

export function EnrollContactsAction({ campaignId, enrollable, mailboxes }: { campaignId: string; enrollable: number; mailboxes: Array<{ id: string; email: string }> }) {
  const { status, error, run } = useMutation();
  const [summary, setSummary] = useState<string | null>(null);
  async function submit(formData: FormData) {
    const mailbox = String(formData.get("mailbox_id") ?? "");
    const result = await run<{ enrolled: number; skipped_suppressed: number; skipped_unverified: number; skipped_enrolled: number; by_variant: Record<string, number> }>(
      `/api/v1/operations/correos/campaigns/${campaignId}/enroll`,
      { mailbox_id: mailbox || null, contact_ids: null, max_count: Number(formData.get("max_count")) },
      { keepDone: true },
    );
    if (result) {
      const variants = Object.entries(result.by_variant ?? {}).map(([key, count]) => `${key.toLowerCase()} ${count}`).join(", ");
      setSummary(`Inscritos ${result.enrolled}${variants ? ` (${variants})` : ""}. Omitidos: ${result.skipped_suppressed} suprimidos, ${result.skipped_unverified} sin verificar, ${result.skipped_enrolled} ya inscritos.`);
    }
  }
  return (
    <form action={(data) => void submit(data)} className="compact-operation-form">
      <strong>Inscribir contactos verificados</strong>
      <span className="fine">{enrollable} contactos verificados, no suprimidos y sin secuencia activa. La variante se asigna por cargo.</span>
      <label>Buzón
        <select defaultValue="" name="mailbox_id">
          <option value="">Repartir entre los buzones conectados</option>
          {mailboxes.map((mailbox) => <option key={mailbox.id} value={mailbox.id}>{mailbox.email}</option>)}
        </select>
      </label>
      <label>Máximo en esta tanda<input defaultValue={Math.min(50, Math.max(1, enrollable || 1))} max={500} min={1} name="max_count" type="number" /></label>
      <button className="text-button" disabled={status === "pending" || enrollable === 0} type="submit">Inscribir</button>
      <Result error={error} status={status} />
      {summary ? <span className="fine">{summary}</span> : null}
    </form>
  );
}

export function ReplyAction({ providerEventId, firstName, templates, cc }: {
  providerEventId: string;
  firstName: string;
  templates: Array<{ intent: string; label: string; body: string }>;
  cc: string | null;
}) {
  const { status, error, run } = useMutation();
  const [body, setBody] = useState("");
  async function submit() {
    await run(`/api/v1/operations/correos/replies/${providerEventId}/send`, { body_text: body }, { keepDone: true });
  }
  return (
    <div className="compact-operation-form">
      <label>Plantilla del playbook
        <select defaultValue="" onChange={(event) => {
          const template = templates.find((item) => item.intent === event.currentTarget.value);
          if (template) setBody(template.body.replaceAll("{{first_name}}", firstName).replaceAll("{{referido}}", "[nombre del referido]"));
        }}>
          <option value="">Elegir…</option>
          {templates.map((template) => <option key={template.intent} value={template.intent}>{template.label}</option>)}
        </select>
      </label>
      <label>Respuesta (texto plano)
        <textarea maxLength={6000} minLength={10} onChange={(event) => setBody(event.currentTarget.value)} required rows={6} value={body} />
      </label>
      <span className="fine">{cc ? `Sale en el mismo hilo con copia a ${cc}.` : "Sale en el mismo hilo, sin copia."} Sin garantías, descuentos, precio final ni fecha comprometida.</span>
      <button className="text-button" disabled={status === "pending" || status === "done" || body.trim().length < 10} onClick={() => void submit()} type="button">Encolar respuesta</button>
      <Result error={error} status={status} />
    </div>
  );
}
