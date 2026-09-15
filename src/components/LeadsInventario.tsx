import type { Route } from "next";
import Link from "next/link";

import { ActivitySelect } from "@/components/CorreosActividadClient";
import { MetricValue } from "@/components/MetricValue";
import { formatInteger, pct } from "@/lib/correos/stats";
import {
  ALL, LEAD_GROUP_LABELS, LEAD_LIST_LABELS, LEAD_PAGE_SIZE, LEAD_STAGE_LABELS, LEAD_STAGES, LEAD_STATE_LABELS, LEAD_VIEWS,
  share, stageLabel, type LeadCompanyRow, type LeadCount, type LeadInventoryPage, type LeadQuery, type LeadRow, type LeadStats, type LeadView,
} from "@/lib/leads/inventory-page";

export const LEADS_PATH = "/operacion/leads";

const stamp = new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: "America/Mexico_City" });
const dayStamp = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "America/Mexico_City" });

const viewLabel: Record<LeadView, string> = { contactos: "Por contacto", empresas: "Por empresa" };

function listLabel(key: string): string { return LEAD_LIST_LABELS[key] ?? key; }
function stateLabel(key: string): string { return LEAD_STATE_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1); }
function withCount(items: LeadCount[], labelFor: (key: string) => string): Array<{ id: string; label: string }> {
  return items.map((item) => ({ id: item.key, label: `${labelFor(item.key)} (${formatInteger(item.count)})` }));
}

export function leadsHref(query: LeadQuery, overrides: Partial<Record<keyof LeadQuery, string | number | null>> = {}): Route {
  const merged: Record<string, string | number | null> = {
    vista: query.vista, lista: query.lista, ola: query.ola, grupo: query.grupo, estado: query.estado, tier: query.tier,
    sector: query.sector, campana: query.campana, etapa: query.etapa === "todos" ? null : query.etapa, q: query.q || null, pagina: query.pagina > 1 ? query.pagina : null,
    ...overrides,
  };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value === null || value === undefined || value === "" || (key === "vista" && value === "contactos")) continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return (qs ? `${LEADS_PATH}?${qs}` : LEADS_PATH) as Route;
}

function Kpi({ label, value, total, tone }: { label: string; value: number; total: number; tone?: "good" | "bad" }) {
  return (
    <div className="metric" data-tone={tone}>
      <span className="cr-kpi-label">{label}</span>
      <strong><MetricValue value={value} /><em>{pct(share(value, total))}</em></strong>
    </div>
  );
}

function StatsStrip({ stats }: { stats: LeadStats }) {
  const total = stats.total;
  const pending = stats.sin_enviar + stats.en_cola;
  const touches = ([1, 2, 3, 4, 5, 6, 7, 8] as const).map((n) => ({ n, value: stats[`toque_${n}` as keyof LeadStats] as number })).filter((t) => t.n <= 3 || t.value > 0);
  return (
    <section aria-label="Avance sobre el filtro" className="cr-leads-kpis">
      <div className="metric metric-total"><span className="cr-kpi-label">Contactos en el filtro</span><strong><MetricValue value={total} /></strong><span className="cr-kpi-note">{formatInteger(stats.empresas)} empresas</span></div>
      <Kpi label="Faltan por enviar" total={total} value={pending} />
      <Kpi label="Ya se les envió" total={total} value={stats.enviado} />
      {touches.map((t) => <Kpi key={t.n} label={`Recibieron toque ${t.n}`} total={total} value={t.value} />)}
      <Kpi label="Abrieron" total={total} value={stats.abrieron} />
      <Kpi label="Respondieron" tone="good" total={total} value={stats.respondio} />
      <Kpi label="Positivas" tone="good" total={total} value={stats.positivas} />
      <Kpi label="Rebotaron" tone="bad" total={total} value={stats.reboto} />
      {stats.baja > 0 ? <Kpi label="Pidieron baja" tone="bad" total={total} value={stats.baja} /> : null}
    </section>
  );
}

function StageBadge({ row }: { row: LeadRow }) {
  const bad = row.stage === "REBOTO" || row.stage === "BAJA";
  const good = row.stage === "RESPONDIO";
  return <span className={`status ${bad ? "blocked" : ""} ${good ? "cr-leads-good" : ""}`}>{stageLabel(row)}</span>;
}

function ContactRows({ rows, query }: { rows: LeadRow[]; query: LeadQuery }) {
  return (
    <table className="cr-stats-table cr-leads-table">
      <thead>
        <tr>
          <th scope="col">Contacto</th>
          <th scope="col">Empresa</th>
          <th scope="col">Lista</th>
          <th scope="col">Etapa</th>
          <th scope="col">Buzón</th>
          <th className="num" scope="col">Último envío</th>
          <th className="num" scope="col">Siguiente</th>
          <th className="num" scope="col">Apertura</th>
          <th className="num" scope="col">Respuesta</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.contact_id}>
            <td data-label="Contacto"><strong>{row.full_name ?? row.email ?? "—"}</strong><br /><span className="fine">{row.role_title ?? "sin cargo"}{row.email ? ` · ${row.email}` : ""}</span></td>
            <td data-label="Empresa"><Link href={leadsHref(query, { q: row.account ?? "", pagina: null })} prefetch={false}>{row.account ?? "—"}</Link><br /><span className="fine">{[row.account_state, row.sector, row.tier ? `tier ${row.tier}` : null].filter(Boolean).join(" · ")}</span></td>
            <td data-label="Lista">{listLabel(row.source_list ?? "SIN_LISTA")}<br /><span className="fine">{[row.source_wave ? `ola ${row.source_wave}` : null, row.source_group ? LEAD_GROUP_LABELS[row.source_group] ?? row.source_group : null].filter(Boolean).join(" · ") || "—"}</span></td>
            <td data-label="Etapa"><StageBadge row={row} />{row.campaign ? <><br /><span className="fine">{row.campaign}</span></> : null}</td>
            <td data-label="Buzón">{row.mailbox ?? "—"}</td>
            <td className="num" data-label="Último envío">{row.last_sent_at ? <>{stamp.format(new Date(row.last_sent_at))}<br /><span className="fine">{row.sends} correo{row.sends === 1 ? "" : "s"}</span></> : "—"}</td>
            <td className="num" data-label="Siguiente">{row.next_touch_at && row.next_touch_number && !["RESPONDIO", "REBOTO", "BAJA"].includes(row.stage) ? <>toque {row.next_touch_number}<br /><span className="fine">{dayStamp.format(new Date(row.next_touch_at))}</span></> : "—"}</td>
            <td className="num" data-label="Apertura">{row.last_touch ? (row.opened ? `${row.opens > 1 ? `${row.opens} veces` : "sí"}` : "no") : "—"}</td>
            <td className="num" data-label="Respuesta">{row.replied_at ? <>{dayStamp.format(new Date(row.replied_at))}<br /><span className="fine">{row.positive ? "positiva" : row.reply_classification === "UNREVIEWED" ? "sin clasificar" : (row.reply_classification ?? "").toLowerCase() || "recibida"} · <Link href={"/operacion/respuestas" as Route}>ver</Link></span></> : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CompanyRows({ rows, query }: { rows: LeadCompanyRow[]; query: LeadQuery }) {
  return (
    <table className="cr-stats-table cr-leads-table">
      <thead>
        <tr>
          <th scope="col">Empresa</th>
          <th scope="col">Listas</th>
          <th className="num" scope="col">Contactos</th>
          <th className="num" scope="col">Con envío</th>
          <th className="num" scope="col">Toque máx.</th>
          <th className="num" scope="col">Abrieron</th>
          <th className="num" scope="col">Respondieron</th>
          <th className="num" scope="col">Rebotes</th>
          <th className="num" scope="col">Último envío</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.account_id}>
            <td data-label="Empresa"><Link href={leadsHref(query, { vista: "contactos", q: row.account ?? "", pagina: null })} prefetch={false}><strong>{row.account ?? "—"}</strong></Link><br /><span className="fine">{[row.account_state, row.sector, row.tier ? `tier ${row.tier}` : null].filter(Boolean).join(" · ")}</span></td>
            <td data-label="Listas">{(row.lists ?? "SIN_LISTA").split(", ").map(listLabel).join(", ")}</td>
            <td className="num" data-label="Contactos">{row.contacts}</td>
            <td className="num" data-label="Con envío">{row.enviados}</td>
            <td className="num" data-label="Toque máx.">{row.max_touch ?? "—"}</td>
            <td className="num" data-label="Abrieron">{row.abrieron}</td>
            <td className="num" data-label="Respondieron">{row.respondieron}</td>
            <td className="num" data-label="Rebotes">{row.rebotes}</td>
            <td className="num" data-label="Último envío">{row.last_sent_at ? stamp.format(new Date(row.last_sent_at)) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LeadsInventario({ page }: { page: LeadInventoryPage }) {
  const { query, inventory } = page;
  const o = inventory.options;
  const shown = query.vista === "empresas" ? inventory.companies.length : inventory.rows.length;
  const total = query.vista === "empresas" ? inventory.total_companies : inventory.total;
  const pages = Math.max(1, Math.ceil(total / LEAD_PAGE_SIZE));
  const activeFilters = [query.lista, query.ola, query.grupo, query.estado, query.tier, query.sector, query.campana, query.q].filter((v) => v !== null && v !== "").length + (query.etapa !== "todos" ? 1 : 0);

  return (
    <div className="cr-stats cr-leads">
      <StatsStrip stats={inventory.stats} />

      <form action={LEADS_PATH} className="cr-stats-filters" method="get">
        <input name="vista" type="hidden" value={query.vista} />
        <ActivitySelect label="Lista" name="lista" options={[{ id: ALL, label: "Todas las listas" }, ...withCount(o.lists, listLabel)]} value={query.lista ?? ALL} />
        <ActivitySelect label="Etapa" name="etapa" options={LEAD_STAGES.map((stage) => ({ id: stage, label: LEAD_STAGE_LABELS[stage] ?? stage }))} value={query.etapa} />
        <ActivitySelect label="Estado" name="estado" options={[{ id: ALL, label: "Todos los estados" }, ...withCount(o.states, stateLabel)]} value={query.estado ?? ALL} />
        <ActivitySelect label="Tier" name="tier" options={[{ id: ALL, label: "Todos" }, ...withCount(o.tiers, (k) => `Tier ${k}`)]} value={query.tier?.toString() ?? ALL} />
        <ActivitySelect label="Grupo A/B" name="grupo" options={[{ id: ALL, label: "Ambos grupos" }, ...withCount(o.groups, (k) => LEAD_GROUP_LABELS[k] ?? k)]} value={query.grupo ?? ALL} />
        {o.waves.length > 0 ? <ActivitySelect label="Ola" name="ola" options={[{ id: ALL, label: "Todas" }, ...withCount(o.waves, (k) => `Ola ${k}`)]} value={query.ola ?? ALL} /> : null}
        <ActivitySelect label="Sector" name="sector" options={[{ id: ALL, label: "Todos los sectores" }, ...withCount(o.sectors, (k) => k)]} value={query.sector ?? ALL} />
        {o.campaigns.length > 1 ? <ActivitySelect label="Campaña" name="campana" options={[{ id: ALL, label: "Todas" }, ...o.campaigns.map((c) => ({ id: c.id, label: c.name }))]} value={query.campana ?? ALL} /> : null}
        <label className="cr-stats-select cr-activity-search">
          <span>Empresa o contacto</span>
          <input defaultValue={query.q} maxLength={80} name="q" placeholder="nombre de la empresa, persona, correo o cargo" type="search" />
        </label>
        <button className="button secondary" type="submit">Aplicar</button>
        {activeFilters > 0 ? <Link className="button secondary" href={leadsHref(query, { lista: null, ola: null, grupo: null, estado: null, tier: null, sector: null, campana: null, etapa: null, q: null, pagina: null })} prefetch={false}>Quitar filtros</Link> : null}
        <nav aria-label="Vista" className="cr-segmented">
          {LEAD_VIEWS.map((view) => (
            <Link aria-current={view === query.vista ? "page" : undefined} href={leadsHref(query, { vista: view, pagina: null })} key={view} prefetch={false}>{viewLabel[view]}</Link>
          ))}
        </nav>
        <p className="cr-stats-period">{formatInteger(total)} {query.vista === "empresas" ? "empresas" : "contactos"}{pages > 1 ? ` · página ${query.pagina} de ${pages}` : ""}</p>
      </form>

      {shown === 0 ? (
        <div className="empty-state"><strong>Nada con estos filtros</strong><p>Quita un filtro o cambia la etapa. Los contactos sin lista son las pruebas internas.</p></div>
      ) : (
        <div aria-label={`Tabla: Leads ${viewLabel[query.vista].toLowerCase()}`} className="table-wrap cr-activity-wrap" role="region" tabIndex={0}>
          {query.vista === "empresas" ? <CompanyRows query={query} rows={inventory.companies} /> : <ContactRows query={query} rows={inventory.rows} />}
        </div>
      )}
      {pages > 1 ? (
        <nav aria-label="Páginas" className="cr-leads-pages">
          {query.pagina > 1 ? <Link className="button secondary" href={leadsHref(query, { pagina: query.pagina - 1 })} prefetch={false}>Anterior</Link> : null}
          <span className="fine">Mostrando {formatInteger(shown)} de {formatInteger(total)}</span>
          {query.pagina < pages ? <Link className="button secondary" href={leadsHref(query, { pagina: query.pagina + 1 })} prefetch={false}>Siguiente</Link> : null}
        </nav>
      ) : null}
    </div>
  );
}
