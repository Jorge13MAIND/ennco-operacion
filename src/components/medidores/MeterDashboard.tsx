"use client";

import { useState, type FormEvent } from "react";

import { COLORS, DailyBars, Heatmap, HarmonicsBars, LineChart, PowerChart } from "@/components/medidores/charts";
import { evaluateMeterAlerts, generateMeterKey, sendEnergyCommand } from "@/components/medidores/med-client";
import { meterInsights } from "@/lib/medidores/insights";
import {
  DEFAULT_THRESHOLDS, KIND_LABELS, RULE_LABELS, SCOPE_LABELS, SEVERITY_LABELS, SEVERITY_RANK, SOURCE_LABELS, THRESHOLD_FIELDS,
  fmt, fmtBytes, fmtDay, fmtMxn, fmtPct, fmtWhen, resolveThresholds,
  type EnergyAlert, type MeterView, type Rule, type Thresholds,
} from "@/lib/medidores/model";

type Props = { view: MeterView; canEdit: boolean; storage: { rows: number; bytes: number }; onChanged: (message: string) => void };

export function MeterDashboard({ view, canEdit, storage, onChanged }: Props) {
  const { meter, site, kpis: k } = view;
  const tz = site.timezone;
  const isInverter = meter.kind === "INVERSOR";
  const hasSolar = view.series.some((p) => (p.pv ?? 0) > 0);
  const insights = meterInsights(view);
  const open = view.alerts.filter((a) => a.status === "ABIERTA");
  const urgent = open.filter((a) => a.severity === "URGENTE").length;
  const attention = open.filter((a) => a.severity === "ATENCION").length;
  const [showTable, setShowTable] = useState(false);

  return (
    <div className="med-dashboard">
      {k ? (
        <section className="med-kpis" aria-label="Indicadores del periodo">
          {isInverter ? (
            <>
              <Kpi label="Generación" value={`${fmt(k.pv_kwh)} kWh`} hint="en el periodo" />
              <Kpi label="Potencia máxima" value={`${fmt(k.peak_pv_kw, 1)} kW`} hint="" />
              <Kpi label="Lecturas" value={fmt(k.readings)} hint={`última ${fmtWhen(k.last_ts, tz)}`} />
            </>
          ) : (
            <>
              <Kpi label="Tomada de la red" value={`${fmt(k.import_kwh)} kWh`} hint={`≈ ${fmtMxn(k.cost_mxn)} a $${fmt(site.price_mxn_kwh, 2)}/kWh`} accent="imp" />
              <Kpi label="Enviada a la red" value={`${fmt(k.export_kwh)} kWh`} hint={k.peak_export_kw ? `pico ${fmt(k.peak_export_kw, 1)} kW` : "sin exportación"} accent="exp" />
              <Kpi label="Demanda máxima" value={`${fmt(k.peak_kw, 1)} kW`} hint={fmtWhen(k.peak_at, tz)}
                tone={site.contracted_demand_kw && (k.peak_kw ?? 0) > site.contracted_demand_kw ? "bad" : undefined} />
              <Kpi label="Factor de potencia" value={fmt(k.pf_avg, 2)} hint={k.pf_below_share !== null ? `${fmtPct((k.pf_below_share ?? 0) * 100)} del tiempo bajo 0.95` : ""}
                tone={k.pf_avg !== null ? (k.pf_avg < 0.9 ? "bad" : k.pf_avg < 0.95 ? "warn" : "good") : undefined} />
              <Kpi label="Tensión" value={`${fmt(k.v_min, 0)}–${fmt(k.v_max, 0)} V`} hint={`nominal ${fmt(meter.nominal_v_ln)} V`} />
              <Kpi label="Desbalance" value={fmtPct(k.unbalance_avg, 1)} hint={`95 % debajo de ${fmtPct(k.unbalance_p95, 0)}`} />
              <Kpi label="Distorsión (THD)" value={`${fmtPct(k.thd_v_p95, 1)} V`} hint={`corriente ${fmtPct(k.thd_i_p95, 0)}`} />
            </>
          )}
          <Kpi label="Alertas abiertas" value={fmt(open.length)} hint={`${urgent} urgentes · ${attention} de atención`} tone={urgent ? "bad" : attention ? "warn" : "good"} />
        </section>
      ) : null}

      <section className="med-card" aria-labelledby="med-reading">
        <div className="med-card-head"><h3 id="med-reading">Lectura automática</h3><span className="crm-muted">Reglas fijas sobre los datos del periodo</span></div>
        <ul className="med-insights">
          {insights.map((item) => (
            <li key={item.title} data-tone={item.tone}>
              <span className="med-tone" data-tone={item.tone}>{item.tone === "urgente" ? "Urgente" : item.tone === "atencion" ? "Atención" : item.tone === "bien" ? "Bien" : "Dato"}</span>
              <div><strong>{item.title}</strong><p>{item.body}</p></div>
            </li>
          ))}
        </ul>
      </section>

      {view.series.length ? (
        <>
          <section className="med-card" aria-labelledby="med-power">
            <div className="med-card-head"><h3 id="med-power">{isInverter ? "Generación" : "Potencia"}</h3>
              <span className="crm-muted">{`Promedio cada ${fmt(view.range.step_minutes)} min`}{isInverter ? "" : " · arriba lo que toma de la red, abajo lo que envía"}</span></div>
            {isInverter
              ? <LineChart points={view.series} tz={tz} lines={[{ key: "pv", label: "Solar", color: COLORS.pv }]} unit="kW" label="Generación solar" domain={[0, null]} height={260} />
              : <PowerChart points={view.series} tz={tz} contracted={site.contracted_demand_kw} showSolar={hasSolar} />}
          </section>

          <div className="med-grid-2">
            <section className="med-card" aria-labelledby="med-daily">
              <div className="med-card-head"><h3 id="med-daily">Energía por día</h3>
                <button type="button" className="med-link" onClick={() => setShowTable((v) => !v)}>{showTable ? "Ver gráfica" : "Ver tabla"}</button></div>
              {showTable ? <DailyTable view={view} /> : <DailyBars daily={view.daily} showSolar={isInverter || hasSolar} />}
            </section>
            <section className="med-card" aria-labelledby="med-heat">
              <div className="med-card-head"><h3 id="med-heat">Hora por hora</h3><span className="crm-muted">Azul: tomó de la red · ámbar: envió a la red</span></div>
              <Heatmap cells={view.heatmap} />
            </section>
          </div>

          {!isInverter ? (
            <section className="med-card" aria-labelledby="med-quality">
              <div className="med-card-head"><h3 id="med-quality">Calidad de la energía</h3><span className="crm-muted">Promedios por fase en cada intervalo</span></div>
              <div className="med-grid-2 med-quality">
                <figure><figcaption>Tensión fase-neutro (V)</figcaption>
                  <LineChart points={view.series} tz={tz} unit="V" label="Tensión por fase"
                    lines={[{ key: "v1", label: "L1", color: COLORS.l1 }, { key: "v2", label: "L2", color: COLORS.l2 }, { key: "v3", label: "L3", color: COLORS.l3 }]}
                    refs={[{ value: meter.nominal_v_ln * 1.05, label: "+5 %" }, { value: meter.nominal_v_ln * 0.95, label: "−5 %" }]} /></figure>
                <figure><figcaption>Corriente por fase (A)</figcaption>
                  <LineChart points={view.series} tz={tz} unit="A" label="Corriente por fase" domain={[0, null]}
                    lines={[{ key: "i1", label: "L1", color: COLORS.l1 }, { key: "i2", label: "L2", color: COLORS.l2 }, { key: "i3", label: "L3", color: COLORS.l3 }]} /></figure>
                <figure><figcaption>Factor de potencia (fases que consumen)</figcaption>
                  <LineChart points={view.series} tz={tz} unit="" label="Factor de potencia" domain={[null, 1]}
                    lines={[{ key: "pf", label: "FP", color: COLORS.imp }]} refs={[{ value: 0.95, label: "0.95 Código de Red" }, { value: 0.9, label: "0.90 recargo CFE", color: COLORS.critical }]} /></figure>
                <figure><figcaption>Distorsión armónica total (%)</figcaption>
                  <div className="med-thd">
                    <LineChart points={view.series} tz={tz} unit="%" label="THD de tensión" height={150} domain={[0, null]}
                      lines={[{ key: "thdv", label: "Tensión", color: COLORS.imp }]} refs={[{ value: 8, label: "8 % IEEE 519" }]} />
                    <LineChart points={view.series} tz={tz} unit="%" label="THD de corriente" height={150} domain={[0, null]}
                      lines={[{ key: "thdi", label: "Corriente", color: COLORS.l2 }]} />
                  </div>
                </figure>
              </div>
            </section>
          ) : null}

          {view.harmonics.v.length || view.harmonics.i.length ? (
            <section className="med-card" aria-labelledby="med-harm">
              <div className="med-card-head"><h3 id="med-harm">Armónicos del 2 al 15</h3><span className="crm-muted">Percentil 95 del periodo, por fase</span></div>
              <div className="med-grid-2">
                <figure><figcaption>De tensión (%)</figcaption><HarmonicsBars bars={view.harmonics.v} label="Armónicos de tensión" /></figure>
                <figure><figcaption>De corriente (%)</figcaption><HarmonicsBars bars={view.harmonics.i} label="Armónicos de corriente" /></figure>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      <AlertsPanel alerts={view.alerts} tz={tz} canEdit={canEdit} onChanged={onChanged} />
      <MeterSettings view={view} canEdit={canEdit} storage={storage} onChanged={onChanged} />
    </div>
  );
}

function Kpi({ label, value, hint, tone, accent }: { label: string; value: string; hint: string; tone?: "good" | "warn" | "bad"; accent?: "imp" | "exp" }) {
  return (
    <div className="crm-kpi med-kpi" data-tone={tone} data-accent={accent}>
      <span>{label}</span><strong>{value}</strong><em>{hint}</em>
    </div>
  );
}

function DailyTable({ view }: { view: MeterView }) {
  return (
    <div className="table-wrap" role="region" tabIndex={0} aria-label="Energía por día">
      <table className="crm-table med-table">
        <thead><tr><th scope="col">Día</th><th scope="col">De la red (kWh)</th><th scope="col">A la red (kWh)</th><th scope="col">Solar (kWh)</th><th scope="col">Demanda máx. (kW)</th><th scope="col">FP</th><th scope="col">Lecturas</th></tr></thead>
        <tbody>
          {view.daily.map((d) => (
            <tr key={d.d}>
              <td data-label="Día">{fmtDay(d.d)}</td><td data-label="De la red">{fmt(d.imp)}</td><td data-label="A la red">{fmt(d.exp)}</td>
              <td data-label="Solar">{fmt(d.pv)}</td><td data-label="Demanda máx.">{fmt(d.peak, 1)}</td><td data-label="FP">{fmt(d.pf, 2)}</td><td data-label="Lecturas">{fmt(d.n)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SEVERITY_ICON: Record<EnergyAlert["severity"], string> = { URGENTE: "▲", ATENCION: "●", INFO: "i" };

/** Alertas agrupadas por regla: de un vistazo qué pasó y cuántas veces; al abrir, cada ocurrencia. */
function AlertsPanel({ alerts, tz, canEdit, onChanged }: { alerts: EnergyAlert[]; tz: string; canEdit: boolean; onChanged: (m: string) => void }) {
  const [filter, setFilter] = useState<"ABIERTA" | "TODAS">("ABIERTA");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visible = alerts.filter((a) => filter === "TODAS" || a.status === "ABIERTA");
  const groups = new Map<Rule, EnergyAlert[]>();
  for (const a of visible) groups.set(a.rule, [...(groups.get(a.rule) ?? []), a]);
  const ordered = [...groups.entries()].sort((a, b) =>
    Math.max(...b[1].map((x) => SEVERITY_RANK[x.severity])) - Math.max(...a[1].map((x) => SEVERITY_RANK[x.severity])) || b[1].length - a[1].length);
  async function setStatus(ids: string[], status: "RECONOCIDA" | "CERRADA" | "ABIERTA") {
    setBusy(ids[0] ?? null); setError(null);
    for (const id of ids) {
      const outcome = await sendEnergyCommand({ op: "ALERTA_ESTADO", payload: { alert_id: id, status } });
      if (!outcome.ok) { setBusy(null); setError(outcome.message); return; }
    }
    setBusy(null);
    onChanged(ids.length > 1 ? `${ids.length} alertas actualizadas.` : status === "CERRADA" ? "Alerta cerrada." : "Alerta reconocida.");
  }
  return (
    <section className="med-card" aria-labelledby="med-alerts">
      <div className="med-card-head">
        <h3 id="med-alerts">Alertas</h3>
        <div className="crm-segmented" role="radiogroup" aria-label="Mostrar">
          <button type="button" role="radio" aria-checked={filter === "ABIERTA"} onClick={() => setFilter("ABIERTA")}>Abiertas</button>
          <button type="button" role="radio" aria-checked={filter === "TODAS"} onClick={() => setFilter("TODAS")}>Todas</button>
        </div>
      </div>
      {error ? <p className="crm-error" role="alert">{error}</p> : null}
      {ordered.length === 0 ? <p className="crm-muted">{filter === "ABIERTA" ? "Sin alertas abiertas en este periodo." : "Sin alertas en este periodo."}</p> : null}
      <div className="med-alert-groups">
        {ordered.map(([rule, list]) => {
          const worst = list.reduce((a, b) => (SEVERITY_RANK[b.severity] > SEVERITY_RANK[a.severity] ? b : a));
          const openIds = list.filter((a) => a.status === "ABIERTA").map((a) => a.id);
          return (
            <details key={rule} className="med-alert-group" data-severity={worst.severity}>
              <summary>
                <span className="med-sev" data-severity={worst.severity}><b aria-hidden="true">{SEVERITY_ICON[worst.severity]}</b>{SEVERITY_LABELS[worst.severity]}</span>
                <strong>{RULE_LABELS[rule]}</strong>
                <span className="crm-muted">{list.length === 1 ? fmtWhen(list[0]!.started_at, tz) : `${list.length} veces · última ${fmtWhen(list[0]!.started_at, tz)}`}</span>
              </summary>
              <ul className="med-alert-list">
                {list.map((a) => (
                  <li key={a.id} data-status={a.status}>
                    <div>
                      <p>{a.message}</p>
                      <span className="crm-muted">{fmtWhen(a.started_at, tz)}{a.ended_at ? ` a ${fmtWhen(a.ended_at, tz)}` : " · sigue"}{a.status !== "ABIERTA" ? ` · ${a.status === "RECONOCIDA" ? "reconocida" : "cerrada"}` : ""}{a.telegram_sent_at ? " · enviada por Telegram" : ""}</span>
                    </div>
                    {canEdit ? (
                      <div className="med-alert-actions">
                        {a.status === "ABIERTA" ? <>
                          <button type="button" className="crm-button" disabled={busy !== null} onClick={() => void setStatus([a.id], "RECONOCIDA")}>Reconocer</button>
                          <button type="button" className="crm-button" disabled={busy !== null} onClick={() => void setStatus([a.id], "CERRADA")}>Cerrar</button>
                        </> : <button type="button" className="crm-button" disabled={busy !== null} onClick={() => void setStatus([a.id], "ABIERTA")}>Reabrir</button>}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              {canEdit && openIds.length > 1 ? (
                <div className="med-alert-bulk"><button type="button" className="crm-button" disabled={busy !== null} onClick={() => void setStatus(openIds, "RECONOCIDA")}>{`Reconocer las ${openIds.length}`}</button></div>
              ) : null}
            </details>
          );
        })}
      </div>
    </section>
  );
}

/** Umbrales del medidor, llave de API y peso de los datos. */
function MeterSettings({ view, canEdit, storage, onChanged }: Props) {
  const { meter } = view;
  const current = resolveThresholds(meter.thresholds);
  const [values, setValues] = useState<Record<keyof Thresholds, string>>(() =>
    Object.fromEntries(THRESHOLD_FIELDS.map((f) => [f.key, String(current[f.key])])) as Record<keyof Thresholds, string>);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const relevant = THRESHOLD_FIELDS.filter((f) => (meter.kind === "INVERSOR" ? ["generacion_baja_pct"].includes(f.key) : f.key !== "generacion_baja_pct"));
  async function saveThresholds(event: FormEvent) {
    event.preventDefault();
    setBusy("Guardando umbrales…"); setError(null);
    const thresholds: Partial<Thresholds> = {};
    for (const f of THRESHOLD_FIELDS) {
      const value = Number(values[f.key].replace(",", "."));
      if (Number.isFinite(value) && value !== DEFAULT_THRESHOLDS[f.key]) thresholds[f.key] = value;
    }
    const outcome = await sendEnergyCommand({ op: "MEDIDOR_GUARDAR", payload: { meter_id: meter.id, name: meter.name, thresholds } });
    if (!outcome.ok) { setBusy(null); setError(outcome.message); return; }
    let extra = "";
    if (meter.first_reading_at && meter.last_reading_at) {
      setBusy("Recalculando alertas…");
      const evaluated = await evaluateMeterAlerts(meter.id, meter.first_reading_at, new Date(Date.parse(meter.last_reading_at) + 60000).toISOString());
      extra = evaluated.ok ? ` ${evaluated.message}` : "";
    }
    setBusy(null);
    onChanged(`Umbrales guardados.${extra}`);
  }
  async function newKey() {
    setBusy("Generando llave…"); setError(null);
    const outcome = await generateMeterKey(meter.id);
    setBusy(null);
    if (!outcome.ok) { setError(outcome.message); return; }
    setKey(outcome.data.key);
  }
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const bytesPerRow = storage.rows > 0 ? storage.bytes / storage.rows : 260;
  const perMonth = (minutes: number) => (30 * 24 * 60 / minutes) * bytesPerRow;
  return (
    <section className="med-card" aria-labelledby="med-settings">
      <div className="med-card-head"><h3 id="med-settings">Ajustes del medidor</h3>
        <span className="crm-muted">{KIND_LABELS[meter.kind]} · {SCOPE_LABELS[meter.scope]} · {SOURCE_LABELS[meter.source]}{meter.device_model ? ` · ${meter.device_brand ?? ""} ${meter.device_model}` : ""}</span></div>
      {error ? <p className="crm-error" role="alert">{error}</p> : null}
      {busy ? <p className="crm-muted" role="status">{busy}</p> : null}
      <div className="med-settings">
        <details className="med-subcard" open={false}>
          <summary><strong>Umbrales de las alertas</strong><span className="crm-muted">Lo que separa lo irrelevante de lo urgente</span></summary>
          <form className="med-thresholds" onSubmit={saveThresholds}>
            {relevant.map((f) => (
              <label key={f.key} className="crm-field">
                <span>{f.label}{f.unit ? ` (${f.unit})` : ""}</span>
                <input inputMode="decimal" value={values[f.key]} disabled={!canEdit} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
                {f.hint ? <em>{f.hint}</em> : null}
              </label>
            ))}
            {canEdit ? <div className="crm-dialog-actions"><button type="submit" className="crm-button" data-primary="true" disabled={busy !== null}>Guardar y recalcular</button></div> : null}
          </form>
        </details>

        {meter.kind === "ANALIZADOR" ? (
          <details className="med-subcard">
            <summary><strong>Lecturas en vivo (API)</strong><span className="crm-muted">{meter.has_key ? `Llave activa ${meter.key_hint ?? ""} desde ${fmtWhen(meter.key_created_at, view.site.timezone)}` : "Sin llave"}</span></summary>
            <div className="med-api">
              <p>El equipo (o un script en la computadora que descarga el analizador) manda las lecturas con su llave. Cada medidor tiene la suya. Generar una nueva invalida la anterior.</p>
              {key ? (
                <div className="med-key">
                  <p><strong>Copia la llave ahora; no se vuelve a mostrar.</strong></p>
                  <code>{key}</code>
                </div>
              ) : null}
              <pre className="med-code">{`curl -X POST ${origin}/api/v1/medidores/lecturas \\
  -H "Authorization: Bearer ${key ?? "enm_…"}" \\
  -H "Content-Type: application/json" \\
  -d '{"readings":[{"ts":"2026-10-19T09:30:00-06:00","p_import_kw":42.1,"v_l1":127.4,"v_l2":126.9,"v_l3":127.8,"i_l1":120,"i_l2":115,"i_l3":118,"pf_l1":0.91}]}'`}</pre>
              <p className="crm-muted">Hasta 2,000 lecturas por llamada, con la hora con zona. Campos: tensiones (v_l1…), corrientes (i_l1…), potencia tomada y enviada (p_import_kw, p_export_kw), factor de potencia (pf_l1…), THD (thd_v_max, thd_i_max), frecuencia (freq) y armónicos.</p>
              {canEdit ? (
                <div className="crm-dialog-actions">
                  {meter.has_key ? <button type="button" className="crm-button" disabled={busy !== null} onClick={() => void sendEnergyCommand({ op: "MEDIDOR_LLAVE_QUITAR", payload: { meter_id: meter.id } }).then((o) => (o.ok ? onChanged(o.message) : setError(o.message)))}>Quitar llave</button> : null}
                  <button type="button" className="crm-button" data-primary="true" disabled={busy !== null} onClick={() => void newKey()}>{meter.has_key ? "Generar otra llave" : "Generar llave"}</button>
                </div>
              ) : null}
            </div>
          </details>
        ) : null}

        <details className="med-subcard">
          <summary><strong>Peso de los datos</strong><span className="crm-muted">{fmt(meter.readings_count)} lecturas guardadas de este medidor</span></summary>
          <div className="med-weight">
            <p>Grant pidió probar mediciones cada 10, 5 y 1 minuto y ver cuánto pesa la base. Con lo guardado hoy, cada lectura ocupa unos {fmt(bytesPerRow, 0)} bytes (con índices). Por medidor y por mes:</p>
            <table className="crm-table med-table">
              <thead><tr><th scope="col">Una lectura cada</th><th scope="col">Lecturas al mes</th><th scope="col">Espacio al mes</th><th scope="col">Al año</th></tr></thead>
              <tbody>
                {[10, 5, 1].map((m) => (
                  <tr key={m}><td>{m} min</td><td>{fmt(30 * 24 * 60 / m)}</td><td>{fmtBytes(perMonth(m))}</td><td>{fmtBytes(perMonth(m) * 12)}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="crm-muted">Toda la tabla de lecturas pesa hoy {fmtBytes(storage.bytes)}. Las pantallas resumen los datos en la base, así que una medición cada minuto no las hace más lentas.</p>
          </div>
        </details>
      </div>
    </section>
  );
}
