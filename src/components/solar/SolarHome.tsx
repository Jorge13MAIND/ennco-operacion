import type { Route } from "next";
import Link from "next/link";

import { SolarQuoteActions } from "@/components/solar/SolarQuoteActions";
import { PageHeader, Panel } from "@/components/projects/ui";
import type { CatalogVersions, StoredQuote } from "@/lib/solar/server";
import type { Segment } from "@/lib/solar/types";

const SEGMENTS: Array<{ key: Segment; title: string; detail: string }> = [
  { key: "RESIDENTIAL", title: "Residencial", detail: "Tarifas 1 a 1F y DAC. Recibo bimestral o mensual, historial de 12 periodos, ventana DAC de 12 meses." },
  { key: "COMMERCIAL", title: "Comercial", detail: "PDBT, GDBT, APBT y RABT en baja tensión, por división CFE. Cargo fijo, energía, capacidad y factor de potencia." },
  { key: "INDUSTRIAL", title: "Industrial", detail: "GDMTO, GDMTH y DIST en media tensión: base, intermedia y punta, demanda facturable y banco de capacitores." },
];
const segmentLabel: Record<string, string> = { RESIDENTIAL: "Residencial", COMMERCIAL: "Comercial", INDUSTRIAL: "Industrial" };
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** Fecha corta sin depender de la tabla de idiomas del servidor: una fila con un dato raro no debe tumbar la pantalla. */
function fecha(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const p = new Date(d.getTime() - 6 * 3600_000); // hora del centro de México
  return `${p.getUTCDate()} ${MESES[p.getUTCMonth()] ?? ""} ${p.getUTCFullYear()}`;
}
const pct = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? `${(v * 100).toFixed(1)} %` : "—");
const num = (v: number | null | undefined, suf = "") => (typeof v === "number" && Number.isFinite(v) ? `${Math.round(v).toLocaleString("es-MX")}${suf}` : "—");
const dec = (v: number | null | undefined, d = 2, suf = "") => (typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(d)}${suf}` : "—");
/** Moneda formateada aquí mismo: `money` de projects/ui vive en un módulo de navegador y no
 *  puede llamarse desde este componente de servidor (era la causa del fallo con cotizaciones guardadas). */
const mxn = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v)
    ? new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(v)
    : "—";

/**
 * Íconos de los tres segmentos: casa, local comercial y planta, cada uno con sus paneles
 * en el techo. Van en línea (sin archivo ni descarga) para que escalen y sigan el color
 * de la marca. Decorativos: el nombre del segmento ya está en el título.
 */
function SegmentIcon({ segment }: { segment: Segment }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <span aria-hidden="true" className="solar-segment-icon">
      <svg height="30" viewBox="0 0 48 48" width="30" xmlns="http://www.w3.org/2000/svg">
        {segment === "RESIDENTIAL" ? (
          <g {...common}>
            <path d="M8 22 24 9l16 13" />
            <path d="M12 21v17h24V21" />
            <path d="M20 38v-9h8v9" />
            <path d="M17.5 17.5 24 12.5l6.5 5z" fill="currentColor" fillOpacity="0.18" />
            <path d="M20.7 15 19 17.5M24 13.2l-1.7 2.6M27.3 15l-1.7 2.6" />
          </g>
        ) : null}
        {segment === "COMMERCIAL" ? (
          <g {...common}>
            <path d="M9 19h30v19H9z" />
            <path d="M9 19l3-7h24l3 7" />
            <path d="M15 26h8v12h-8z" />
            <path d="M28 26h6v6h-6z" />
            <path d="M14 15h20" fill="currentColor" fillOpacity="0.18" />
            <path d="M18 12.5v-3h12v3" />
            <path d="M21 9.5h6" />
          </g>
        ) : null}
        {segment === "INDUSTRIAL" ? (
          <g {...common}>
            <path d="M6 38V22l9 5V22l9 5V22l9 5v11z" />
            <path d="M33 38V14h6v24" />
            <path d="M12 32h4M21 32h4M30 32h3" />
            <path d="M36 11V8" />
            <path d="M8 18h10l-1.5 3H9.5z" fill="currentColor" fillOpacity="0.2" />
          </g>
        ) : null}
      </svg>
    </span>
  );
}

export function SolarHome({ quotes, versions, live, storageError, archived = false }: { quotes: StoredQuote[]; versions: CatalogVersions; live: boolean; storageError?: boolean; archived?: boolean }) {
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
          <article className="projects-card solar-segment-card" key={s.key}>
            <div className="solar-segment-head">
              <SegmentIcon segment={s.key} />
              <div>
                <span className="projects-eyebrow">Nueva cotización</span>
                <h3>{s.title}</h3>
              </div>
            </div>
            <p>{s.detail}</p>
            <div className="projects-card-foot">
              <Link className="projects-button" href={`/operacion/proyectos/cotizar?segmento=${s.key}` as Route}>Cotizar {s.title.toLowerCase()}</Link>
            </div>
          </article>
        ))}
      </section>
      <Panel
        title={archived ? "Cotizaciones archivadas" : "Cotizaciones guardadas"}
        description={quotes.length === 0
          ? (archived ? "No hay cotizaciones archivadas." : "Aún no hay cotizaciones. La primera que guardes aparece aquí.")
          : (archived ? "Restaurar una la devuelve a la lista principal. Nada se borra." : "Las más recientes primero. Editar abre el cotizador y cada guardado crea una versión nueva; PDF abre la hoja para imprimir.")}
        action={<Link className="projects-button" href={(archived ? "/operacion/proyectos" : "/operacion/proyectos?archivadas=1") as Route}>{archived ? "Ver activas" : "Ver archivadas"}</Link>}
      >
        {quotes.length === 0 ? null : (
          <div className="projects-table-wrap">
            <table className="projects-table">
              <thead>
                <tr><th>Cotización</th><th>Segmento</th><th>Ciudad · tarifa</th><th className="num">Sistema</th><th className="num">Generación</th><th className="num">Recibo sin / con FV</th><th className="num">Precio</th><th className="num">TIR · retorno</th><th>Actualizada</th><th></th></tr>
              </thead>
              <tbody>
                {quotes.map((raw) => { const q = { ...raw, summary: raw.summary ?? {} }; return (
                  <tr key={q.id}>
                    <td><Link href={`/operacion/proyectos/cotizar?cotizacion=${q.id}` as Route}><strong>{q.name}</strong></Link><br /><span className="projects-help">v{q.version} · {q.status}</span></td>
                    <td>{segmentLabel[q.segment] ?? q.segment}</td>
                    <td>{q.summary?.city ?? "—"}<br /><span className="projects-help">{q.summary?.tariff ?? ""}</span></td>
                    <td className="num">{dec(q.summary.systemKw, 2, " kW")}<br /><span className="projects-help">{q.summary?.modules ?? "—"} módulos</span></td>
                    <td className="num">{num(q.summary.annualGeneration, " kWh")}<br /><span className="projects-help">cobertura {pct(q.summary?.coverage)}</span></td>
                    <td className="num">{mxn(q.summary.annualWithout)}<br /><span className="projects-help">{mxn(q.summary.annualWith)}</span></td>
                    <td className="num">{mxn(q.summary.cashPrice)}</td>
                    <td className="num">{pct(q.summary?.irr)}<br /><span className="projects-help">{dec(q.summary.paybackTotal, 2, " años")}</span></td>
                    <td>{fecha(q.updatedAt)}</td>
                    <td><SolarQuoteActions id={q.id} archived={q.status === "ARCHIVED"} /></td>
                  </tr>
                ); })}
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
