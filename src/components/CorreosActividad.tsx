import type { Route } from "next";
import Link from "next/link";

import { ActivitySelect } from "@/components/CorreosActividadClient";
import {
  ACTIVITY_KINDS, ACTIVITY_LIMIT, ACTIVITY_RANGES, ACTIVITY_STATUSES, type ActivityCount, type ActivityRange, type DirectLaneActivityPage, type DirectLaneActivityRow,
} from "@/lib/correos/activity-page";
import { formatInteger } from "@/lib/correos/stats";
import { operationalLabel } from "@/lib/operations/presentation";

export const ACTIVITY_PATH = "/operacion/correos/actividad";

const stamp = new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: "America/Mexico_City" });
const dayLabel = new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short", timeZone: "America/Mexico_City" });

const rangeLabel: Record<ActivityRange, string> = { hoy: "Hoy", semana: "Esta semana", "30": "30 días", todo: "Todo" };

export const activityStatusLabels: Record<string, string> = {
  DRY_RUN: "Sombra",
  QUEUED: "En cola",
  SENDING: "Enviando",
  SENT: "Enviado",
  DELIVERED: "Entregado",
  FAILED: "Falló",
  BOUNCED: "Rebotó",
  QUARANTINED: "Cuarentena",
};

export function activityKindLabel(key: string): string {
  if (key === "INBOUND") return "Respuesta recibida";
  if (key === "REPLY") return "Respuesta enviada";
  if (key === "TOUCH") return "Toques (todos)";
  if (key.startsWith("TOUCH_")) return `Toque ${key.slice(6)}`;
  return key;
}

function rowKindLabel(row: DirectLaneActivityRow): string {
  if (row.kind === "INBOUND") return "Respuesta recibida";
  if (row.kind === "REPLY") return `Respuesta enviada${row.cc && row.cc.length > 0 ? ` · cc ${row.cc.join(", ")}` : ""}`;
  return `Toque ${row.touch_number ?? "?"}`;
}

function openLabel(row: DirectLaneActivityRow): string {
  if (row.direction !== "OUTBOUND" || !row.open_tracked) return "—";
  if (!row.opened_at) return "sin abrir";
  const times = row.open_count ?? 1;
  return times > 1 ? `${times} veces` : "abierto";
}

function CountList({ title, items, labelFor }: { title: string; items: ActivityCount[]; labelFor: (key: string) => string }) {
  if (items.length === 0) return null;
  return (
    <div className="cr-activity-count">
      <h3>{title}</h3>
      <ul>
        {items.map((item) => <li key={item.key}><span>{labelFor(item.key)}</span><strong>{formatInteger(item.count)}</strong></li>)}
      </ul>
    </div>
  );
}

export function CorreosActividad({ page }: { page: DirectLaneActivityPage }) {
  const { query, activity } = page;
  const mailboxOptions = [{ id: "todos", label: "Todos los buzones" }, ...activity.options.mailboxes.map((mailbox) => ({ id: mailbox.id, label: mailbox.email }))];
  const campaignOptions = [{ id: "todas", label: "Todas las campañas" }, ...activity.options.campaigns.map((campaign) => ({ id: campaign.id, label: campaign.name }))];
  const kindOptions = ACTIVITY_KINDS.map((kind) => ({ id: kind, label: kind === "todos" ? "Todos los tipos" : activityKindLabel(kind) }));
  const statusOptions = ACTIVITY_STATUSES.map((status) => ({ id: status, label: status === "todos" ? "Todos los estados" : activityStatusLabels[status] ?? status }));
  const rangeHref = (range: ActivityRange) => {
    const params = new URLSearchParams();
    params.set("rango", range);
    if (query.buzon) params.set("buzon", query.buzon);
    if (query.tipo !== "todos") params.set("tipo", query.tipo);
    if (query.estado !== "todos") params.set("estado", query.estado);
    if (query.campana) params.set("campana", query.campana);
    if (query.q) params.set("q", query.q);
    return `${ACTIVITY_PATH}?${params.toString()}` as Route;
  };
  const truncated = activity.total > activity.rows.length;

  return (
    <div className="cr-stats cr-activity">
      <form action={ACTIVITY_PATH} className="cr-stats-filters" method="get">
        <input name="rango" type="hidden" value={query.rango} />
        <ActivitySelect label="Buzón" name="buzon" options={mailboxOptions} value={query.buzon ?? "todos"} />
        <ActivitySelect label="Tipo" name="tipo" options={kindOptions} value={query.tipo} />
        <ActivitySelect label="Estado" name="estado" options={statusOptions} value={query.estado} />
        <ActivitySelect label="Campaña" name="campana" options={campaignOptions} value={query.campana ?? "todas"} />
        <label className="cr-stats-select cr-activity-search">
          <span>Buscar</span>
          <input defaultValue={query.q} maxLength={80} name="q" placeholder="empresa, contacto, correo o asunto" type="search" />
        </label>
        <button className="button secondary" type="submit">Aplicar</button>
        <nav aria-label="Periodo" className="cr-segmented">
          {ACTIVITY_RANGES.map((range) => (
            <Link aria-current={range === query.rango ? "page" : undefined} href={rangeHref(range)} key={range} prefetch={false}>{rangeLabel[range]}</Link>
          ))}
        </nav>
        <p className="cr-stats-period">
          {formatInteger(activity.total)} registros{truncated ? ` · se muestran los ${formatInteger(activity.rows.length)} más recientes` : ""} · {stamp.format(new Date(page.period.since))} a {stamp.format(new Date(page.period.until))}
        </p>
      </form>

      <section aria-label="Resumen del periodo" className="cr-activity-summary">
        <CountList items={activity.by.kind} labelFor={activityKindLabel} title="Por tipo" />
        <CountList items={activity.by.status} labelFor={(key) => activityStatusLabels[key] ?? operationalLabel(key)} title="Por estado" />
        <CountList items={activity.by.mailbox} labelFor={(key) => (key === "?" ? "Sin buzón" : key)} title="Por buzón" />
        <CountList items={activity.by.day} labelFor={(key) => dayLabel.format(new Date(`${key}T12:00:00-06:00`))} title="Por día" />
      </section>

      {activity.rows.length === 0 ? (
        <div className="empty-state"><strong>Sin actividad con estos filtros</strong><p>Amplía el periodo o quita un filtro. El motor solo registra lo que reclamó, envió o recibió.</p></div>
      ) : (
        <div aria-label="Tabla: Actividad del carril" className="table-wrap cr-activity-wrap" role="region" tabIndex={0}>
          <table className="cr-stats-table cr-activity-table">
            <thead>
              <tr>
                <th scope="col">Cuándo</th>
                <th scope="col">Tipo</th>
                <th scope="col">Buzón</th>
                <th scope="col">Contraparte</th>
                <th scope="col">Empresa</th>
                <th scope="col">Asunto</th>
                <th className="num" scope="col">Apertura</th>
                <th className="num" scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {activity.rows.map((row) => (
                <tr key={row.message_id}>
                  <td data-label="Cuándo">{stamp.format(new Date(row.sent_at ?? row.created_at))}</td>
                  <td data-label="Tipo">{rowKindLabel(row)}{row.campaign ? <><br /><span className="fine">{row.campaign}</span></> : null}</td>
                  <td data-label="Buzón">{row.mailbox_email ?? "—"}</td>
                  <td data-label="Contraparte">{row.contact ?? row.counterparty ?? "—"}{row.role_title ? <><br /><span className="fine">{row.role_title}</span></> : null}</td>
                  <td data-label="Empresa">{row.account ?? "—"}{row.account_state ? <><br /><span className="fine">{row.account_state}</span></> : null}</td>
                  <td data-label="Asunto">{row.subject ?? "—"}</td>
                  <td className="num" data-label="Apertura">{openLabel(row)}</td>
                  <td className="num" data-label="Estado">
                    <span className={`status ${/FAILED|BOUNCED|QUARANTINED/u.test(row.status) ? "blocked" : ""}`}>{activityStatusLabels[row.status] ?? operationalLabel(row.status)}</span>
                    {row.last_error && row.last_error !== "SENT" ? <><br /><span className="fine">{row.last_error}</span></> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {truncated ? <p className="fine">La lectura trae hasta {formatInteger(ACTIVITY_LIMIT)} registros por página. Acota el periodo o usa un filtro para ver el resto.</p> : null}
    </div>
  );
}
