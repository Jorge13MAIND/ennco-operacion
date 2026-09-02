import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PortalRowsTable } from "@/components/PortalTable";
import { CapacityConfigAction } from "@/components/OperationsActions";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { isOperationModuleKey, loadOperationsPortal, OPERATION_MODULE_LABELS } from "@/lib/operations/portal";
import { operationalLabel } from "@/lib/operations/presentation";

export const dynamic = "force-dynamic";

export default async function OperationModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  if (!isOperationModuleKey(module)) notFound();
  const access = await requireOperationsAccess();
  const snapshot = await loadOperationsPortal(access);
  const selected = snapshot.modules[module];
  return (
    <main className="shell section operations-main" id="main-content" tabIndex={-1}>
      <div className="section-head compact portal-module-title">
        <div>
          <p className="eyebrow">Control Room · {OPERATION_MODULE_LABELS[module]}</p>
          <h1>{selected.title}</h1>
        </div>
        {snapshot.evidenceClass === "live" ? null : <span className="badge">{operationalLabel(snapshot.evidenceClass)}</span>}
      </div>
      {snapshot.evidenceClass === "synthetic_demo" && module !== "roadmap" && module !== "aprobaciones" ? (
        <div className="notice operations-disclosure">
          <strong>{module === "entrega"
            ? "Estado local, sin entrega real."
            : module === "cadencia"
              ? "Cadencia live no comprobada."
              : "Ejemplo operativo."}</strong>
          <p>{module === "entrega"
            ? "EVIDENCE_READY sólo describe el paquete local. UAT, capacitación, transferencia y aceptación ENNCO permanecen en cero."
            : module === "cadencia"
              ? "Las cinco cadencias permanecen UNKNOWN. No se inventan horarios, responsables, asistencia ni entregas externas."
            : "Los renglones marcados SIMULACION no son empresas, respuestas, leads ni oportunidades reales."}</p>
        </div>
      ) : null}
      {module === "exportaciones" ? (
        <section className="export-actions" aria-label="Descargas auditables">
          <Link className="button secondary" href={"/api/v1/exports/companies-contacts" as Route} prefetch={false}>Descargar empresas y contactos</Link>
          <Link className="button secondary" href={"/api/v1/exports/pipeline-attribution" as Route} prefetch={false}>Descargar pipeline y atribución</Link>
        </section>
      ) : null}
      {module === "pipeline" && snapshot.evidenceClass === "live" && ["ennco_admin", "teckel_admin"].includes(access.role) ? (
        <CapacityConfigAction />
      ) : null}
      <PortalRowsTable actionKind={module} evidenceClass={snapshot.evidenceClass} module={selected} />
    </main>
  );
}
