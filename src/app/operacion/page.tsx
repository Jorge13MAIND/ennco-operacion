import type { Route } from "next";
import Link from "next/link";

import { GoldenPathControl } from "@/components/GoldenPathControl";
import { CompactActionTable, PortalRowsTable } from "@/components/PortalTable";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { civilDateValue } from "@/lib/operations/capacity";
import { loadOperationsPortal } from "@/lib/operations/portal";

export const dynamic = "force-dynamic";

function money(value: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(value);
}

export default async function OperationsPage() {
  const access = await requireOperationsAccess();
  const snapshot = await loadOperationsPortal(access);
  const capacityLabels = { HEALTHY: "Disponible", WARNING: "Atención", FULL: "Lleno", UNKNOWN: "Bloqueado" } as const;
  return (
    <main className="shell section operations-main">
      <div className="section-head compact">
        <div>
          <p className="eyebrow">Control Room · Hoy</p>
          <h1>Qué requiere atención y qué resultado existe de verdad.</h1>
          <p className="lede">Datos actualizados {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(snapshot.generatedAt))}.</p>
        </div>
        <span className="badge">{snapshot.evidenceClass}</span>
      </div>

      {snapshot.evidenceClass === "synthetic_demo" ? (
        <div className="notice operations-disclosure">
          <strong>Modo sintético con tráfico cero.</strong>
          <p>Los ejemplos de las tablas sirven para probar el flujo. Los ocho indicadores siguientes son la verdad comercial real y permanecen en cero.</p>
        </div>
      ) : null}

      <section aria-label="Verdad comercial" className="metric-grid operations-metrics">
        <div className="metric"><span>Leads nuevos hoy</span><strong>{snapshot.realTruth.newLeads}</strong></div>
        <div className="metric"><span>Respuestas pendientes</span><strong>{snapshot.realTruth.pendingReplies}</strong></div>
        <div className="metric"><span>Reuniones hoy</span><strong>{snapshot.realTruth.meetingsToday}</strong></div>
        <div className="metric"><span>Tareas vencidas</span><strong>{snapshot.realTruth.overdueTasks}</strong></div>
        <div className="metric"><span>Leads contractuales</span><strong>{snapshot.realTruth.contractualLeads}</strong></div>
        <div className="metric"><span>Pipeline estricto</span><strong>{snapshot.realTruth.qualifiedPipeline}</strong></div>
        <div className="metric"><span>Proyectos ganados</span><strong>{snapshot.realTruth.wonProjects}</strong></div>
        <div className="metric"><span>Primeros pagos</span><strong>{money(snapshot.realTruth.firstPaymentsMxn)}</strong></div>
      </section>

      <section aria-label="Salud operativa" className="release-strip operations-health">
        <div><span>Kill switch</span><strong>{snapshot.health.killSwitch ? "ACTIVO" : "INACTIVO"}</strong></div>
        <div><span>Envío externo</span><strong>{snapshot.health.externalSendAllowed ? "HABILITADO" : "BLOQUEADO"}</strong></div>
        <div><span>Reply sync</span><strong>{snapshot.health.replySync}</strong></div>
        <div><span>Riesgos</span><strong>{snapshot.health.openP0} P0 / {snapshot.health.openP1} P1</strong></div>
        <div>
          <span>Capacidad {civilDateValue(snapshot.health.capacity.month)}</span>
          <strong className={`status ${snapshot.health.capacity.state === "UNKNOWN" || snapshot.health.capacity.state === "FULL" ? "blocked" : ""}`}>
            {capacityLabels[snapshot.health.capacity.state]}. {snapshot.health.capacity.committed}/{snapshot.health.capacity.limit ?? "?"}. {snapshot.health.capacity.available ?? "?"} disponibles
          </strong>
          {snapshot.health.capacity.unscheduled > 0 ? <span>{snapshot.health.capacity.unscheduled} proyectos ganados sin fecha</span> : null}
        </div>
        <div>
          <span>Investigación</span>
          <strong className={`status ${snapshot.health.research.decision !== "PASS" ? "blocked" : ""}`}>
            {snapshot.health.research.decision}. {snapshot.health.research.verifiedAccounts}/{snapshot.health.research.targetAccounts} empresas. {snapshot.health.research.verifiedContacts}/{snapshot.health.research.targetContacts} contactos
          </strong>
          <span>{snapshot.health.research.outreachState}. {snapshot.health.research.outreachEligibleRecords} autorizados</span>
        </div>
      </section>

      <div className="operations-dashboard-grid">
        <section className="panel action-panel">
          <div className="panel-head">
            <div>
              <h2>Siguientes acciones</h2>
              <p>Ordenadas por vencimiento y severidad.</p>
            </div>
          </div>
          <CompactActionTable evidenceClass={snapshot.evidenceClass} rows={snapshot.nextActions} />
        </section>
        <section className="panel quick-links-panel">
          <div className="panel-head"><h2>Operar</h2></div>
          <div className="quick-links">
            <Link href={"/operacion/respuestas" as Route}><strong>Responder interés</strong><span>Revisar bandeja y detener secuencias</span></Link>
            <Link href={"/operacion/leads" as Route}><strong>Calificar lead</strong><span>Aplicar definición contractual estricta</span></Link>
            <Link href={"/operacion/pipeline" as Route}><strong>Actualizar oportunidad</strong><span>Registrar valor y siguiente acción</span></Link>
            <Link href={"/operacion/empresas" as Route}><strong>Revisar investigación</strong><span>Fuentes, contactos y duplicados sin mezclar pipeline</span></Link>
            <Link href={"/operacion/aprobaciones" as Route}><strong>Resolver gate</strong><span>Dejar decisión y evidencia</span></Link>
          </div>
        </section>
      </div>

      <PortalRowsTable actionKind="respuestas" evidenceClass={snapshot.evidenceClass} module={snapshot.modules.respuestas} />
      {snapshot.evidenceClass === "synthetic_demo" ? <GoldenPathControl /> : null}
    </main>
  );
}
