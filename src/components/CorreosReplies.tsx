import type { Route } from "next";
import Link from "next/link";

import { ReplyAction } from "@/components/CorreosActions";
import type { DirectLaneOverview } from "@/lib/correos/overview";
import { operationalLabel } from "@/lib/operations/presentation";

/**
 * Respuestas del carril en tarjetas: quién escribió, sobre qué campaña y
 * buzón, el asunto, un extracto del correo y las dos acciones (clasificar en
 * Respuestas, contestar aquí). El formulario de respuesta va plegado: se abre
 * sólo para la tarjeta que se va a contestar.
 */

type PendingReply = DirectLaneOverview["pending_replies"][number];
type Template = { intent: string; label: string; body: string };

const stamp = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" });
const EXCERPT_LENGTH = 220;

function firstName(fullName: string | null | undefined): string {
  return (fullName ?? "").trim().split(/\s+/u)[0] || "hola";
}

function excerpt(body: string): string {
  const flat = body.replace(/\s+/gu, " ").trim();
  if (flat.length <= EXCERPT_LENGTH) return flat;
  const cut = flat.slice(0, EXCERPT_LENGTH);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 160))}…`;
}

function ReplyCard({ reply, templates, cc, canOperate }: { reply: PendingReply; templates: Template[]; cc: string | null; canOperate: boolean }) {
  const unreviewed = reply.classification === "UNREVIEWED";
  const body = (reply.body_text ?? "").trim();
  const long = body.length > EXCERPT_LENGTH;
  const who = reply.contact ?? reply.from_email ?? "Sin remitente";
  const where = [reply.role_title, reply.account].filter(Boolean).join(" · ");
  return (
    <article aria-label={`Respuesta de ${who}`} className={`cr-reply${reply.already_answered ? " is-answered" : ""}`}>
      <header className="cr-reply-head">
        <div>
          <strong>{who}</strong>
          {where ? <span>{where}</span> : null}
        </div>
        <span className={`status ${unreviewed ? "blocked" : "ready"}`}>{unreviewed ? "Sin clasificar" : operationalLabel(reply.classification)}</span>
      </header>
      <p className="cr-reply-meta">
        <time dateTime={reply.observed_at}>{stamp.format(new Date(reply.observed_at))}</time>
        {reply.mailbox_email ? <> · llegó a {reply.mailbox_email}</> : null}
        {reply.contact && reply.from_email ? <> · desde {reply.from_email}</> : null}
      </p>
      <p className="cr-reply-subject">{reply.subject?.trim() || "(sin asunto)"}</p>
      {body ? (
        <>
          {long ? (
            <details className="cr-reply-body">
              <summary>Ver el correo completo</summary>
              <p className="cr-reply-text">{body}</p>
            </details>
          ) : null}
          <p className="cr-reply-text cr-reply-excerpt">{long ? excerpt(body) : body}</p>
        </>
      ) : (
        <p className="cr-reply-empty">Sin cuerpo capturado; ábrela en el buzón.</p>
      )}
      <footer className="cr-reply-actions">
        {reply.already_answered ? <span className="status ready">Respondida</span> : null}
        <Link className="cr-reply-link" href={"/operacion/respuestas" as Route}>Clasificar en Respuestas</Link>
        {canOperate && !reply.already_answered ? (
          <details className="cr-reply-compose">
            <summary>Responder</summary>
            <ReplyAction cc={cc} firstName={firstName(reply.contact)} providerEventId={reply.provider_event_id} templates={templates} />
          </details>
        ) : null}
      </footer>
    </article>
  );
}

export function CorreosReplies({ replies, templates, cc, canOperate }: { replies: PendingReply[]; templates: Template[]; cc: string | null; canOperate: boolean }) {
  if (replies.length === 0) {
    return <div className="empty-state"><strong>Sin respuestas</strong><p>Cuando un prospecto conteste, aparece aquí y llega un aviso por Telegram.</p></div>;
  }
  return (
    <div className="cr-replies">
      {replies.map((reply) => <ReplyCard canOperate={canOperate} cc={cc} key={reply.provider_event_id} reply={reply} templates={templates} />)}
    </div>
  );
}
