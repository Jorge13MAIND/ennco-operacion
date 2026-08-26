import type { Route } from "next";
import Link from "next/link";

import { GoldenPathControl } from "@/components/GoldenPathControl";
import { CompactActionTable, PortalRowsTable } from "@/components/PortalTable";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { civilDateValue } from "@/lib/operations/capacity";
import { loadOperationsPortal } from "@/lib/operations/portal";
import { operationalLabel } from "@/lib/operations/presentation";

export const dynamic = "force-dynamic";

function money(value: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(value);
}

export default async function OperationsPage() {
  const access = await requireOperationsAccess();
  const snapshot = await loadOperationsPortal(access);
  const capacityLabels = { HEALTHY: "Disponible", WARNING: "Atención", FULL: "Lleno", UNKNOWN: "Bloqueado" } as const;
  const effectiveRelease = snapshot.health.externalSendAllowed ? "HABILITADO" : "BLOQUEADO";
  return (
    <main className="shell section operations-main" id="main-content" tabIndex={-1}>
      <header className="operations-page-heading">
        <div>
          <p className="eyebrow">Control Room · Hoy</p>
          <h1>Decide qué atender primero.</h1>
          <p>Verdad operativa actualizada {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(snapshot.generatedAt))}.</p>
        </div>
        <span className="badge">{operationalLabel(snapshot.evidenceClass)}</span>
      </header>

      <section aria-label="Autorización efectiva" className={`command-status ${snapshot.health.externalSendAllowed ? "ready" : "blocked"}`}>
        <div className="command-status-primary">
          <span>Autorización efectiva</span>
          <strong>{effectiveRelease}</strong>
          <p>{snapshot.health.externalSendAllowed
            ? "Los controles actuales permiten operar dentro del manifiesto aprobado."
            : "Ningún proveedor activo sustituye los gates, el manifiesto y la evidencia requerida."}</p>
        </div>
        <div className="command-status-facts">
          <div><span>Kill switch</span><strong>{snapshot.health.killSwitch ? "ACTIVO" : "INACTIVO"}</strong></div>
          <div><span>Reply sync</span><strong>{snapshot.health.replySync}</strong></div>
          <div><span>Riesgo abierto</span><strong>{snapshot.health.openP0} P0 · {snapshot.health.openP1} P1</strong></div>
        </div>
      </section>

      {snapshot.evidenceClass === "synthetic_demo" ? (
        <div className="notice operations-disclosure">
          <strong>Modo sintético. Tráfico externo en cero.</strong>
          <p>Las tablas prueban el flujo, no representan empresas, respuestas, leads ni pipeline reales.</p>
        </div>
      ) : null}

      <div className="operations-dashboard-grid operations-priority-grid">
        <section className="panel action-panel">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Prioridad operativa</p>
              <h2>Siguientes acciones</h2>
              <p>Ordenadas por vencimiento y severidad.</p>
            </div>
          </div>
          <CompactActionTable evidenceClass={snapshot.evidenceClass} rows={snapshot.nextActions} />
        </section>
        <section className="panel quick-links-panel">
          <div className="panel-head"><div><p className="panel-kicker">Atajos</p><h2>Operar</h2></div></div>
          <div className="quick-links">
            <Link href={"/operacion/alertas" as Route}><strong>Atender incidente</strong><span>Acusar, contener y documentar recuperación</span></Link>
            <Link href={"/operacion/respuestas" as Route}><strong>Responder interés</strong><span>Revisar bandeja y detener secuencias</span></Link>
            <Link href={"/operacion/leads" as Route}><strong>Calificar lead</strong><span>Aplicar la definición contractual</span></Link>
            <Link href={"/operacion/pipeline" as Route}><strong>Actualizar oportunidad</strong><span>Registrar valor y siguiente acción</span></Link>
            <Link href={"/operacion/infraestructura" as Route}><strong>Revisar infraestructura</strong><span>Dominios, buzones, warmup y presupuesto</span></Link>
          </div>
        </section>
      </div>

      <div className="operations-section-heading">
        <div><p className="eyebrow">Resultado comercial</p><h2>Lo que existe de verdad.</h2></div>
        <p>Actividad, señales y revenue se cuentan por separado.</p>
      </div>
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

      <details className="operations-technical-details">
        <summary><span>Infraestructura y gates técnicos</span><small>Ver evidencia, capacidad, investigación y cadencia</small></summary>
        <section aria-label="Salud operativa" className="release-strip operations-health">
          <div>
            <span>Apollo e investigación</span>
            <strong className={`status ${snapshot.health.outboundProvider.state !== "READY" ? "blocked" : ""}`}>{snapshot.health.outboundProvider.name}. {operationalLabel(snapshot.health.outboundProvider.state)}</strong>
            <span>{snapshot.health.outboundProvider.plan}. Dominios {snapshot.health.outboundProvider.domainsReady}/{snapshot.health.outboundProvider.domainsTarget}. Buzones {snapshot.health.outboundProvider.mailboxesReady}/{snapshot.health.outboundProvider.mailboxesTarget}.</span>
            <span>Warmup {snapshot.health.outboundProvider.warmupDays}/{snapshot.health.outboundProvider.warmupRequiredDays} días. Gates {snapshot.health.outboundProvider.liveGatesPassed}/{snapshot.health.outboundProvider.activationGatesRequired}. Créditos {snapshot.health.outboundProvider.creditsConsumed ?? "?"}/{snapshot.health.outboundProvider.creditLimit ?? "?"}.</span>
          </div>
          <div>
            <span>Carril Tier 1</span>
            <strong className={`status ${snapshot.health.hybridOutbound.state !== "READY" ? "blocked" : ""}`}>{operationalLabel(snapshot.health.hybridOutbound.effectiveRelease)}. contacto@ennco.com.mx</strong>
            <span>{snapshot.health.hybridOutbound.primaryDeliveries} entregas válidas. Cap {snapshot.health.hybridOutbound.primaryDailyCap}/día.</span>
          </div>
          <div>
            <span>Carril aislado</span>
            <strong className={`status ${snapshot.health.hybridOutbound.isolatedMailboxesReady !== 3 ? "blocked" : ""}`}>{snapshot.health.hybridOutbound.isolatedMailboxesReady}/{snapshot.health.hybridOutbound.isolatedMailboxesTarget} buzones listos</strong>
            <span>Warmup {snapshot.health.hybridOutbound.isolatedWarmupDays.length > 0 ? snapshot.health.hybridOutbound.isolatedWarmupDays.map((days) => `${days}/42`).join(", ") : "sin evidencia live"}.</span>
          </div>
          <div>
            <span>Watchdog</span>
            <strong className={`status ${snapshot.health.operations.state !== "HEALTHY" ? "blocked" : ""}`}>{operationalLabel(snapshot.health.operations.state)}. Operador {operationalLabel(snapshot.health.operations.operatorAssignment)}</strong>
            <span>{snapshot.health.operations.lastWatchdogAt ? `Última corrida ${new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short" }).format(new Date(snapshot.health.operations.lastWatchdogAt))}` : operationalLabel(snapshot.health.operations.reasonCode)}</span>
          </div>
          <div>
            <span>Capacidad {civilDateValue(snapshot.health.capacity.month)}</span>
            <strong className={`status ${snapshot.health.capacity.state === "UNKNOWN" || snapshot.health.capacity.state === "FULL" ? "blocked" : ""}`}>{capacityLabels[snapshot.health.capacity.state]}. {snapshot.health.capacity.committed}/{snapshot.health.capacity.limit ?? "?"}. {snapshot.health.capacity.available ?? "?"} disponibles</strong>
            {snapshot.health.capacity.unscheduled > 0 ? <span>{snapshot.health.capacity.unscheduled} proyectos ganados sin fecha</span> : null}
          </div>
          <div>
            <span>Investigación</span>
            <strong className={`status ${snapshot.health.research.decision !== "PASS" ? "blocked" : ""}`}>{operationalLabel(snapshot.health.research.decision)}. {snapshot.health.research.verifiedAccounts}/{snapshot.health.research.targetAccounts} empresas. {snapshot.health.research.verifiedContacts}/{snapshot.health.research.targetContacts} contactos</strong>
            <span>{operationalLabel(snapshot.health.research.outreachState)}. {snapshot.health.research.outreachEligibleRecords} autorizados</span>
          </div>
          <div>
            <span>Cadencia</span>
            <strong className={`status ${snapshot.health.cadence.state !== "HEALTHY" || snapshot.health.cadence.outbound_release !== "ALLOWED" ? "blocked" : ""}`}>{operationalLabel(snapshot.health.cadence.state)}. {snapshot.health.cadence.cadence_count}/{snapshot.health.cadence.required_cadence_count} cadencias</strong>
            <span>{snapshot.health.cadence.last_reconciled_at ? `Heartbeat ${operationalLabel(snapshot.health.cadence.heartbeat_state)}. ${new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short" }).format(new Date(snapshot.health.cadence.last_reconciled_at))}` : operationalLabel(snapshot.health.cadence.reason_code)}</span>
          </div>
        </section>
      </details>

      <PortalRowsTable actionKind="respuestas" evidenceClass={snapshot.evidenceClass} module={snapshot.modules.respuestas} />
      {snapshot.evidenceClass === "synthetic_demo" ? <GoldenPathControl /> : null}
    </main>
  );
}
