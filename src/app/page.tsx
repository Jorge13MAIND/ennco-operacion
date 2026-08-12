import Link from "next/link";

import { SiteHeader } from "@/components/SiteHeader";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="shell hero">
          <div>
            <p className="eyebrow">Sistema comercial ENNCO</p>
            <h1>De la planta correcta a la siguiente acción.</h1>
            <p className="lede">
              Una plataforma para investigar, captar, calificar y dar seguimiento a proyectos industriales con evidencia y control.
            </p>
            <div className="actions">
              <Link className="button" href="/diagnostico">Abrir diagnóstico</Link>
              <Link className="button secondary" href="/operacion">Ver Control Room</Link>
            </div>
          </div>
          <aside className="hero-card">
            <strong>Local, seguro y bloqueado</strong>
            <p>Esta versión es una superficie interna de construcción. Envío externo, DNS y producción siguen deshabilitados.</p>
          </aside>
        </section>
        <section className="shell section">
          <div className="grid-3">
            <article className="card">
              <h3>Prospecto</h3>
              <p>Diagnóstico, recibo, precotización preliminar y folio con supuestos visibles.</p>
            </article>
            <article className="card">
              <h3>ENNCO</h3>
              <p>Leads, respuestas, pipeline, roadmap, aprobaciones y reportes desde un solo lugar.</p>
            </article>
            <article className="card">
              <h3>Teckel</h3>
              <p>Supresión, idempotencia, colas, alertas, incidentes y evidencia de liberación.</p>
            </article>
          </div>
        </section>
      </main>
    </>
  );
}
