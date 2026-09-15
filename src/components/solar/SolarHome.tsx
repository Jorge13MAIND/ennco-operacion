import type { Route } from "next";
import Link from "next/link";

import { PageHeader, Panel, money } from "@/components/projects/ui";
import type { CatalogVersions, StoredQuote } from "@/lib/solar/server";
import type { Segment } from "@/lib/solar/types";

const SEGMENTS: Array<{ key: Segment; title: string; detail: string }> = [
  { key: "RESIDENTIAL", title: "Residencial", detail: "Tarifas 1 a 1F y DAC. Recibo bimestral o mensual, historial de 12 periodos, ventana DAC de 12 meses." },
  { key: "COMMERCIAL", title: "Comercial", detail: "PDBT, GDBT, APBT y RABT en baja tensión, por división CFE. Cargo fijo, energía, capacidad y factor de potencia." },
  { key: "INDUSTRIAL", title: "Industrial", detail: "GDMTO, GDMTH y DIST en media tensión: base, intermedia y punta, demanda facturable y banco de capacitores." },
];
const segmentLabel: Record<string, string> = { RESIDENTIAL: "Residencial", COMMERCIAL: "Comercial", INDUSTRIAL: "Industrial" };
const stamp = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "America/Mexico_City" });
const pct = (v: number | undefined) => (typeof v === "number" ? `${(v * 100).toFixed(1)} %` : "—");

export function SolarHome({ quotes, versions, live, storageError }: { quotes: StoredQuote[]; versions: CatalogVersions; live: boolean; storageError?: boolean }) {
  const overridden = Object.values(versions).filter((v) => v.source === "catalog").length;
  return (
    <main className="shell section operations-main projects-page" id="main-content" tabIndex={-1}>
      <PageHeader title="Cotizador solar" description="La Calculadora Solar de ENNCO en el dashboard: captura el recibo, dimensiona el sistema, simula el recibo con y sin paneles y arma la propuesta. Cada cotización queda guardada con sus versiones.">
        <Link className="projects-button" href={"/operacion/proyectos/catalogos" as Route}>Catálogos</Link>
      </PageHeader>
      {!live ? <div className="projects-disclosure"><strong>Modo demostración.</strong> Las cotizaciones no se guardan en este ambiente.</div> : null}
      {storageError ? <div className="projects-notice" data-tone="danger" role="alert">No se pudieron leer las cotizaciones guardadas. Puedes cotizar; la lista se reintenta al abrir de nuevo.</div> : null}
      <section className="projects-card-grid" aria-label="Nueva cotización">
        {SEGMENTS.map((s) => (
          <article className="projects-card" key={s.key}>
            <span className="projects-eyebrow">Nueva cotización</span>
            <h2>{s.title}</h2>
            <p>{s.detail}</p>
            <div className="projects-card-foot">
              <Link className="projects-button" href={`/operacion/proyectos/cotizar?segmento=${s.key}` as Route}>Cotizar {s.title.toLowerCase()}</Link>
            </div>
          </article>
        ))}
      </section>
      <Panel title="Cotizaciones guardadas" description={quotes.length === 0 ? "Aún no hay cotizaciones. La primera que guardes aparece aquí." : "Las más recientes primero. Abre una para editarla; cada guardado crea una versión nueva."}>
        {quotes.length === 0 ? null : (
          <div className="projects-table-wrap">
            <table className="projects-table">
              <thead>
                <tr><th>Cotización</th><th>Segmento</th><th>Ciudad · tarifa</th><th className="num">Sistema</th><th className="num">Generación</th><th className="num">Recibo sin / con FV</th><th className="num">Precio</th><th className="num">TIR · retorno</th><th>Actualizada</th></tr>
              </thead>
              <tbody>
                {quotes.map((q) => (
                  <tr key={q.id}>
                    <td><Link href={`/operacion/proyectos/cotizar?cotizacion=${q.id}` as Route}><strong>{q.name}</strong></Link><br /><span className="projects-help">v{q.version} · {q.status}</span></td>
                    <td>{segmentLabel[q.segment] ?? q.segment}</td>
                    <td>{q.summary.city ?? "—"}<br /><span className="projects-help">{q.summary.tariff ?? ""}</span></td>
                    <td className="num">{q.summary.systemKw != null ? `${q.summary.systemKw.toFixed(2)} kW` : "—"}<br /><span className="projects-help">{q.summary.modules ?? "—"} módulos</span></td>
                    <td className="num">{q.summary.annualGeneration != null ? `${Math.round(q.summary.annualGeneration).toLocaleString("es-MX")} kWh` : "—"}<br /><span className="projects-help">cobertura {pct(q.summary.coverage)}</span></td>
                    <td className="num">{q.summary.annualWithout != null ? money(q.summary.annualWithout) : "—"}<br /><span className="projects-help">{q.summary.annualWith != null ? money(q.summary.annualWith) : "—"}</span></td>
                    <td className="num">{q.summary.cashPrice != null ? money(q.summary.cashPrice) : "—"}</td>
                    <td className="num">{pct(q.summary.irr)}<br /><span className="projects-help">{q.summary.paybackTotal != null ? `${q.summary.paybackTotal.toFixed(2)} años` : "—"}</span></td>
                    <td>{stamp.format(new Date(q.updatedAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Catálogos en uso" description="El libro v1.0.1 es la base. Una versión aprobada en Catálogos con categoría solar_* la sustituye.">
        <p className="projects-help">{overridden === 0 ? "Todos los catálogos vienen del libro (módulos, inversores, ciudades, Factor K, tarifas CFE 2024 del MEST con referencia 2026 pendiente de confirmar, precios, montaje)." : `${overridden} catálogo(s) sustituidos por versiones aprobadas en Catálogos.`} Herramientas de ingeniería (sombras, arreglos, circuitos) llegan en la siguiente fase.</p>
      </Panel>
    </main>
  );
}
