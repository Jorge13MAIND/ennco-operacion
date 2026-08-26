import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "@/components/SiteHeader";
import { getRuntimeConfig } from "@/lib/runtime/config";
import { buildPublicMetadata, isPublicIndexingReleased } from "@/lib/seo/indexing";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const config = getRuntimeConfig();
  return buildPublicMetadata(config, {
    route: "/",
    title: "ENNCO | Ingeniería energética para industria",
    description: "Proyectos solares, infraestructura eléctrica, almacenamiento, mantenimiento y diagnóstico para instalaciones industriales.",
  });
}

export default function HomePage() {
  const config = getRuntimeConfig();
  const released = isPublicIndexingReleased(config);
  return (
    <>
      <SiteHeader />
      <main className="public-main" id="main-content" tabIndex={-1}>
        <section className="shell public-hero">
          <div className="public-hero-copy">
            <p className="eyebrow">Ingeniería energética para industria</p>
            <h1>Energía que se convierte en capacidad operativa.</h1>
            <p className="lede">
              ENNCO diseña, instala y mantiene infraestructura energética para plantas que necesitan decisiones técnicas claras, no promesas genéricas.
            </p>
            <div className="actions">
              <Link className="button" href="/diagnostico">Evaluar mi proyecto</Link>
              <a className="text-link" href="#capacidades">Conocer capacidades</a>
            </div>
            <div className="public-hero-proof" aria-label="Enfoque de trabajo">
              <span>Diagnóstico preliminar</span>
              <span>Rangos transparentes</span>
              <span>Validación técnica</span>
            </div>
          </div>
          <figure className="public-hero-media">
            <picture>
              <source media="(max-width: 760px)" srcSet="/media/ennco/industrial-rooftop-mobile.avif" type="image/avif" />
              <source media="(max-width: 760px)" srcSet="/media/ennco/industrial-rooftop-mobile.webp" type="image/webp" />
              <source srcSet="/media/ennco/industrial-rooftop.avif" type="image/avif" />
              <img
                alt="Instalación fotovoltaica en una cubierta industrial"
                fetchPriority="high"
                height="1350"
                src="/media/ennco/industrial-rooftop.webp"
                width="1800"
              />
            </picture>
            <figcaption>
              <span>Ingeniería en campo</span>
              <strong>Diseño, instalación y verificación</strong>
            </figcaption>
          </figure>
        </section>

        {!released ? (
          <section className="shell public-release-note" aria-label="Estado de publicación">
            <span className="signal-dot" />
            <p><strong>Vista previa controlada.</strong> La experiencia pública permanece fuera de indexación hasta completar el gate de publicación.</p>
          </section>
        ) : null}

        <section className="public-capabilities" id="capacidades">
          <div className="shell">
            <div className="public-section-heading">
              <p className="eyebrow">Capacidad integral</p>
              <h2>De la calidad eléctrica a la generación distribuida.</h2>
              <p>Una lectura completa del sitio permite elegir la intervención adecuada antes de comprometer precio, alcance o fecha.</p>
            </div>
            <div className="capability-grid">
              <article className="capability-feature">
                <picture>
                  <source media="(max-width: 760px)" srcSet="/media/ennco/solar-installation-mobile.avif" type="image/avif" />
                  <source media="(max-width: 760px)" srcSet="/media/ennco/solar-installation-mobile.webp" type="image/webp" />
                  <source srcSet="/media/ennco/solar-installation.avif" type="image/avif" />
                  <img alt="Arreglo de paneles solares instalado sobre una cubierta" height="1000" loading="lazy" src="/media/ennco/solar-installation.webp" width="1600" />
                </picture>
                <div><span>01</span><h3>Solar industrial</h3><p>Dimensionamiento preliminar, ingeniería y ejecución sujetas a las condiciones reales del sitio.</p></div>
              </article>
              <article className="capability-card">
                <span>02</span><h3>Infraestructura eléctrica</h3><p>Revisión de necesidades, capacidad instalada, obra eléctrica y distancias.</p>
              </article>
              <article className="capability-card">
                <span>03</span><h3>Almacenamiento</h3><p>Evaluación técnica antes de definir arquitectura, inversión o fecha de instalación.</p>
              </article>
              <article className="capability-card capability-thermal">
                <picture>
                  <source media="(max-width: 760px)" srcSet="/media/ennco/thermography-mobile.avif" type="image/avif" />
                  <source media="(max-width: 760px)" srcSet="/media/ennco/thermography-mobile.webp" type="image/webp" />
                  <source srcSet="/media/ennco/thermography.avif" type="image/avif" />
                  <img alt="Comparación termográfica y visible de módulos fotovoltaicos" height="1050" loading="lazy" src="/media/ennco/thermography.webp" width="1400" />
                </picture>
                <div><span>04</span><h3>Mantenimiento y termografía</h3><p>Inspección visual y térmica para identificar condiciones que requieren atención.</p></div>
              </article>
            </div>
          </div>
        </section>

        <section className="shell public-process">
          <div className="public-process-copy">
            <p className="eyebrow">Proceso con evidencia</p>
            <h2>Primero entender. Después dimensionar.</h2>
            <p>El diagnóstico produce una referencia preliminar. La propuesta contractual sólo nace después de revisar recibo, tarifa, sitio, estructura, distancias, obra eléctrica y disponibilidad.</p>
            <Link className="button" href="/diagnostico">Iniciar diagnóstico</Link>
          </div>
          <ol className="process-list">
            <li><span>01</span><div><strong>Contexto operativo</strong><p>Necesidad, gasto, tarifa y cobertura objetivo.</p></div></li>
            <li><span>02</span><div><strong>Referencia técnica</strong><p>Capacidad, área, módulos e inversión como rangos.</p></div></li>
            <li><span>03</span><div><strong>Revisión ENNCO</strong><p>Validación técnica y comercial antes de cualquier compromiso.</p></div></li>
          </ol>
        </section>

        <section className="public-control-bridge">
          <div className="shell">
            <div>
              <p className="eyebrow">Operación privada</p>
              <h2>Las decisiones comerciales viven en un sistema separado.</h2>
            </div>
            <div>
              <p>Respuestas, leads, pipeline, aprobaciones y gates técnicos se mantienen en el Control Room autenticado.</p>
              <Link className="button secondary light" href="/operacion">Entrar al Control Room</Link>
            </div>
          </div>
        </section>
      </main>
      <footer className="shell footer public-footer">
        <span>ENNCO. Energy &amp; Innovation Consulting.</span>
        <div><Link href="/privacidad">Aviso de privacidad</Link><Link href="/ingreso">Acceso privado</Link></div>
      </footer>
    </>
  );
}
