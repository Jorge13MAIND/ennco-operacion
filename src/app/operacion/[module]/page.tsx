import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PortalRowsTable } from "@/components/PortalTable";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { isOperationModuleKey, loadOperationsPortal, OPERATION_MODULE_LABELS } from "@/lib/operations/portal";

export const dynamic = "force-dynamic";

export default async function OperationModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  if (!isOperationModuleKey(module)) notFound();
  const access = await requireOperationsAccess();
  const snapshot = await loadOperationsPortal(access);
  const selected = snapshot.modules[module];
  return (
    <main className="shell section operations-main">
      <div className="section-head compact portal-module-title">
        <div>
          <p className="eyebrow">Control Room · {OPERATION_MODULE_LABELS[module]}</p>
          <h1>{selected.title}</h1>
        </div>
        <span className="badge">{snapshot.evidenceClass}</span>
      </div>
      {snapshot.evidenceClass === "synthetic_demo" && module !== "roadmap" && module !== "aprobaciones" ? (
        <div className="notice operations-disclosure">
          <strong>Ejemplo operativo.</strong>
          <p>Los renglones marcados SIMULACION no son empresas, respuestas, leads ni oportunidades reales.</p>
        </div>
      ) : null}
      {module === "exportaciones" ? (
        <section className="export-actions" aria-label="Descargas auditables">
          <Link className="button secondary" href={"/api/v1/exports/companies-contacts" as Route} prefetch={false}>Descargar empresas y contactos</Link>
          <Link className="button secondary" href={"/api/v1/exports/pipeline-attribution" as Route} prefetch={false}>Descargar pipeline y atribución</Link>
        </section>
      ) : null}
      <PortalRowsTable actionKind={module} evidenceClass={snapshot.evidenceClass} module={selected} />
    </main>
  );
}
