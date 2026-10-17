"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";

import { connectGrowatt, evaluateMeterAlerts, sendEnergyCommand, testGrowatt, uploadReadings, type GrowattPlantOption } from "@/components/medidores/med-client";
import { readCircutorWorkbook, type CircutorFile } from "@/lib/medidores/circutor";
import { plantLocalToIso } from "@/lib/medidores/growatt";
import { fmt, METER_SCOPES, SCOPE_LABELS, type Meter, type Site } from "@/lib/medidores/model";
import { browserInflate, readXlsxBytes } from "@/lib/medidores/xlsx-browser";

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (ref.current && !ref.current.open) ref.current.showModal(); }, []);
  return (
    <dialog ref={ref} className="crm-dialog med-dialog" data-wide={wide ? "true" : undefined} aria-label={title} onClose={onClose} onCancel={onClose}>
      <div className="crm-dialog-head">
        <h2>{title}</h2>
        <button type="button" className="crm-icon-button" onClick={onClose} aria-label="Cerrar">×</button>
      </div>
      {children}
    </dialog>
  );
}

const DAYS = [[1, "Lun"], [2, "Mar"], [3, "Mié"], [4, "Jue"], [5, "Vie"], [6, "Sáb"], [7, "Dom"]] as const;
const num = (value: string) => (value.trim() === "" ? null : Number(value.replace(",", ".")));

/** Alta o edición de una planta (cliente, ubicación, precio de la energía, horario). */
export function SiteDialog({ site, onClose, onDone }: { site: Site | null; onClose: () => void; onDone: (message: string, siteId?: string) => void }) {
  const [form, setForm] = useState({
    client_name: site?.client_name ?? "", site_name: site?.site_name ?? "Planta", city: site?.city ?? "", state: site?.state ?? "",
    price: site ? String(site.price_mxn_kwh) : "2.80", contracted: site?.contracted_demand_kw ? String(site.contracted_demand_kw) : "",
    paro: site?.paro_cost_mxn_h ? String(site.paro_cost_mxn_h) : "", start: site?.work_start ?? "07:00", end: site?.work_end ?? "19:00",
    notes: site?.notes ?? "",
  });
  const [days, setDays] = useState<number[]>(site?.work_days ?? [1, 2, 3, 4, 5, 6]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [key]: event.target.value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    const outcome = await sendEnergyCommand({ op: "SITIO_GUARDAR", payload: {
      ...(site ? { site_id: site.id } : {}), client_name: form.client_name, site_name: form.site_name, city: form.city, state: form.state,
      price_mxn_kwh: num(form.price) ?? 2.8, contracted_demand_kw: num(form.contracted), paro_cost_mxn_h: num(form.paro),
      work_days: days, work_start: form.start, work_end: form.end, notes: form.notes,
    } });
    setBusy(false);
    if (!outcome.ok) { setError(outcome.message); return; }
    onDone(outcome.message, String(outcome.data.site_id ?? ""));
  }
  return (
    <Modal title={site ? "Editar planta" : "Nueva planta"} onClose={onClose}>
      <form className="crm-form" onSubmit={submit}>
        <div className="crm-field-row">
          <label className="crm-field">Cliente<input required minLength={2} value={form.client_name} onChange={set("client_name")} placeholder="Lácteos Padiher" /></label>
          <label className="crm-field">Planta<input value={form.site_name} onChange={set("site_name")} placeholder="Planta León" /></label>
        </div>
        <div className="crm-field-row">
          <label className="crm-field">Ciudad<input value={form.city} onChange={set("city")} /></label>
          <label className="crm-field">Estado<input value={form.state} onChange={set("state")} /></label>
        </div>
        <div className="crm-field-row">
          <label className="crm-field">Precio de la energía (pesos por kWh)<input inputMode="decimal" value={form.price} onChange={set("price")} /></label>
          <label className="crm-field">Demanda contratada (kW)<input inputMode="decimal" value={form.contracted} onChange={set("contracted")} placeholder="Opcional" /></label>
        </div>
        <label className="crm-field">Costo de una hora de paro (pesos)<input inputMode="decimal" value={form.paro} onChange={set("paro")} placeholder="Opcional; sirve para poner en pesos los paros" /></label>
        <fieldset className="crm-fieldset">
          <legend>Horario de trabajo</legend>
          <div className="med-days">
            {DAYS.map(([d, label]) => (
              <label key={d} className="med-day"><input type="checkbox" checked={days.includes(d)} onChange={(e) => setDays((prev) => (e.target.checked ? [...prev, d].sort() : prev.filter((x) => x !== d)))} />{label}</label>
            ))}
          </div>
          <div className="crm-field-row">
            <label className="crm-field">Entra<input type="time" value={form.start} onChange={set("start")} /></label>
            <label className="crm-field">Sale<input type="time" value={form.end} onChange={set("end")} /></label>
          </div>
        </fieldset>
        <label className="crm-field">Notas<textarea rows={2} value={form.notes} onChange={set("notes")} /></label>
        {error ? <p className="crm-error" role="alert">{error}</p> : null}
        <div className="crm-dialog-actions">
          <button type="button" className="crm-button" onClick={onClose}>Cancelar</button>
          <button type="submit" className="crm-button" data-primary="true" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Alta o edición de un punto de medición (analizador). Los inversores llegan solos con Growatt. */
export function MeterDialog({ siteId, meter, onClose, onDone }: { siteId: string; meter: Meter | null; onClose: () => void; onDone: (message: string, meterId?: string) => void }) {
  const [form, setForm] = useState({
    name: meter?.name ?? "Tablero general", scope: meter?.scope ?? "GENERAL", source: meter?.source === "API" ? "API" : "ARCHIVO",
    brand: meter?.device_brand ?? "Circutor", model: meter?.device_model ?? "", serial: meter?.device_serial ?? "",
    nominal: meter ? String(meter.nominal_v_ln) : "127", interval: meter?.interval_minutes ? String(meter.interval_minutes) : "",
  });
  const [active, setActive] = useState(meter?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const isInverter = meter?.kind === "INVERSOR";
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    const outcome = await sendEnergyCommand({ op: "MEDIDOR_GUARDAR", payload: {
      ...(meter ? { meter_id: meter.id } : { site_id: siteId, kind: "ANALIZADOR" as const }),
      name: form.name, scope: form.scope as Meter["scope"], ...(isInverter ? {} : { source: form.source as "ARCHIVO" | "API" }),
      device_brand: form.brand, device_model: form.model, device_serial: form.serial,
      nominal_v_ln: num(form.nominal) ?? 127, interval_minutes: num(form.interval), active,
    } });
    setBusy(false);
    if (!outcome.ok) { setError(outcome.message); return; }
    onDone(outcome.message, String(outcome.data.meter_id ?? ""));
  }
  return (
    <Modal title={meter ? "Editar medidor" : "Nuevo medidor"} onClose={onClose}>
      <form className="crm-form" onSubmit={submit}>
        <p className="crm-dialog-lead">Un medidor es un punto de medición: el tablero general o un área, una línea o una máquina con su propio analizador.</p>
        <label className="crm-field">Nombre<input required value={form.name} onChange={set("name")} placeholder="Tablero general, Línea de corte…" /></label>
        <div className="crm-field-row">
          <label className="crm-field">Qué mide<select value={form.scope} onChange={set("scope")}>{METER_SCOPES.map((s) => <option key={s} value={s}>{SCOPE_LABELS[s]}</option>)}</select></label>
          {isInverter ? null : (
            <label className="crm-field">Cómo llegan los datos<select value={form.source} onChange={set("source")}>
              <option value="ARCHIVO">Archivo del analizador</option><option value="API">En vivo por API</option>
            </select></label>
          )}
        </div>
        <div className="crm-field-row">
          <label className="crm-field">Marca<input value={form.brand} onChange={set("brand")} /></label>
          <label className="crm-field">Modelo<input value={form.model} onChange={set("model")} placeholder="Opcional" /></label>
        </div>
        <div className="crm-field-row">
          <label className="crm-field">Tensión nominal fase-neutro (V)<select value={form.nominal} onChange={set("nominal")}>
            {["127", "220", "254", "277"].map((v) => <option key={v} value={v}>{v} V</option>)}
          </select></label>
          <label className="crm-field">Una lectura cada (min)<input inputMode="decimal" value={form.interval} onChange={set("interval")} placeholder="Se detecta al cargar" /></label>
        </div>
        <label className="crm-field">Número de serie<input value={form.serial} onChange={set("serial")} placeholder="Opcional" /></label>
        {meter ? <label className="med-day"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Activo (si se apaga, deja de recibir lecturas)</label> : null}
        {error ? <p className="crm-error" role="alert">{error}</p> : null}
        <div className="crm-dialog-actions">
          <button type="button" className="crm-button" onClick={onClose}>Cancelar</button>
          <button type="submit" className="crm-button" data-primary="true" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Importar el Excel del analizador. El archivo se lee aquí, en el navegador (no sube al servidor):
 * se muestra qué se reconoció y, al confirmar, las lecturas se guardan en tandas y se recalculan las alertas.
 */
export function ImportDialog({ meter, timeZone, onClose, onDone }: { meter: Meter; timeZone: string; onClose: () => void; onDone: (message: string) => void }) {
  const [file, setFile] = useState<{ name: string; parsed: CircutorFile } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    if (!chosen) return;
    setError(null); setFile(null); setBusy("Leyendo el archivo…");
    try {
      if (!/\.xlsx$/i.test(chosen.name)) throw new Error("FORMAT");
      if (chosen.size > 120 * 1024 * 1024) throw new Error("SIZE");
      const sheets = await readXlsxBytes(new Uint8Array(await chosen.arrayBuffer()), browserInflate);
      const parsed = readCircutorWorkbook(sheets);
      if (!parsed.rows.length) throw new Error("EMPTY");
      setFile({ name: chosen.name, parsed });
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "FORMAT" ? "Sube el Excel (.xlsx) que exporta el software del analizador. Los archivos .STD se exportan primero a Excel."
        : code === "SIZE" ? "El archivo pesa más de 120 MB. Expórtalo por semanas."
          : code === "EMPTY" ? "No encontré lecturas: la columna A debe traer la fecha y hora, con los encabezados del analizador arriba."
            : "No se pudo leer el archivo. Ábrelo y guárdalo de nuevo como .xlsx.");
    } finally {
      setBusy(null);
    }
  }
  async function confirm() {
    if (!file) return;
    setError(null);
    const { rows, intervalMinutes, first, last } = file.parsed;
    const outcome = await uploadReadings(meter.id, rows, intervalMinutes, (done, total) => setBusy(`Guardando ${fmt(done)} de ${fmt(total)} lecturas…`));
    if (!outcome.ok) { setBusy(null); setError(outcome.message); return; }
    setBusy("Calculando alertas…");
    const since = first ? plantLocalToIso(first, timeZone) : null;
    const until = last ? plantLocalToIso(last, timeZone) : null;
    let alerts = "";
    if (since && until) {
      const evaluated = await evaluateMeterAlerts(meter.id, since, new Date(Date.parse(until) + 60000).toISOString());
      alerts = evaluated.ok ? ` ${evaluated.message}` : " Las alertas se calculan en la siguiente vuelta (15 min).";
    }
    setBusy(null);
    onDone(`${outcome.message}${alerts}`);
  }
  const p = file?.parsed;
  return (
    <Modal title={`Cargar archivo · ${meter.name}`} onClose={onClose} wide>
      <div className="crm-form">
        <p className="crm-dialog-lead">Sube el Excel que exporta el software del analizador (por ejemplo, PowerVision de Circutor), con una hoja por magnitud y la fecha y hora en la columna A. Las horas se toman como hora de la planta. Si una lectura ya existía, se actualiza.</p>
        <label className="crm-file">
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={choose} disabled={Boolean(busy)} />
          <span>{file ? `Archivo: ${file.name} · elegir otro` : "Elegir archivo .xlsx"}</span>
        </label>
        {busy ? <p className="crm-muted" role="status">{busy}</p> : null}
        {error ? <p className="crm-error" role="alert">{error}</p> : null}
        {p ? (
          <>
            <div className="crm-import-summary">
              <div data-tone="good"><strong>{fmt(p.rows.length)}</strong><span>lecturas</span></div>
              <div><strong>{p.intervalMinutes ? `${fmt(p.intervalMinutes)} min` : "Sin dato"}</strong><span>entre lecturas</span></div>
              <div><strong>{fmt(p.fields.length)}</strong><span>columnas reconocidas</span></div>
              <div data-tone="info"><strong>{fmt(p.harmonicReadings)}</strong><span>con armónicos</span></div>
            </div>
            <p className="crm-muted">Del {p.first?.replace("T", " ")} al {p.last?.replace("T", " ")} (hora de la planta).</p>
            <ul className="med-sheet-list">
              {p.sheets.map((s) => <li key={s.name} data-ok={s.recognized ? "true" : "false"}>{s.recognized ? "✓" : "—"} {s.name}{s.recognized ? ` · ${s.columns} columnas` : " · no se reconoció"}</li>)}
            </ul>
            {p.warnings.map((w) => <p key={w} className="crm-muted">{w}</p>)}
          </>
        ) : null}
        <div className="crm-dialog-actions">
          <button type="button" className="crm-button" onClick={onClose}>Cancelar</button>
          <button type="button" className="crm-button" data-primary="true" disabled={!p || Boolean(busy)} onClick={() => void confirm()}>
            {p ? `Guardar ${fmt(p.rows.length)} lecturas` : "Guardar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Conectar una planta de Growatt con el token de la API. Primero se prueba el token (lista las plantas),
 * luego se elige la planta. El token se cifra en el servidor; aquí no se guarda.
 */
export function GrowattDialog({ site, onClose, onDone }: { site: Site; onClose: () => void; onDone: (message: string) => void }) {
  const [token, setToken] = useState("");
  const [region, setRegion] = useState("auto");
  const [found, setFound] = useState<{ base: string; plants: GrowattPlantOption[] } | null>(null);
  const [plant, setPlant] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function probe(event: FormEvent) {
    event.preventDefault();
    setError(null); setFound(null); setBusy("Probando el token con Growatt…");
    const result = await testGrowatt(token.trim(), region);
    setBusy(null);
    if (!result.ok) { setError(result.message); return; }
    setFound(result.data);
    setPlant(result.data.plants[0]?.id ?? "");
  }
  async function connect() {
    if (!found || !plant) return;
    setError(null); setBusy("Conectando la planta…");
    const chosen = found.plants.find((p) => p.id === plant);
    const result = await connectGrowatt({ token: token.trim(), base: found.base, plant_id: plant, plant_name: chosen?.name, site_id: site.id });
    setBusy(null);
    if (!result.ok) { setError(result.message); return; }
    onDone(result.message);
  }
  return (
    <Modal title={`Conectar Growatt · ${site.client_name}`} onClose={onClose}>
      <form className="crm-form" onSubmit={probe}>
        <p className="crm-dialog-lead">El token lo saca el dueño de la cuenta en la app ShinePhone (Yo → nombre de usuario → API Token) o el instalador desde OSS. No vence. Growatt deja listar las plantas solo 10 veces al día.</p>
        <div className="crm-field-row">
          <label className="crm-field">Token de la API<input required value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} placeholder="32 letras y números" /></label>
          <label className="crm-field">Servidor<select value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="auto">Automático (internacional y luego Norteamérica)</option>
            <option value="global">Internacional</option><option value="us">Norteamérica</option><option value="cn">China</option><option value="au">Australia</option>
          </select></label>
        </div>
        {!found ? (
          <div className="crm-dialog-actions">
            <button type="button" className="crm-button" onClick={onClose}>Cancelar</button>
            <button type="submit" className="crm-button" data-primary="true" disabled={Boolean(busy) || token.trim().length < 20}>{busy ?? "Probar token"}</button>
          </div>
        ) : null}
      </form>
      {found ? (
        <div className="crm-form">
          <fieldset className="crm-fieldset">
            <legend>Plantas que ve este token</legend>
            {found.plants.map((p) => (
              <label key={p.id} className="med-day">
                <input type="radio" name="plant" value={p.id} checked={plant === p.id} onChange={() => setPlant(p.id)} />
                {p.name}{p.peak_kw ? ` · ${fmt(p.peak_kw)} kWp` : ""}{p.city ? ` · ${p.city}` : ""}
              </label>
            ))}
          </fieldset>
          <p className="crm-muted">Se crea un medidor para la planta completa y uno por inversor. Los datos se jalan cada 15 minutos.</p>
          {busy ? <p className="crm-muted" role="status">{busy}</p> : null}
          <div className="crm-dialog-actions">
            <button type="button" className="crm-button" onClick={onClose}>Cancelar</button>
            <button type="button" className="crm-button" data-primary="true" disabled={Boolean(busy) || !plant} onClick={() => void connect()}>Conectar planta</button>
          </div>
        </div>
      ) : null}
      {error ? <p className="crm-error med-dialog-error" role="alert">{error}</p> : null}
    </Modal>
  );
}
