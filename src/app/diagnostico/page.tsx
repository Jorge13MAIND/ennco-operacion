import type { Metadata } from "next";
import Link from "next/link";

import { PrequoteForm } from "@/components/PrequoteForm";
import { SiteHeader } from "@/components/SiteHeader";
import { getRuntimeConfig } from "@/lib/runtime/config";
import { buildPublicMetadata, isPublicIndexingReleased } from "@/lib/seo/indexing";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function generateMetadata(): Metadata {
  const config = getRuntimeConfig();
  return buildPublicMetadata(config, {
    route: "/diagnostico",
    title: "Diagnóstico industrial | ENNCO",
    description: "Referencia preliminar para proyectos de energía e ingeniería eléctrica industrial.",
  });
}

function textParam(value: string | string[] | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.slice(0, 100);
}

export default async function DiagnosticPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const config = getRuntimeConfig();
  const released = isPublicIndexingReleased(config);
  return (
    <>
      <SiteHeader />
      <main className="diagnostic-main" id="main-content" tabIndex={-1}>
        <section className="shell diagnostic-intro">
          <div>
            <p className="eyebrow">Diagnóstico industrial</p>
            <h1>Una referencia clara antes de decidir.</h1>
            <p className="lede">Comparte el contexto básico de tu planta. Recibirás rangos preliminares con los supuestos y límites visibles.</p>
          </div>
          <div className="diagnostic-intro-meta">
            <span className="badge">{released ? "Disponible" : config.demoMode ? "Datos sintéticos" : "Vista previa"}</span>
            <p>Tiempo estimado: menos de 4 minutos.</p>
          </div>
        </section>
        <section className="shell diagnostic-progress" aria-label="Etapas del diagnóstico">
          <ol>
            <li><span>1</span>Necesidad</li>
            <li><span>2</span>Consumo</li>
            <li><span>3</span>Sitio</li>
            <li><span>4</span>Contacto</li>
            <li><span>5</span>Referencia</li>
          </ol>
        </section>
        <section className="shell diagnostic-workspace">
          <PrequoteForm
            attribution={{
              source: textParam(params.utm_source),
              medium: textParam(params.utm_medium),
              campaign: textParam(params.utm_campaign),
              content: textParam(params.utm_content),
            }}
            demoMode={config.demoMode}
          />
        </section>
      </main>
      <footer className="shell footer">
        <span>ENNCO. Energy &amp; Innovation Consulting.</span>
        <Link href="/privacidad">Aviso de privacidad</Link>
      </footer>
    </>
  );
}
