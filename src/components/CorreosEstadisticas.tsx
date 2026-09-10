import type { Route } from "next";
import Link from "next/link";

import { BreakdownTabs, CampaignSelect, CopyTextButton, type BreakdownTab } from "@/components/CorreosEstadisticasClient";
import { MetricValue } from "@/components/MetricValue";
import {
  deliveryFailRate, formatInteger, formatSignedInteger, funnelStages, pct, periodDelta, rate, weeklyVerdict,
  type Delta, type DirectLaneStats, type DirectLaneStatsRow,
} from "@/lib/correos/stats";
import { ALL_CAMPAIGNS, STATS_RANGES, type DirectLaneStatsPage, type StatsRange } from "@/lib/correos/stats-page";

/**
 * Estadísticas del carril directo. Una campaña, un periodo, y de arriba abajo:
 * el veredicto del viernes (lo primero que se decide), los seis números que lo
 * sostienen, el embudo y la tendencia, los cortes, los reportes y un resumen
 * en lenguaje llano para mandarle a ENNCO. Las barras son SVG con atributos:
 * la CSP del panel no admite estilos en línea.
 */

const STATS_PATH = "/operacion/correos/estadisticas";
const rangeLabel: Record<StatsRange, string> = { semana: "Esta semana", "30": "Últimos 30 días", campana: "Toda la campaña" };
const variantLabel: Record<string, string> = { DIRECCION: "Dirección general", MANTENIMIENTO: "Mantenimiento y planta", SEGURIDAD: "Seguridad e higiene", COMPRAS: "Compras" };
const campaignStateLabel: Record<string, string> = { RUNNING: "En marcha", PAUSED: "En pausa", DRAFT: "Borrador", COMPLETED: "Terminada" };
const dayMonth = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "America/Mexico_City" });
const longDate = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Mexico_City" });
const stamp = new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: "America/Mexico_City" });

function cdmxDate(ymd: string): Date {
  return new Date(`${ymd}T12:00:00-06:00`);
}

function periodLabel(page: DirectLaneStatsPage): string {
  const since = new Date(page.period.since);
  const until = new Date(page.period.until);
  return `${dayMonth.format(since)} al ${longDate.format(until)}`;
}

function DeltaNote({ delta, previousLabel, higherIsBetter = true }: { delta: Delta | null; previousLabel: string; higherIsBetter?: boolean }) {
  if (!delta) return <span className="cr-kpi-note">Sin periodo anterior</span>;
  const tone = delta.direction === "flat" ? "flat" : (delta.direction === "up") === higherIsBetter ? "good" : "bad";
  return (
    <span className="cr-kpi-note" data-tone={tone}>
      <span aria-hidden="true">{delta.direction === "up" ? "▲" : delta.direction === "down" ? "▼" : "•"}</span>{" "}
      {delta.direction === "flat" ? "Igual que" : `${formatSignedInteger(delta.diff)} vs.`} {previousLabel}
    </span>
  );
}

function FunnelBar({ value, max, label }: { value: number; max: number; label: string }) {
  const width = max > 0 ? Math.round((value / max) * 1000) / 10 : 0;
  return (
    <svg aria-label={`${label}: ${formatInteger(value)}`} className="cr-funnel-bar" height="20" role="img" width="100%">
      <title>{`${label}: ${formatInteger(value)}`}</title>
      <rect className="cr-funnel-track" height="20" rx="4" width="100%" />
      {width > 0 ? <rect className="cr-funnel-fill" height="20" rx="4" width={`${Math.max(width, 1.2)}%`} /> : null}
      {width > 0 ? <rect className="cr-funnel-fill" height="20" width="4" /> : null}
    </svg>
  );
}

function Funnel({ stats, title, subtitle }: { stats: DirectLaneStats; title: string; subtitle: string }) {
  const stages = funnelStages(stats.funnel);
  const max = Math.max(...stages.map((stage) => stage.value), 1);
  const f = stats.funnel;
  return (
    <section aria-labelledby="cr-funnel-title" className="panel cr-stats-card">
      <div className="cr-stats-card-head"><h2 id="cr-funnel-title">{title}</h2><p>{subtitle}</p></div>
      <ol className="cr-funnel">
        {stages.map((stage) => (
          <li className="cr-funnel-row" key={stage.key}>
            <span className="cr-funnel-label">{stage.label}</span>
            <FunnelBar label={stage.label} max={max} value={stage.value} />
            <strong className="cr-funnel-value">{formatInteger(stage.value)}</strong>
            <span className="cr-funnel-conv">{stage.ofPrevious === null ? "" : `${pct(stage.ofPrevious)} de la etapa anterior`}</span>
          </li>
        ))}
      </ol>
      <dl className="cr-funnel-side">
        <div><dt>Fallos y rebotes</dt><dd>{formatInteger(f.failed)} <small>{pct(deliveryFailRate(f))} de los intentos</small></dd></div>
        <div><dt>Bajas</dt><dd>{formatInteger(f.unsubscribed)}</dd></div>
        <div><dt>Apertura (direccional)</dt><dd>{f.tracked > 0 ? <>{pct(rate(f.opened, f.tracked))} <small>{f.opened} de {f.tracked} con pixel</small></> : <small>sin correos con pixel aún</small>}</dd></div>
      </dl>
    </section>
  );
}

function Trend({ rows, weekStart }: { rows: DirectLaneStatsRow[]; weekStart: string }) {
  const weeks = [...rows].sort((a, b) => a.key.localeCompare(b.key)).slice(-12);
  const max = Math.max(...weeks.map((week) => week.reached), 1);
  const peak = weeks.reduce<DirectLaneStatsRow | null>((best, week) => (best === null || week.reached > best.reached ? week : best), null);
  return (
    <section aria-labelledby="cr-trend-title" className="panel cr-stats-card">
      <div className="cr-stats-card-head"><h2 id="cr-trend-title">Contactos alcanzados por semana</h2><p>Desde el inicio de la campaña. La semana en curso se pinta más clara porque todavía no termina.</p></div>
      {weeks.length === 0 ? <p className="cr-stats-empty">Todavía no hay semanas con envíos.</p> : (
        <>
          <div className="cr-trend" role="img" aria-label={`Contactos alcanzados por semana, máximo ${formatInteger(max)}`}>
            <div className="cr-trend-axis" aria-hidden="true"><span>{formatInteger(max)}</span><span>{formatInteger(Math.round(max / 2))}</span><span>0</span></div>
            <ol className="cr-trend-plot">
              {weeks.map((week) => {
                // La grafica mide 136 de alto: 120 de trazo y 16 de aire arriba
                // para que la cifra de la barra mas alta no se corte.
                const height = Math.round((week.reached / max) * 120);
                const top = 136 - height;
                const current = week.key === weekStart;
                const labelled = week === peak || current;
                return (
                  <li className={`cr-trend-col${current ? " is-current" : ""}`} key={week.key}>
                    <svg aria-hidden="true" height="136" viewBox="0 0 24 136" width="24">
                      <title>{`Semana del ${dayMonth.format(cdmxDate(week.key))}: ${week.reached} alcanzados, ${week.sends} correos, ${week.replied} respuestas, ${week.failed} fallos`}</title>
                      {height > 0 ? <rect className="cr-trend-fill" height={height} rx="4" width="24" x="0" y={top} /> : null}
                      {height > 4 ? <rect className="cr-trend-fill" height="4" width="24" x="0" y="132" /> : null}
                      {labelled ? <text className="cr-trend-text" textAnchor="middle" x="12" y={Math.max(top - 5, 10)}>{formatInteger(week.reached)}</text> : null}
                    </svg>
                    <span className="cr-trend-week">{dayMonth.format(cdmxDate(week.key))}{current ? <small>en curso</small> : null}</span>
                  </li>
                );
              })}
            </ol>
          </div>
          <details className="cr-stats-details">
            <summary>Ver tabla</summary>
            <div className="table-wrap">
              <table className="cr-stats-table">
                <thead><tr><th scope="col">Semana</th><th className="num" scope="col">Alcanzados</th><th className="num" scope="col">Enviados</th><th className="num" scope="col">Respuestas</th><th className="num" scope="col">Fallos</th></tr></thead>
                <tbody>{weeks.map((week) => (
                  <tr key={week.key}><th scope="row">{dayMonth.format(cdmxDate(week.key))}</th><td className="num" data-label="Alcanzados">{week.reached}</td><td className="num" data-label="Enviados">{week.sends}</td><td className="num" data-label="Respuestas">{week.replied}</td><td className="num" data-label="Fallos">{week.failed}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

function summaryText(page: DirectLaneStatsPage): string {
  const f = page.current.funnel;
  const name = page.selected?.name ?? "Todas las campañas";
  const failRate = deliveryFailRate(f);
  const lines = [
    `Resumen ENNCO · ${name}`,
    `Periodo: ${periodLabel(page)} (${rangeLabel[page.range].toLowerCase()})`,
    `Contactos nuevos alcanzados: ${formatInteger(f.reached)}`,
    `Correos enviados: ${formatInteger(f.sends)}${f.failed > 0 ? ` (${f.failed} fallos o rebotes, ${pct(failRate)})` : " (sin fallos)"}`,
    `Respuestas: ${formatInteger(f.replied)} (${pct(rate(f.replied, f.reached))} de los alcanzados) · Positivas: ${formatInteger(f.positive)} · Leads: ${formatInteger(f.leads)}`,
  ];
  if (f.tracked > 0) lines.push(`Apertura direccional: ${pct(rate(f.opened, f.tracked))} (${f.opened} de ${f.tracked} correos con pixel)`);
  lines.push(`Veredicto del ciclo: ${weeklyVerdict(page.current).title.toLowerCase()}.`);
  return lines.join("\n");
}

export function CorreosEstadisticas({ page }: { page: DirectLaneStatsPage }) {
  const f = page.current.funnel;
  const p = page.previous?.funnel ?? null;
  const verdict = weeklyVerdict(page.current);
  const previousLabel = page.range === "30" ? "los 30 días anteriores" : "la semana anterior";
  const campaignOptions = [
    ...page.campaigns.map((campaign) => ({ id: campaign.id, label: `${campaign.name} · ${campaignStateLabel[campaign.state] ?? campaign.state}` })),
    { id: ALL_CAMPAIGNS, label: "Todas las campañas" },
  ];
  const selectedId = page.selected?.id ?? ALL_CAMPAIGNS;
  const rangeHref = (range: StatsRange) => `${STATS_PATH}?campana=${encodeURIComponent(selectedId)}&rango=${range}` as Route;
  const labelRows = (rows: DirectLaneStatsRow[] | undefined, labelFor: (key: string) => string) => (rows ?? []).map((row) => ({ ...row, label: labelFor(row.key) }));
  const tabs: BreakdownTab[] = [
    { key: "variant", label: "Por perfil", rows: labelRows(page.current.by.variant, (k) => variantLabel[k] ?? k) },
    { key: "mailbox", label: "Por buzón", rows: labelRows(page.current.by.mailbox, (k) => k) },
    { key: "state", label: "Por estado", rows: labelRows(page.current.by.state, (k) => (k === "?" ? "Sin estado" : k)) },
  ];
  const replyRate = rate(f.replied, f.reached);
  const summary = summaryText(page);

  return (
    <div className="cr-stats">
      <form action={STATS_PATH} className="cr-stats-filters" method="get">
        <CampaignSelect name="campana" options={campaignOptions} value={selectedId} />
        <input name="rango" type="hidden" value={page.range} />
        <noscript><button className="button secondary" type="submit">Aplicar</button></noscript>
        <nav aria-label="Periodo" className="cr-segmented">
          {STATS_RANGES.map((range) => (
            <Link aria-current={range === page.range ? "page" : undefined} href={rangeHref(range)} key={range} prefetch={false}>{rangeLabel[range]}</Link>
          ))}
        </nav>
        <p className="cr-stats-period">{periodLabel(page)}{page.selected ? ` · ${campaignStateLabel[page.selected.state] ?? page.selected.state}` : ""}</p>
      </form>

      <section aria-labelledby="cr-verdict-title" className="cr-stats-verdict" data-level={verdict.level}>
        <span className="cr-verdict-mark" aria-hidden="true" />
        <div>
          <p className="cr-verdict-kicker">Ciclo de mejora de los viernes</p>
          <h2 id="cr-verdict-title">{verdict.title}</h2>
          <p>{verdict.detail}</p>
        </div>
        <p className="cr-verdict-meta">
          Respuesta {pct(replyRate)} · Fallos {pct(deliveryFailRate(f))}<br />
          Próximo reporte: viernes 14:00 · <a href="#cr-reports">ver reportes</a>
        </p>
      </section>

      <section aria-label="Cifras del periodo" className="cr-stats-kpis">
        <div className="metric"><span className="cr-kpi-label">Alcanzados</span><strong><MetricValue value={f.reached} /></strong><DeltaNote delta={periodDelta(f.reached, p?.reached)} previousLabel={previousLabel} /></div>
        <div className="metric"><span className="cr-kpi-label">Correos enviados</span><strong><MetricValue value={f.sends} /></strong><DeltaNote delta={periodDelta(f.sends, p?.sends)} previousLabel={previousLabel} /></div>
        <div className="metric"><span className="cr-kpi-label">Respuestas</span><strong><MetricValue value={f.replied} /><em>{pct(replyRate)}</em></strong><DeltaNote delta={periodDelta(f.replied, p?.replied)} previousLabel={previousLabel} /></div>
        <div className="metric"><span className="cr-kpi-label">Positivas</span><strong><MetricValue value={f.positive} /></strong><DeltaNote delta={periodDelta(f.positive, p?.positive)} previousLabel={previousLabel} /></div>
        <div className="metric"><span className="cr-kpi-label">Leads</span><strong><MetricValue value={f.leads} /></strong><DeltaNote delta={periodDelta(f.leads, p?.leads)} previousLabel={previousLabel} /></div>
        <div className="metric"><span className="cr-kpi-label">Fallos y rebotes</span><strong><MetricValue value={f.failed} /><em>{pct(deliveryFailRate(f))}</em></strong><DeltaNote delta={periodDelta(f.failed, p?.failed)} higherIsBetter={false} previousLabel={previousLabel} /></div>
      </section>

      <div className="cr-stats-grid">
        <Funnel stats={page.current} subtitle={`De inscritos a leads, ${rangeLabel[page.range].toLowerCase()}.`} title="Embudo" />
        <Trend rows={page.lifetime.by.week ?? []} weekStart={page.weekStart} />
      </div>

      <section aria-labelledby="cr-cuts-title" className="panel cr-stats-card">
        <div className="cr-stats-card-head"><h2 id="cr-cuts-title">Cortes</h2><p>El mismo periodo, por perfil del contacto, buzón que envió y estado de la empresa. Una tasa se declara ganadora con 20 alcanzados o más.</p></div>
        <BreakdownTabs tabs={tabs} />
      </section>

      <section aria-labelledby="cr-reports-title" className="panel cr-stats-card" id="cr-reports">
        <div className="cr-stats-card-head"><h2 id="cr-reports-title">Reportes de los viernes</h2><p>Cada viernes a las 14:00 el sistema compara la semana con la anterior y propone. Propone, no aplica: el ajuste lo decide una persona.</p></div>
        {page.reports.length === 0 ? <p className="cr-stats-empty">El primer reporte se genera el viernes a las 14:00.</p> : (
          <div className="cr-reports">
            {page.reports.map((report, index) => (
              <details className="cr-report" key={report.week_start} open={index === 0}>
                <summary><strong>Semana del {longDate.format(cdmxDate(report.week_start))}</strong><span>generado {stamp.format(new Date(report.generated_at))}</span></summary>
                <ul>{report.recommendations.map((line, i) => <li data-tone={line.startsWith("FRENO") ? "critical" : undefined} key={i}>{line}</li>)}</ul>
              </details>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="cr-summary-title" className="cr-stats-summary">
        <div className="cr-stats-card-head">
          <div><p className="cr-verdict-kicker">Para compartir con ENNCO</p><h2 id="cr-summary-title">Resumen en una lectura</h2></div>
          <CopyTextButton text={summary} />
        </div>
        <div className="cr-summary-strip">
          <div><strong>{formatInteger(f.reached)}</strong><span>empresas contactadas por primera vez</span></div>
          <div><strong>{formatInteger(f.replied)}</strong><span>respondieron ({pct(replyRate)})</span></div>
          <div><strong>{formatInteger(f.positive)}</strong><span>con interés</span></div>
          <div><strong>{formatInteger(f.leads)}</strong><span>leads calificados</span></div>
        </div>
        <pre className="cr-summary-text">{summary}</pre>
      </section>
    </div>
  );
}
