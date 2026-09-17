"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Route } from "next";

import { Panel, PageHeader, useMutation } from "@/components/solar/ui";
import { fxFor, priceAll, type ItemPricing } from "@/lib/precios/pricing";
import { PROJECT_STATUS_LABEL, type PriceCatalog, type ProjectItem, type ProjectStatus, type SolarProject } from "@/lib/precios/types";

/* Un proyecto: datos, lista de materiales con cantidades tomadas del catalogo de precios,
   totales contra el precio de venta de la cotizacion y orden de compra por proveedor. */

const mx = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 });
const nf = (d: number) => new Intl.NumberFormat("es-MX", { minimumFractionDigits: d, maximumFractionDigits: d });
const lineMxn = (i: ProjectItem) => i.quantity * i.unitCost * (i.currency === "USD" ? (i.fx ?? 0) : 1);

export function ProjectWorkspace({ project, catalog, quote }: { project: SolarProject; catalog: PriceCatalog; quote: { id: string; name: string; cashPrice: number | null; systemKw: number | null; modules: number | null } | null }) {
  const router = useRouter();
  const [p, setP] = useState<SolarProject>(project);
  const [items, setItems] = useState<ProjectItem[]>(project.items);
  const [search, setSearch] = useState("");
  const [dirty, setDirty] = useState(false);
  const m = useMutation();
  const priced = priceAll(catalog);
  const fxNow = fxFor(catalog.settings, `${new Date().toISOString().slice(0, 7)}-01`);
  const matches = search.trim().length >= 2 ? priced.filter((x) => `${x.item.name} ${x.item.category}`.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es"))).slice(0, 12) : [];

  const add = (x: ItemPricing) => {
    const supplier = x.costSupplier;
    setItems((s) => [...s, { itemId: x.item.id, description: x.item.name, unit: x.item.unit, quantity: 1, supplierId: supplier?.id ?? null, unitCost: x.cost ?? 0, currency: x.item.currency, fx: x.item.currency === "USD" ? (x.fx ?? fxNow) : null, sort: s.length, purchased: false }]);
    setSearch(""); setDirty(true);
  };
  const addFree = () => { setItems((s) => [...s, { itemId: null, description: "Partida libre", unit: "Pzs", quantity: 1, supplierId: null, unitCost: 0, currency: "MXN", fx: null, sort: s.length, purchased: false }]); setDirty(true); };
  const patch = (i: number, v: Partial<ProjectItem>) => { setItems((s) => s.map((it, k) => (k === i ? { ...it, ...v } : it))); setDirty(true); };
  const remove = (i: number) => { setItems((s) => s.filter((_, k) => k !== i)); setDirty(true); };
  const pickSupplier = (i: number, supplierId: string) => {
    const it = items[i]!; const x = priced.find((y) => y.item.id === it.itemId);
    const sp = x?.bySupplier.find((y) => y.supplier.id === supplierId);
    patch(i, { supplierId: supplierId || null, unitCost: sp ? sp.unitPrice : it.unitCost });
  };
  const save = async () => {
    const r = await m.run<{ project: SolarProject }>("/api/v1/solar/proyectos", { id: p.id, name: p.name, customer: p.customer, quoteId: p.quoteId, status: p.status, notes: p.notes, items: items.map((it, k) => ({ ...it, sort: k })) });
    if (r?.project) { setP(r.project); setItems(r.project.items); setDirty(false); }
  };
  const del = async () => {
    if (!window.confirm("¿Borrar este proyecto y su lista de materiales? No se puede deshacer.")) return;
    const r = await m.run(`/api/v1/solar/proyectos/${p.id}`, undefined, "DELETE");
    if (r) router.push("/operacion/proyectos/lista" as Route);
  };
  const cost = items.reduce((a, i) => a + lineMxn(i), 0);
  const sale = quote?.cashPrice ?? null;
  const groups = new Map<string, ProjectItem[]>();
  for (const it of items) { const k = it.supplierId ?? ""; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(it); }
  const bySupplier = [...groups.entries()].map(([id, rows]) => ({ id, name: catalog.suppliers.find((s) => s.id === id)?.name ?? "Sin proveedor", rows }));

  return (
    <main className="shell section operations-main projects-page" id="main-content" tabIndex={-1}>
      <PageHeader title={p.name} description={p.customer ? `Cliente: ${p.customer}` : "Proyecto sin cliente capturado."}>
        <Link className="projects-button secondary" href={"/operacion/proyectos/lista" as Route}>Todos los proyectos</Link>
        <button className="projects-button secondary" onClick={() => window.print()} type="button">Imprimir / PDF</button>
        <button className="projects-button" disabled={m.pending || !dirty} onClick={() => void save()} type="button">{m.pending ? "Guardando…" : dirty ? "Guardar cambios" : "Guardado"}</button>
      </PageHeader>
      {m.error ? <div className="projects-notice" data-tone="danger">{m.error}</div> : null}
      <div className="eng-grid">
        <Panel title="Datos del proyecto">
          <div className="eng-form">
            <label className="eng-field"><span>Nombre</span><input onChange={(e) => { setP({ ...p, name: e.target.value }); setDirty(true); }} type="text" value={p.name} /></label>
            <label className="eng-field"><span>Cliente</span><input onChange={(e) => { setP({ ...p, customer: e.target.value }); setDirty(true); }} type="text" value={p.customer ?? ""} /></label>
            <label className="eng-field"><span>Estado</span><select onChange={(e) => { setP({ ...p, status: e.target.value as ProjectStatus }); setDirty(true); }} value={p.status}>{(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>)}</select></label>
            <label className="eng-field"><span>Notas</span><input onChange={(e) => { setP({ ...p, notes: e.target.value }); setDirty(true); }} type="text" value={p.notes ?? ""} /></label>
          </div>
          {quote ? <div className="eng-rows" style={{ marginTop: 12 }}><div className="eng-row"><span>Cotización ligada</span><strong><Link href={`/operacion/proyectos/cotizar?cotizacion=${quote.id}` as Route}>{quote.name}</Link></strong></div><div className="eng-row"><span>Sistema</span><strong>{quote.systemKw != null ? `${nf(2).format(quote.systemKw)} kW · ${quote.modules ?? "—"} módulos` : "—"}</strong></div></div> : <p className="projects-help">Sin cotización ligada. Se liga al crear el proyecto.</p>}
        </Panel>
        <Panel title="Números del proyecto">
          <div className="eng-bigs">
            <div className="eng-big"><span>Costo de materiales</span><strong>{mx.format(cost)}</strong><small>{items.length} partidas</small></div>
            <div className="eng-big"><span>Precio de venta</span><strong>{sale != null ? mx.format(sale) : "—"}</strong><small>{sale != null ? "de la cotización, con IVA" : "sin cotización"}</small></div>
            <div className="eng-big"><span>Margen bruto</span><strong>{sale != null && sale > 0 ? `${nf(1).format(((sale / 1.16 - cost) / (sale / 1.16)) * 100)} %` : "—"}</strong><small>{sale != null ? "sobre venta sin IVA" : ""}</small></div>
          </div>
          {items.some((i) => i.currency === "USD" && !i.fx) ? <ul className="eng-warnings"><li>Hay partidas en dólares sin tipo de cambio: captúralo en Precios y proveedores · Ajustes.</li></ul> : null}
        </Panel>
      </div>
      <Panel title="Lista de materiales" description="Busca en el catálogo de precios y agrega con cantidad. El proveedor se puede cambiar por partida; el costo se toma de su precio vigente y se puede ajustar a mano." action={<button className="solar-act" onClick={addFree} type="button">Partida libre</button>}>
        <div className="px-toolbar"><input aria-label="Buscar en el catálogo" className="px-search" onChange={(e) => setSearch(e.target.value)} placeholder="Buscar material del catálogo…" type="search" value={search} /></div>
        {matches.length ? <ul className="proj-matches">{matches.map((x) => <li key={x.item.id}><button onClick={() => add(x)} type="button"><strong>{x.item.name}</strong><span>{x.item.category} · {x.item.unit} · {x.cost != null ? `${x.item.currency === "USD" ? "US$" : "$"} ${nf(2).format(x.cost)}` : "sin precio"}{x.costSupplier ? ` · ${x.costSupplier.name}` : ""}</span></button></li>)}</ul> : null}
        {items.length === 0 ? <p className="projects-help">Sin materiales todavía.</p> : (
          <div className="projects-table-wrap"><table className="projects-table proj-table">
            <thead><tr><th>Material</th><th className="num">Cantidad</th><th>Unidad</th><th>Proveedor</th><th className="num">Costo unitario</th><th className="num">Importe MXN</th><th>Comprado</th><th></th></tr></thead>
            <tbody>{items.map((it, i) => {
              const x = priced.find((y) => y.item.id === it.itemId);
              return (
                <tr key={`${it.itemId ?? "libre"}-${i}`}>
                  <td>{it.itemId ? <strong>{it.description}</strong> : <input aria-label="Descripción" onChange={(e) => patch(i, { description: e.target.value })} type="text" value={it.description} />}{x ? <small className="px-muted">{x.item.category}</small> : null}</td>
                  <td className="num"><input className="cons-input" inputMode="decimal" min={0} onChange={(e) => patch(i, { quantity: Number(e.target.value) || 0 })} step={1} type="number" value={it.quantity} /></td>
                  <td>{it.itemId ? it.unit : <input aria-label="Unidad" onChange={(e) => patch(i, { unit: e.target.value })} style={{ width: 60 }} type="text" value={it.unit} />}</td>
                  <td><select aria-label="Proveedor" onChange={(e) => pickSupplier(i, e.target.value)} value={it.supplierId ?? ""}><option value="">Sin proveedor</option>{(x ? x.bySupplier.map((s) => s.supplier) : catalog.suppliers.filter((s) => s.active)).map((s) => <option key={s.id} value={s.id}>{s.name}{x ? ` · ${nf(2).format(x.bySupplier.find((y) => y.supplier.id === s.id)?.unitPrice ?? 0)}` : ""}</option>)}</select></td>
                  <td className="num"><input className="cons-input" inputMode="decimal" min={0} onChange={(e) => patch(i, { unitCost: Number(e.target.value) || 0 })} step={0.01} type="number" value={it.unitCost} /><small className="px-muted">{it.currency}{it.currency === "USD" ? ` × ${it.fx ? nf(4).format(it.fx) : "?"}` : ""}</small></td>
                  <td className="num"><strong>{mx.format(lineMxn(it))}</strong></td>
                  <td><input checked={it.purchased} onChange={(e) => patch(i, { purchased: e.target.checked })} type="checkbox" /></td>
                  <td><button className="solar-act" onClick={() => remove(i)} type="button">Quitar</button></td>
                </tr>
              );
            })}</tbody>
            <tfoot><tr><td colSpan={5}>Total</td><td className="num"><strong>{mx.format(cost)}</strong></td><td colSpan={2}></td></tr></tfoot>
          </table></div>
        )}
      </Panel>
      {items.length ? (
        <Panel title="Orden de compra por proveedor" description="Lo que hay que pedirle a cada proveedor. Imprime esta pantalla para mandarla.">
          <div className="eng-mppts">
            {bySupplier.map((g) => (
              <div className="eng-mppt proj-po" key={g.id || "none"}>
                <h4>{g.name} <small>{g.rows.length} partidas</small></h4>
                <table className="eng-matrix proj-po-table"><thead><tr><th>Material</th><th>Cant.</th><th>Unidad</th><th>Unitario</th><th>Importe</th></tr></thead>
                  <tbody>{g.rows.map((r, k) => <tr className={r.purchased ? "is-done" : ""} key={k}><td>{r.description}</td><td>{nf(r.quantity % 1 ? 2 : 0).format(r.quantity)}</td><td>{r.unit}</td><td>{r.currency === "USD" ? "US$" : "$"} {nf(2).format(r.unitCost)}</td><td>{mx.format(lineMxn(r))}</td></tr>)}</tbody>
                  <tfoot><tr><td colSpan={4}>Total</td><td>{mx.format(g.rows.reduce((a, r) => a + lineMxn(r), 0))}</td></tr></tfoot></table>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
      <p className="projects-help" style={{ marginTop: 16 }}><button className="cons-reset" onClick={() => void del()} type="button">Borrar este proyecto</button></p>
    </main>
  );
}
