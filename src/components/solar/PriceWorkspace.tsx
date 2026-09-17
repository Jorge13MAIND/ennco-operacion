"use client";

import { useState } from "react";

import { Panel, PageHeader, useMutation, useResource } from "@/components/solar/ui";
import { fxFor, periodLabel, periodsIn, priceAll, type ItemPricing } from "@/lib/precios/pricing";
import { EQUIPMENT_CATEGORY, type PriceCatalog, type PriceItem, type Supplier } from "@/lib/precios/types";

/* Precios y proveedores: el Excel de ENNCO hecho pantalla. Materiales por categoria con el precio
   vigente de cada proveedor, el costo que fija la regla y el precio final con IVA y margen;
   captura del precio del mes en la misma tabla; comparativa de inversores y paneles; ajustes;
   importar y exportar Excel. */

type Tab = "materiales" | "equipo" | "proveedores" | "ajustes" | "excel";
const nf = (d: number) => new Intl.NumberFormat("es-MX", { minimumFractionDigits: d, maximumFractionDigits: d });
const n = (v: number | null | undefined, d = 2) => (typeof v === "number" && Number.isFinite(v) ? nf(d).format(v) : "—");
const money = (v: number | null | undefined, cur: string) => (typeof v === "number" && Number.isFinite(v) ? `${cur === "USD" ? "US$" : "$"} ${nf(2).format(v)}` : "—");
const thisMonth = () => new Date().toISOString().slice(0, 7);

function PriceCell({ item, supplier, period, value, onSaved }: { item: PriceItem; supplier: Supplier; period: string; value: number | null; onSaved: () => Promise<unknown> }) {
  const [draft, setDraft] = useState<string | null>(null);
  const m = useMutation(onSaved);
  const commit = async () => {
    if (draft === null) return;
    const v = Number(draft.replace(/,/g, ""));
    if (draft.trim() !== "" && !Number.isFinite(v)) { setDraft(null); return; }
    if ((draft.trim() === "" && value == null) || v === value) { setDraft(null); return; }
    await m.run("/api/v1/precios/precio", { itemId: item.id, supplierId: supplier.id, period, unitPrice: draft.trim() === "" ? 0 : v, source: "captura" });
    setDraft(null);
  };
  return (
    <input aria-label={`${item.name} · ${supplier.name} · ${periodLabel(period)}`} className={`px-cell${m.pending ? " is-busy" : ""}${m.error ? " is-bad" : ""}`} inputMode="decimal"
      onBlur={() => void commit()} onChange={(e) => setDraft(e.target.value)} onFocus={() => setDraft(value == null ? "" : String(value))} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setDraft(null); }}
      placeholder="capturar" title={m.error ?? undefined} value={draft ?? (value == null ? "" : String(value))} />
  );
}

export function PriceWorkspace({ catalogModels, initial }: { catalogModels: { modules: string[]; inverters: string[] }; initial?: PriceCatalog | null }) {
  const resource = useResource<{ catalog: PriceCatalog }>("/api/v1/precios/catalogo");
  const catalog = resource.data?.catalog ?? initial ?? null;
  const [tab, setTab] = useState<Tab>("materiales");
  const [period, setPeriod] = useState<string>(thisMonth());
  const [category, setCategory] = useState<string>("");
  const [search, setSearch] = useState("");
  const reload = async () => { await resource.reload(); };

  const priced = catalog ? priceAll(catalog) : [];
  const categories = [...new Set((catalog?.items ?? []).map((i) => i.category))];
  const periods = (() => { const p = catalog ? periodsIn(catalog) : []; const cur = thisMonth(); return p.includes(cur) ? p : [cur, ...p]; })();
  const suppliersActive = (catalog?.suppliers ?? []).filter((s) => s.active);

  const isEquipment = (p: ItemPricing) => p.item.category === "Inversores" || p.item.category === "Paneles";
  const visible = priced.filter((p) => (tab === "equipo" ? isEquipment(p) : !isEquipment(p)) && (!category || p.item.category === category) && (!search || `${p.item.name} ${p.item.category}`.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es"))));
  const hasUsd = visible.some((p) => p.item.currency === "USD");
  const quoteAt = (itemId: string, supplierId: string, per: string) => catalog?.quotes.find((q) => q.itemId === itemId && q.supplierId === supplierId && q.period.slice(0, 7) === per)?.unitPrice ?? null;

  return (
    <main className="shell section operations-main projects-page px-page" id="main-content" tabIndex={-1}>
      <PageHeader title="Precios y proveedores" description="La tabla comparativa de precios de ENNCO. Cada material tiene el precio vigente de cada proveedor; el costo lo fija la regla (el más alto, por seguridad) y el precio final le suma IVA y margen. Captura el precio del mes directo en la tabla.">
        <a className="projects-button secondary" href="/api/v1/precios/exportar">Descargar Excel</a>
      </PageHeader>
      <nav className="projects-tabs eng-tabs" aria-label="Secciones">
        {([["materiales", "Materiales"], ["equipo", "Inversores y paneles"], ["proveedores", "Proveedores"], ["ajustes", "Ajustes"], ["excel", "Importar Excel"]] as Array<[Tab, string]>).map(([k, l]) => (
          <button aria-current={tab === k ? "page" : undefined} className="projects-button secondary eng-tab" key={k} onClick={() => setTab(k)} type="button"><span>{l}</span></button>
        ))}
      </nav>
      {resource.loading && !catalog ? <p className="projects-help">Cargando precios…</p> : null}
      {resource.error ? <div className="projects-notice" data-tone="danger">{resource.error}</div> : null}
      {!catalog ? null : (tab === "materiales" || tab === "equipo") ? (
        <Panel title={tab === "equipo" ? "Comparativa de inversores y paneles" : "Materiales"} description={`Precio vigente por proveedor (su cotización más reciente), costo según la regla ${catalog.settings.priceRule === "MAX" ? "máximo" : catalog.settings.priceRule === "MIN" ? "mínimo" : "promedio"} y precio final con IVA ${n(catalog.settings.iva * 100, 0)} % y margen ${n(catalog.settings.margin * 100, 0)} %. La columna del mes elegido se puede escribir.`}>
          <div className="px-toolbar">
            <input aria-label="Buscar material" className="px-search" onChange={(e) => setSearch(e.target.value)} placeholder="Buscar material…" type="search" value={search} />
            {tab === "materiales" ? <select aria-label="Categoría" onChange={(e) => setCategory(e.target.value)} value={category}><option value="">Todas las categorías</option>{categories.filter((c) => c !== "Inversores" && c !== "Paneles").map((c) => <option key={c} value={c}>{c}</option>)}</select> : null}
            <label className="px-inline">Capturar mes <select aria-label="Mes de captura" onChange={(e) => setPeriod(e.target.value)} value={period}>{periods.map((p) => <option key={p} value={p}>{periodLabel(`${p}-01`)}</option>)}</select></label>
            <NewItem categories={categories} catalogModels={catalogModels} onSaved={reload} defaultCategory={tab === "equipo" ? "Inversores" : category || "Cableado"} />
          </div>
          {visible.length === 0 ? <p className="projects-help">No hay materiales que coincidan. Agrega uno o importa el Excel.</p> : (
            <div className="projects-table-wrap px-wrap">
              <table className="projects-table px-table">
                <thead><tr>
                  <th>Material</th><th>Unidad</th>
                  <th>Precios por proveedor <small>captura de {periodLabel(`${period}-01`)}</small></th>
                  <th className="num">Costo</th><th className="num">Precio final</th>{hasUsd ? <th className="num">Final MXN</th> : null}
                </tr></thead>
                <tbody>
                  {groupBy(visible, (p) => p.item.category).map(([cat, rows]) => (
                    <GroupRows colSpan={hasUsd ? 6 : 5} key={cat} title={cat}>
                      {rows.map((p) => (
                        <tr key={p.item.id}>
                          <td><strong>{p.item.name}</strong>{p.item.equipment ? <small className="px-link">ligado al cotizador · {p.item.equipment.model}</small> : null}</td>
                          <td>{p.item.unit}<small className="px-muted">{p.item.currency}</small></td>
                          <td className="px-prices">
                            {p.bySupplier.map((sp) => {
                              const inMonth = quoteAt(p.item.id, sp.supplier.id, period);
                              return (
                                <div className={`px-sup${p.costSupplier?.id === sp.supplier.id ? " is-chosen" : ""}`} key={sp.supplier.id}>
                                  <span className="px-sup-name">{sp.supplier.name}</span>
                                  <PriceCell item={p.item} onSaved={reload} period={`${period}-01`} supplier={sp.supplier} value={inMonth} />
                                  <small className="px-muted">{inMonth == null ? `últ. ${n(sp.unitPrice)} · ${periodLabel(sp.period)}` : periodLabel(`${period}-01`)}</small>
                                </div>
                              );
                            })}
                            <AddSupplierPrice item={p.item} onSaved={reload} period={`${period}-01`} suppliers={suppliersActive.filter((s) => !p.bySupplier.some((x) => x.supplier.id === s.id))} />
                          </td>
                          <td className="num"><strong>{money(p.cost, p.item.currency)}</strong>{p.costSupplier ? <small className="px-muted">{p.costSupplier.name}</small> : <small className="px-muted">sin precio</small>}</td>
                          <td className="num"><strong>{money(p.finalPrice, p.item.currency)}</strong><small className="px-muted">margen {n(p.marginApplied * 100, 0)} %</small></td>
                          {hasUsd ? <td className="num">{p.item.currency === "USD" ? <>{money(p.finalMxn, "MXN")}<small className="px-muted">{p.fx ? `× ${n(p.fx, 4)}` : "sin tipo de cambio"}</small></> : "—"}</td> : null}
                        </tr>
                      ))}
                    </GroupRows>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ) : tab === "proveedores" ? (
        <Suppliers catalog={catalog} onSaved={reload} />
      ) : tab === "ajustes" ? (
        <Settings catalog={catalog} categories={categories} onSaved={reload} />
      ) : (
        <ImportExcel onSaved={reload} />
      )}
    </main>
  );
}

function AddSupplierPrice({ item, suppliers, period, onSaved }: { item: PriceItem; suppliers: Supplier[]; period: string; onSaved: () => Promise<unknown> }) {
  const [supplierId, setSupplierId] = useState(""); const [price, setPrice] = useState(""); const m = useMutation(onSaved);
  if (!suppliers.length) return null;
  if (!supplierId) return <button className="px-add" onClick={() => setSupplierId(suppliers[0]!.id)} type="button">+ otro proveedor</button>;
  return (
    <div className="px-sup is-new">
      <select aria-label="Proveedor" onChange={(e) => setSupplierId(e.target.value)} value={supplierId}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <input aria-label="Precio" className="px-cell" inputMode="decimal" onChange={(e) => setPrice(e.target.value)} placeholder="precio" value={price} />
      <button className="px-add" disabled={m.pending || !(Number(price) > 0)} onClick={async () => { if (await m.run("/api/v1/precios/precio", { itemId: item.id, supplierId, period, unitPrice: Number(price), source: "captura" })) { setSupplierId(""); setPrice(""); } }} type="button">Guardar</button>
      <button className="px-add" onClick={() => setSupplierId("")} type="button">×</button>
      {m.error ? <small className="solar-act-error">{m.error}</small> : null}
    </div>
  );
}

function groupBy<T>(rows: T[], key: (r: T) => string): Array<[string, T[]]> {
  const out = new Map<string, T[]>(); for (const r of rows) { const k = key(r); if (!out.has(k)) out.set(k, []); out.get(k)!.push(r); } return [...out.entries()];
}
function GroupRows({ title, colSpan, children }: { title: string; colSpan: number; children: React.ReactNode }) {
  return <><tr className="px-group"><td colSpan={colSpan}>{title}</td></tr>{children}</>;
}

function NewItem({ categories, catalogModels, onSaved, defaultCategory }: { categories: string[]; catalogModels: { modules: string[]; inverters: string[] }; onSaved: () => Promise<unknown>; defaultCategory: string }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ category: defaultCategory, name: "", unit: "Pzs", currency: "MXN" as "MXN" | "USD", link: "" });
  const m = useMutation(onSaved);
  const submit = async () => {
    const equipment = f.link ? { kind: (catalogModels.inverters.includes(f.link) ? "inverter" : "module") as "inverter" | "module", model: f.link } : null;
    const r = await m.run("/api/v1/precios/material", { category: f.category || defaultCategory, name: f.name, unit: f.unit, currency: f.currency, equipment });
    if (r) { setOpen(false); setF({ ...f, name: "", link: "" }); }
  };
  if (!open) return <button className="projects-button" onClick={() => { setF({ ...f, category: defaultCategory, currency: defaultCategory === "Inversores" || defaultCategory === "Paneles" || defaultCategory === EQUIPMENT_CATEGORY ? "USD" : "MXN" }); setOpen(true); }} type="button">Nuevo material</button>;
  return (
    <div className="px-new">
      <input list="px-cats" onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Categoría" value={f.category} /><datalist id="px-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <input onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Nombre del material" value={f.name} />
      <input onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="Unidad" value={f.unit} style={{ width: 70 }} />
      <select onChange={(e) => setF({ ...f, currency: e.target.value as "MXN" | "USD" })} value={f.currency}><option value="MXN">MXN</option><option value="USD">USD</option></select>
      <input list="px-models" onChange={(e) => setF({ ...f, link: e.target.value })} placeholder="Ligar al cotizador (opcional)" value={f.link} /><datalist id="px-models">{[...catalogModels.modules, ...catalogModels.inverters].map((mo) => <option key={mo} value={mo} />)}</datalist>
      <button className="projects-button" disabled={m.pending || !f.name.trim()} onClick={() => void submit()} type="button">Guardar</button>
      <button className="projects-button secondary" onClick={() => setOpen(false)} type="button">Cancelar</button>
      {m.error ? <span className="solar-act-error">{m.error}</span> : null}
    </div>
  );
}

function Suppliers({ catalog, onSaved }: { catalog: PriceCatalog; onSaved: () => Promise<unknown> }) {
  const [name, setName] = useState(""); const m = useMutation(onSaved);
  const count = (id: string) => new Set(catalog.quotes.filter((q) => q.supplierId === id).map((q) => q.itemId)).size;
  return (
    <Panel title="Proveedores" description="Un proveedor inactivo deja de contar para el costo pero conserva su historial.">
      <div className="px-new"><input onChange={(e) => setName(e.target.value)} placeholder="Nuevo proveedor" value={name} /><button className="projects-button" disabled={m.pending || !name.trim()} onClick={async () => { if (await m.run("/api/v1/precios/proveedor", { name })) setName(""); }} type="button">Agregar</button>{m.error ? <span className="solar-act-error">{m.error}</span> : null}</div>
      <table className="projects-table"><thead><tr><th>Proveedor</th><th className="num">Materiales con precio</th><th>Estado</th><th></th></tr></thead>
        <tbody>{catalog.suppliers.map((s) => (
          <tr key={s.id}><td><strong>{s.name}</strong></td><td className="num">{count(s.id)}</td><td>{s.active ? "Activo" : "Inactivo"}</td>
            <td className="solar-actions"><button className="solar-act" onClick={() => void m.run("/api/v1/precios/proveedor", { id: s.id, name: s.name, active: !s.active })} type="button">{s.active ? "Desactivar" : "Activar"}</button></td></tr>
        ))}</tbody></table>
    </Panel>
  );
}

function Settings({ catalog, categories, onSaved }: { catalog: PriceCatalog; categories: string[]; onSaved: () => Promise<unknown> }) {
  const [s, setS] = useState({ ...catalog.settings });
  const [fxMonth, setFxMonth] = useState(thisMonth()); const [fxValue, setFxValue] = useState("");
  const m = useMutation(onSaved);
  const save = () => void m.run("/api/v1/precios/ajustes", s);
  const fxEntries = Object.entries(s.fxByPeriod).sort(([a], [b]) => (a < b ? 1 : -1));
  return (
    <div className="eng-grid">
      <Panel title="Regla de precio" description="Así se calcula el precio final de cada material, como el $ FINAL del Excel.">
        <div className="eng-form">
          <label className="eng-field"><span>Costo que se toma</span><select onChange={(e) => setS({ ...s, priceRule: e.target.value as "MAX" | "MIN" | "AVG" })} value={s.priceRule}><option value="MAX">El más alto entre proveedores (como el Excel)</option><option value="MIN">El más bajo</option><option value="AVG">El promedio</option></select></label>
          <label className="eng-field"><span>IVA</span><input inputMode="decimal" onChange={(e) => setS({ ...s, iva: Number(e.target.value) / 100 })} step={0.5} type="number" value={Math.round(s.iva * 10000) / 100} /><small>%</small></label>
          <label className="eng-field"><span>Margen general</span><input inputMode="decimal" onChange={(e) => setS({ ...s, margin: Number(e.target.value) / 100 })} step={1} type="number" value={Math.round(s.margin * 10000) / 100} /><small>%</small></label>
        </div>
        <h4 className="solar-h3">Margen por categoría (vacío usa el general)</h4>
        <div className="eng-form is-tight">
          {categories.map((c) => (
            <label className="eng-field" key={c}><span>{c}</span><input inputMode="decimal" onChange={(e) => { const v = e.target.value; const next = { ...s.marginByCategory }; if (v === "") delete next[c]; else next[c] = Number(v) / 100; setS({ ...s, marginByCategory: next }); }} placeholder={`${Math.round(s.margin * 100)}`} type="number" value={s.marginByCategory[c] == null ? "" : Math.round(s.marginByCategory[c]! * 10000) / 100} /></label>
          ))}
        </div>
        <div className="eng-form is-tight" style={{ marginTop: 12 }}><button className="projects-button" disabled={m.pending} onClick={save} type="button">Guardar ajustes</button>{m.success ? <span className="projects-help">Guardado.</span> : null}{m.error ? <span className="solar-act-error">{m.error}</span> : null}</div>
      </Panel>
      <Panel title="Tipo de cambio por mes" description="Para convertir a pesos el equipo cotizado en dólares. Cada mes usa el suyo o el más reciente anterior.">
        <div className="px-new"><input onChange={(e) => setFxMonth(e.target.value)} type="month" value={fxMonth} /><input inputMode="decimal" onChange={(e) => setFxValue(e.target.value)} placeholder="Pesos por dólar" step={0.0001} type="number" value={fxValue} />
          <button className="projects-button" disabled={m.pending || !(Number(fxValue) > 0)} onClick={() => { const next = { ...s, fxByPeriod: { ...s.fxByPeriod, [`${fxMonth}-01`]: Number(fxValue) } }; setS(next); void m.run("/api/v1/precios/ajustes", next); setFxValue(""); }} type="button">Guardar</button></div>
        <table className="projects-table"><thead><tr><th>Mes</th><th className="num">MXN por USD</th></tr></thead><tbody>{fxEntries.map(([k, v]) => <tr key={k}><td>{periodLabel(k)}</td><td className="num">{n(v, 4)}</td></tr>)}</tbody></table>
        {!fxEntries.length ? <p className="projects-help">Sin tipo de cambio: el equipo en dólares no se puede mostrar en pesos.</p> : <p className="projects-help">Vigente hoy: {n(fxFor(s, `${thisMonth()}-01`), 4)}</p>}
      </Panel>
    </div>
  );
}

function ImportExcel({ onSaved }: { onSaved: () => Promise<unknown> }) {
  const [file, setFile] = useState<File | null>(null); const [year, setYear] = useState(String(new Date().getFullYear()));
  const [preview, setPreview] = useState<{ report: { sheets: Array<{ name: string; kind: string; items: number; quotes: number }>; warnings: string[] }; suppliers: string[]; items: number; quotes: number; fxByPeriod: Record<string, number> } | null>(null);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ tone: "info" | "danger" | "success"; text: string } | null>(null);
  const send = async (previa: boolean) => {
    if (!file) return; setBusy(true); setMsg(null);
    const fd = new FormData(); fd.append("archivo", file); fd.append("anio", year);
    try {
      const res = await fetch(`/api/v1/precios/importar${previa ? "?previa=1" : ""}`, { method: "POST", body: fd, credentials: "same-origin" });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setMsg({ tone: "danger", text: data?.error === "PRICE_FILE_INVALID" ? "No pude leer ese archivo como Excel." : data?.error === "SOLAR_FORBIDDEN" ? "Tu rol no permite importar." : "No se pudo importar." }); return; }
      if (previa) setPreview(data);
      else { setPreview(null); setMsg({ tone: "success", text: `Listo: ${data.result.items} materiales actualizados, ${data.result.suppliers} proveedores nuevos.` }); await onSaved(); }
    } catch { setMsg({ tone: "danger", text: "Sin conexión." }); } finally { setBusy(false); }
  };
  return (
    <Panel title="Importar el Excel de precios" description="Sube la Tabla comparativa de precios tal como la llevas: hojas de materiales por mes (Regina, Lista proyectos) y comparativas de inversores y paneles. Primero se muestra qué se leyó; nada se guarda hasta que confirmes.">
      <div className="px-new">
        <input accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setMsg(null); }} type="file" />
        <label className="px-inline">Año de los meses <input onChange={(e) => setYear(e.target.value)} style={{ width: 80 }} type="number" value={year} /></label>
        <button className="projects-button secondary" disabled={!file || busy} onClick={() => void send(true)} type="button">Revisar</button>
        <button className="projects-button" disabled={!preview || busy} onClick={() => void send(false)} type="button">Importar</button>
      </div>
      {msg ? <div className="projects-notice" data-tone={msg.tone}>{msg.text}</div> : null}
      {preview ? (
        <div className="eng-rows" style={{ marginTop: 12 }}>
          {preview.report.sheets.map((s) => <div className="eng-row" key={s.name}><span>Hoja {s.name} <small>{s.kind}</small></span><strong>{s.items} materiales · {s.quotes} precios</strong></div>)}
          <div className="eng-row"><span>Proveedores</span><strong>{preview.suppliers.join(", ")}</strong></div>
          <div className="eng-row"><span>Total tras unir hojas</span><strong>{preview.items} materiales · {preview.quotes} precios</strong></div>
          <div className="eng-row"><span>Tipo de cambio leído</span><strong>{Object.entries(preview.fxByPeriod).map(([k, v]) => `${periodLabel(k)} ${n(v, 4)}`).join(" · ") || "ninguno"}</strong></div>
          {preview.report.warnings.length ? <ul className="eng-warnings">{preview.report.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
        </div>
      ) : null}
    </Panel>
  );
}
