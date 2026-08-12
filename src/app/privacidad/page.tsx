import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "@/components/SiteHeader";
import { getRuntimeConfig } from "@/lib/runtime/config";
import {
  PRIVACY_NOTICE_LAST_UPDATED,
  PRIVACY_NOTICE_SECTIONS,
  PRIVACY_NOTICE_VERSION,
} from "@/lib/privacy/notice";
import { buildPublicMetadata, isPublicIndexingReleased } from "@/lib/seo/indexing";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function generateMetadata(): Metadata {
  return buildPublicMetadata(getRuntimeConfig(), {
    route: "/privacidad",
    title: "Aviso de privacidad | ENNCO",
    description: "Información sobre el tratamiento de datos personales en el diagnóstico industrial ENNCO.",
  });
}

export default function PrivacyPage() {
  const config = getRuntimeConfig();
  const released = isPublicIndexingReleased(config);
  return (
    <>
      <SiteHeader />
      <main className="shell section legal-page" id="main-content" tabIndex={-1}>
        <div className="section-head compact">
          <div>
            <p className="eyebrow">Privacidad</p>
            <h1>Aviso de privacidad integral</h1>
          </div>
          <span className="badge">{released ? "Publicado" : "Borrador legal"}</span>
        </div>

        {!released ? (
          <div className="notice legal-warning" role="status">
            <strong>No publicado.</strong>
            <p>Esta superficie permanece en HOLD hasta completar el gate legal y la aprobación explícita de publicación.</p>
          </div>
        ) : null}

        <article className="legal-card">
          <p className="fine">Versión {PRIVACY_NOTICE_VERSION}. Última actualización: {PRIVACY_NOTICE_LAST_UPDATED}.</p>

          {PRIVACY_NOTICE_SECTIONS.map((section, sectionIndex) => (
            <section key={section.title}>
              <h2>{sectionIndex + 1}. {section.title}</h2>
              <p>
                {section.segments.map((segment, segmentIndex) => segment.kind === "email" ? (
                  <a href={`mailto:${segment.value}`} key={`${section.title}-${segmentIndex}`}>{segment.value}</a>
                ) : (
                  <span key={`${section.title}-${segmentIndex}`}>{segment.value}</span>
                ))}
              </p>
            </section>
          ))}

          <div className="actions">
            <Link className="button secondary" href="/diagnostico">Volver al diagnóstico</Link>
          </div>
        </article>
      </main>
    </>
  );
}
