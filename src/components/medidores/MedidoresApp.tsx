"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { GrowattDialog, ImportDialog, MeterDialog, SiteDialog } from "@/components/medidores/MedidoresDialogs";
import { MeterDashboard } from "@/components/medidores/MeterDashboard";
import { evaluateMeterAlerts, fetchMeterView, sendEnergyCommand } from "@/components/medidores/med-client";
import {
  KIND_LABELS, SCOPE_LABELS, SOURCE_LABELS, fmt, fmtWhen, workDaysLabel,
  type Meter, type MeterView, type Overview, type Site,
} from "@/lib/medidores/model";

type Range = "todo" | "24h" | "7d" | "30d" | "custom";
const RANGES: Array<{ id: Range; label: string; hours?: number }> = [
  { id: "todo", label: "Todo" }, { id: "24h", label: "24 h", hours: 24 }, { id: "7d", label: "7 días", hours: 168 }, { id: "30d", label: "30 días", hours: 720 }, { id: "custom", label: "Fechas" },
];
type Dialog = { kind: "site"; site: Site | null } | { kind: "meter"; siteId: string; meter: Meter | null } | { kind: "import"; meter: Meter; tz: string } | { kind: "growatt"; site: Site } | null;

export function MedidoresApp({ overview, canEdit }: { overview: Overview; canEdit: boolean }) {
  const router = useRouter();
  const sites = overview.sites;
  const [siteId, setSiteId] = useState<string | null>(sites[0]?.id ?? null);
  const site = sites.find((s) => s.id === siteId) ?? sites[0] ?? null;
  const [meterId, setMeterId] = useState<string | null>(site?.meters[0]?.id ?? null);
  const meter = site?.meters.find((m) => m.id === meterId) ?? site?.meters[0] ?? null;
  const [range, setRange] = useState<Range>("todo");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [version, setVersion] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const last = meter?.last_reading_at ? Date.parse(meter.last_reading_at) + 1000 : null;
  const preset = RANGES.find((r) => r.id === range);
  const since = range === "custom" ? (from ? new Date(`${from}T00:00:00`).toISOString() : null)
    : preset?.hours && last ? new Date(last - preset.hours * 3600000).toISOString() : null;
  const until = range === "custom" ? (to ? new Date(`${to}T23:59:59`).toISOString() : null) : null;
  const requestKey = `${meter?.id ?? ""}|${since ?? ""}|${until ?? ""}|${version}|${meter?.revision ?? 0}|${meter?.readings_count ?? 0}`;
  const [loaded, setLoaded] = useState<{ key: string; view: MeterView | null } | null>(null);
  useEffect(() => {
    if (!meter?.id) return;
    let cancelled = false;
    void fetchMeterView(meter.id, since, until).then((view) => { if (!cancelled) setLoaded({ key: requestKey, view }); });
    return () => { cancelled = true; };
  }, [meter?.id, since, until, requestKey]);
  const loading = Boolean(meter) && loaded?.key !== requestKey;
  const view = loaded?.key === requestKey ? loaded.view : null;

  function changed(text: string, select?: { siteId?: string; meterId?: string }) {
    setDialog(null);
    setMessage(text);
    if (select?.siteId) setSiteId(select.siteId);
    if (select?.meterId) setMeterId(select.meterId);
    setVersion((v) => v + 1);
    router.refresh();
  }
  function pickSite(id: string) {
    setSiteId(id);
    setMeterId(sites.find((s) => s.id === id)?.meters[0]?.id ?? null);
    setMessage(null);
  }

  return (
    <div className="med-app">
      <aside className="med-sites" aria-label="Clientes y medidores">
        <div className="med-sites-head">
          <h2>Clientes</h2>
          {canEdit ? <button type="button" className="crm-button" onClick={() => setDialog({ kind: "site", site: null })}>+ Planta</button> : null}
        </div>
        {sites.length === 0 ? <p className="crm-muted">Todavía no hay plantas. Agrega la primera para cargar sus mediciones.</p> : null}
        <ul className="med-site-list">
          {sites.map((s) => (
            <li key={s.id} data-active={s.id === site?.id ? "true" : undefined}>
              <button type="button" className="med-site" onClick={() => pickSite(s.id)} aria-pressed={s.id === site?.id}>
                <strong>{s.client_name}</strong><span>{s.site_name}{s.city ? ` · ${s.city}` : ""}</span>
              </button>
              {s.id === site?.id ? (
                <ul className="med-meter-list">
                  {s.meters.map((m) => (
                    <li key={m.id}>
                      <button type="button" className="med-meter" aria-pressed={m.id === meter?.id} onClick={() => { setMeterId(m.id); setMessage(null); }}>
                        <span className="med-meter-name">{m.name}</span>
                        <span className="med-meter-meta">{m.kind === "INVERSOR" ? "Inversor" : SCOPE_LABELS[m.scope]} · {m.last_reading_at ? fmtWhen(m.last_reading_at, s.timezone) : "sin lecturas"}</span>
                        {m.open_alerts.URGENTE ? <span className="med-badge" data-severity="URGENTE">{m.open_alerts.URGENTE}</span>
                          : m.open_alerts.ATENCION ? <span className="med-badge" data-severity="ATENCION">{m.open_alerts.ATENCION}</span> : null}
                      </button>
                    </li>
                  ))}
                  {canEdit ? <li><button type="button" className="med-add" onClick={() => setDialog({ kind: "meter", siteId: s.id, meter: null })}>+ Medidor</button></li> : null}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="med-telegram" data-on={overview.settings.telegram_enabled ? "true" : "false"}>
          {overview.settings.telegram_enabled
            ? `Avisos por Telegram encendidos (${overview.settings.telegram_min_severity === "URGENTE" ? "solo urgentes" : "urgentes y de atención"}).`
            : "Avisos por Telegram: listos y apagados. Se encienden cuando Grant lo indique."}
        </p>
      </aside>

      <div className="med-main">
        {site ? (
          <header className="med-site-head">
            <div>
              <p className="eyebrow">{site.client_name}</p>
              <h2>{site.site_name}{site.city ? <span className="crm-muted"> · {site.city}{site.state ? `, ${site.state}` : ""}</span> : null}</h2>
              <p className="crm-muted">
                {workDaysLabel(site.work_days)} de {site.work_start} a {site.work_end} · energía a ${fmt(site.price_mxn_kwh, 2)}/kWh
                {site.contracted_demand_kw ? ` · demanda contratada ${fmt(site.contracted_demand_kw)} kW` : ""}
                {site.paro_cost_mxn_h ? ` · hora de paro $${fmt(site.paro_cost_mxn_h)}` : ""}
              </p>
            </div>
            {canEdit ? (
              <div className="med-actions">
                <button type="button" className="crm-button" onClick={() => setDialog({ kind: "site", site })}>Editar planta</button>
                <button type="button" className="crm-button" onClick={() => setDialog({ kind: "growatt", site })}>Conectar Growatt</button>
              </div>
            ) : null}
          </header>
        ) : null}

        {site && site.integrations.length ? (
          <ul className="med-integrations">
            {site.integrations.map((i) => (
              <li key={i.id} data-status={i.status}>
                <strong>Growatt · {i.plant_name ?? i.plant_id}</strong>
                <span>{i.status === "ACTIVA" ? "Activa" : i.status === "PAUSADA" ? "En pausa" : "Con error"}{i.last_sync_at ? ` · última lectura ${fmtWhen(i.last_sync_at, site.timezone)}` : " · esperando la primera vuelta (15 min)"}{i.last_error ? ` · ${i.last_error}` : ""}</span>
                {canEdit ? <button type="button" className="med-link" onClick={() => void sendEnergyCommand({ op: "GROWATT_PAUSAR", payload: { integration_id: i.id, active: i.status === "PAUSADA" } }).then((o) => changed(o.message))}>{i.status === "PAUSADA" ? "Reanudar" : "Pausar"}</button> : null}
              </li>
            ))}
          </ul>
        ) : null}

        {site ? <AreaBreakdown site={site} since={since} until={until} version={version} /> : null}

        {meter && site ? (
          <>
            <div className="med-toolbar">
              <div className="med-meter-title">
                <h3>{meter.name}</h3>
                <span className="crm-chip">{KIND_LABELS[meter.kind]}</span>
                <span className="crm-chip" data-tone="info">{SOURCE_LABELS[meter.source]}</span>
                {meter.interval_minutes ? <span className="crm-muted">cada {fmt(meter.interval_minutes)} min</span> : null}
              </div>
              <div className="med-toolbar-row">
                <div className="crm-segmented" role="radiogroup" aria-label="Periodo">
                  {RANGES.map((r) => <button key={r.id} type="button" role="radio" aria-checked={range === r.id} onClick={() => setRange(r.id)}>{r.label}</button>)}
                </div>
                {range === "custom" ? (
                  <span className="med-dates">
                    <label>Desde <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
                    <label>Hasta <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
                  </span>
                ) : null}
                {canEdit ? (
                  <span className="med-actions">
                    {meter.kind === "ANALIZADOR" ? <button type="button" className="crm-button" data-primary="true" onClick={() => setDialog({ kind: "import", meter, tz: site.timezone })}>Cargar archivo</button> : null}
                    {meter.first_reading_at && meter.last_reading_at ? (
                      <button type="button" className="crm-button" onClick={() => {
                        setMessage("Recalculando alertas…");
                        void evaluateMeterAlerts(meter.id, meter.first_reading_at!, new Date(Date.parse(meter.last_reading_at!) + 60000).toISOString()).then((o) => changed(o.message));
                      }}>Recalcular alertas</button>
                    ) : null}
                    <button type="button" className="crm-button" onClick={() => setDialog({ kind: "meter", siteId: site.id, meter })}>Editar medidor</button>
                  </span>
                ) : null}
              </div>
            </div>
            {message ? <p className="med-message" role="status">{message}</p> : null}
            {meter.readings_count === 0 ? (
              <div className="med-empty">
                <h3>Sin lecturas todavía</h3>
                <p>{meter.kind === "ANALIZADOR" ? "Carga el Excel que exporta el analizador o genera una llave de API en los ajustes del medidor para recibir lecturas en vivo." : "Las lecturas de Growatt llegan en la siguiente vuelta (cada 15 minutos)."}</p>
              </div>
            ) : loading ? <div className="med-loading" role="status">Cargando el tablero…</div>
              : view ? <MeterDashboard key={`${meter.id}:${meter.revision}`} view={view} canEdit={canEdit} storage={overview.storage} onChanged={(text) => changed(text)} />
                : <p className="crm-error" role="alert">No se pudo cargar el tablero de este medidor. Recarga la página.</p>}
          </>
        ) : site ? (
          <div className="med-empty"><h3>Esta planta no tiene medidores</h3><p>Agrega el tablero general y, si hay, un medidor por área o por máquina. O conecta su planta solar de Growatt.</p></div>
        ) : (
          <div className="med-empty"><h3>Empieza con una planta</h3><p>Una planta es un cliente en una ubicación. Ahí se agregan sus medidores: el analizador del tablero general, los de cada área o máquina y sus inversores.</p></div>
        )}
      </div>

      {dialog?.kind === "site" ? <SiteDialog site={dialog.site} onClose={() => setDialog(null)} onDone={(m, id) => changed(m, { siteId: id || undefined })} /> : null}
      {dialog?.kind === "meter" ? <MeterDialog siteId={dialog.siteId} meter={dialog.meter} onClose={() => setDialog(null)} onDone={(m, id) => changed(m, { meterId: id || undefined })} /> : null}
      {dialog?.kind === "import" ? <ImportDialog meter={dialog.meter} timeZone={dialog.tz} onClose={() => setDialog(null)} onDone={(m) => changed(m)} /> : null}
      {dialog?.kind === "growatt" ? <GrowattDialog site={dialog.site} onClose={() => setDialog(null)} onDone={(m) => changed(m)} /> : null}
    </div>
  );
}

/**
 * Reparto por área (Paco y Tere, junta #9): con el tablero general y al menos un medidor de área o
 * máquina, cuánto pesa cada uno y cuánto queda sin medir; y contra el recibo de CFE, si se captura.
 */
function AreaBreakdown({ site, since, until, version }: { site: Site; since: string | null; until: string | null; version: number }) {
  const analyzers = site.meters.filter((m) => m.kind === "ANALIZADOR" && m.readings_count > 0);
  const key = `${analyzers.map((m) => `${m.id}:${m.readings_count}`).join(",")}|${since}|${until}|${version}`;
  const [data, setData] = useState<{ key: string; rows: Array<{ meter: Meter; kwh: number }> } | null>(null);
  const [bill, setBill] = useState("");
  const enabled = analyzers.length >= 2;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void Promise.all(analyzers.map(async (meter) => ({ meter, kwh: (await fetchMeterView(meter.id, since, until))?.kpis?.import_kwh ?? 0 })))
      .then((rows) => { if (!cancelled) setData({ key, rows }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key resume medidores y periodo
  }, [key, enabled]);
  if (!enabled) return null;
  const rows = data?.key === key ? data.rows : null;
  const general = rows?.find((r) => r.meter.scope === "GENERAL");
  const parts = rows?.filter((r) => r.meter.scope !== "GENERAL") ?? [];
  const base = general?.kwh ?? parts.reduce((s, r) => s + r.kwh, 0);
  const measured = parts.reduce((s, r) => s + r.kwh, 0);
  const billKwh = Number(bill.replace(",", "."));
  return (
    <section className="med-card med-areas" aria-labelledby="med-areas">
      <div className="med-card-head"><h3 id="med-areas">Reparto por área</h3><span className="crm-muted">Energía tomada de la red en el periodo elegido</span></div>
      {!rows ? <p className="crm-muted">Calculando…</p> : (
        <>
          <ul className="med-area-list">
            {parts.map((r) => (
              <li key={r.meter.id}>
                <span>{r.meter.name}</span>
                <svg width="100%" height="10" aria-hidden="true" className="med-area-bar">
                  <rect width="100%" height="10" rx="5" fill="#eef0f2" />
                  <rect width={`${base > 0 ? Math.min(100, (r.kwh / base) * 100) : 0}%`} height="10" rx="5" fill="#2a78d6" />
                </svg>
                <strong>{fmt(r.kwh)} kWh · {base > 0 ? fmt((r.kwh / base) * 100, 1) : "0"} %</strong>
              </li>
            ))}
            {general ? (
              <li data-rest="true">
                <span>Sin medir por área</span>
                <svg width="100%" height="10" aria-hidden="true" className="med-area-bar">
                  <rect width="100%" height="10" rx="5" fill="#eef0f2" />
                  <rect width={`${base > 0 ? Math.max(0, Math.min(100, ((base - measured) / base) * 100)) : 0}%`} height="10" rx="5" fill="#9aa3ab" />
                </svg>
                <strong>{fmt(Math.max(0, base - measured))} kWh · {base > 0 ? fmt(Math.max(0, ((base - measured) / base) * 100), 1) : "0"} %</strong>
              </li>
            ) : null}
          </ul>
          <div className="med-bill">
            <label className="crm-field">Recibo de CFE del mismo periodo (kWh)<input inputMode="decimal" value={bill} onChange={(e) => setBill(e.target.value)} placeholder="Opcional" /></label>
            {billKwh > 0 ? <p>{general ? `El tablero general midió ${fmt(base)} kWh` : `La suma de los medidores es ${fmt(base)} kWh`}: {fmt(((base - billKwh) / billKwh) * 100, 1)} % contra el recibo ({fmt(billKwh)} kWh). {Math.abs(base - billKwh) / billKwh > 0.05 ? "Más de 5 % de diferencia: revisar si falta un circuito por medir o si el periodo no coincide." : "Cuadra con el recibo."}</p> : null}
          </div>
        </>
      )}
    </section>
  );
}
