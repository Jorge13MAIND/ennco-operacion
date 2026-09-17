"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Route } from "next";

import { Panel, PageHeader, useMutation } from "@/components/solar/ui";
import { PROJECT_STATUS_LABEL, type ProjectStatus, type SolarProject } from "@/lib/precios/types";

/* Proyectos: cada uno liga un cliente con una cotizacion y una lista de materiales con cantidades. */

const nf = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
export const fecha = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Mexico_City" }).format(d); };
export function projectCost(p: SolarProject): number { return p.items.reduce((a, i) => a + i.quantity * i.unitCost * (i.currency === "USD" ? (i.fx ?? 0) : 1), 0); }

export function ProjectsList({ projects, quotes, storageError }: { projects: SolarProject[]; quotes: Array<{ id: string; name: string; segment: string; cashPrice: number | null }>; storageError: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", customer: "", quoteId: "" });
  const m = useMutation();
  const create = async () => {
    const r = await m.run<{ project: SolarProject }>("/api/v1/solar/proyectos", { name: f.name, customer: f.customer || null, quoteId: f.quoteId || null, status: "COTIZADO", items: [] });
    if (r?.project) router.push(`/operacion/proyectos/${r.project.id}` as Route);
  };
  const byStatus = (s: ProjectStatus) => projects.filter((p) => p.status === s).length;
  const quoteName = (id: string | null) => quotes.find((q) => q.id === id)?.name ?? null;
  return (
    <main className="shell section operations-main projects-page" id="main-content" tabIndex={-1}>
      <PageHeader title="Proyectos" description="Cada proyecto liga un cliente con su cotización y su lista de materiales con cantidades, proveedor elegido y costo. De ahí sale la orden de compra por proveedor.">
        <button className="projects-button" onClick={() => setOpen((v) => !v)} type="button">Nuevo proyecto</button>
      </PageHeader>
      {storageError ? <div className="projects-notice" data-tone="danger">No se pudieron leer los proyectos. Recarga en un momento.</div> : null}
      {open ? (
        <Panel title="Nuevo proyecto" description="Puedes ligar una cotización guardada; el nombre y el cliente se toman de ella si los dejas vacíos.">
          <div className="eng-form">
            <label className="eng-field"><span>Cotización</span><select onChange={(e) => { const q = quotes.find((x) => x.id === e.target.value); setF({ ...f, quoteId: e.target.value, name: f.name || q?.name || "", customer: f.customer || q?.name || "" }); }} value={f.quoteId}><option value="">Sin cotización</option>{quotes.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}</select></label>
            <label className="eng-field"><span>Nombre del proyecto</span><input onChange={(e) => setF({ ...f, name: e.target.value })} type="text" value={f.name} /></label>
            <label className="eng-field"><span>Cliente</span><input onChange={(e) => setF({ ...f, customer: e.target.value })} type="text" value={f.customer} /></label>
          </div>
          <div className="eng-form is-tight" style={{ marginTop: 12 }}><button className="projects-button" disabled={m.pending || !f.name.trim()} onClick={() => void create()} type="button">Crear y abrir</button>{m.error ? <span className="solar-act-error">{m.error}</span> : null}</div>
        </Panel>
      ) : null}
      <div className="eng-bigs">
        {(["COTIZADO", "APROBADO", "EN_COMPRA", "INSTALADO"] as ProjectStatus[]).map((s) => <div className="eng-big" key={s}><span>{PROJECT_STATUS_LABEL[s]}</span><strong>{byStatus(s)}</strong></div>)}
      </div>
      <Panel title="Todos los proyectos" description={projects.length ? "Los más recientes primero." : "Aún no hay proyectos. Crea el primero desde una cotización guardada."}>
        {projects.length ? (
          <div className="projects-table-wrap"><table className="projects-table solar-quotes">
            <thead><tr><th>Proyecto</th><th>Cliente</th><th>Cotización</th><th className="num">Materiales</th><th className="num">Costo</th><th>Estado</th><th className="solar-th-actions"></th></tr></thead>
            <tbody>{projects.map((p) => (
              <tr key={p.id}>
                <td><Link className="solar-quote-name" href={`/operacion/proyectos/${p.id}` as Route}>{p.name}</Link><span className="solar-meta"><span>{fecha(p.updatedAt)}</span></span></td>
                <td>{p.customer ?? "—"}</td>
                <td>{p.quoteId ? <Link href={`/operacion/proyectos/cotizar?cotizacion=${p.quoteId}` as Route}>{quoteName(p.quoteId) ?? "Ver"}</Link> : "—"}</td>
                <td className="num">{p.items.length}</td>
                <td className="num">{nf.format(projectCost(p))}</td>
                <td><span className={`solar-chip is-${p.status.toLowerCase()}`}>{PROJECT_STATUS_LABEL[p.status]}</span></td>
                <td><div className="solar-actions"><Link className="solar-act is-primary" href={`/operacion/proyectos/${p.id}` as Route}>Abrir</Link></div></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : null}
      </Panel>
    </main>
  );
}
