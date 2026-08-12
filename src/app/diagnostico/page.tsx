import { PrequoteForm } from "@/components/PrequoteForm";
import { SiteHeader } from "@/components/SiteHeader";
import { getRuntimeConfig } from "@/lib/runtime/config";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function generateMetadata(): Metadata {
  const config = getRuntimeConfig();
  const released = config.appEnv === "production" && config.publicSurfaceReleased;
  return {
    title: "Diagnóstico industrial | ENNCO",
    description: "Referencia preliminar para proyectos de energía e ingeniería eléctrica industrial.",
    robots: { index: released, follow: released },
  };
}

function textParam(value: string | string[] | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.slice(0, 100);
}

export default async function DiagnosticPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const config = getRuntimeConfig();
  return (
    <>
      <SiteHeader />
      <main className="shell section">
        <div className="section-head">
          <div>
            <p className="eyebrow">Diagnóstico industrial</p>
            <h1>Con el recibo empieza la conversación técnica.</h1>
          </div>
          <span className="badge">{config.demoMode ? "synthetic_demo" : "live"}</span>
        </div>
        <PrequoteForm
          attribution={{
            source: textParam(params.utm_source),
            medium: textParam(params.utm_medium),
            campaign: textParam(params.utm_campaign),
            content: textParam(params.utm_content),
          }}
          demoMode={config.demoMode}
        />
      </main>
      <footer className="shell footer">
        <span>ENNCO. Energy &amp; Innovation Consulting.</span>
        <Link href="/privacidad">Aviso de privacidad</Link>
      </footer>
    </>
  );
}
import type { Metadata } from "next";
import Link from "next/link";
