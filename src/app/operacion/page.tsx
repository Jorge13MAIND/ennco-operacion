import { SiteHeader } from "@/components/SiteHeader";
import { GoldenPathControl } from "@/components/GoldenPathControl";
import { getSyntheticControlRoomSnapshot } from "@/lib/control-room/snapshot";

export default function OperationsPage() {
  const snapshot = getSyntheticControlRoomSnapshot();
  return (
    <>
      <SiteHeader />
      <main className="shell section">
        <div className="section-head">
          <div>
            <p className="eyebrow">Control Room</p>
            <h1>Lo que existe, lo que falta y quién mueve lo siguiente.</h1>
          </div>
          <span className="badge">{snapshot.evidenceClass}</span>
        </div>
        <section aria-label="Métricas comerciales sintéticas" className="metric-grid">
          <div className="metric"><span>Empresas investigadas</span><strong>{snapshot.commercial.researchedCompanies}</strong></div>
          <div className="metric"><span>Contactos verificados</span><strong>{snapshot.commercial.verifiedContacts}</strong></div>
          <div className="metric"><span>Leads contractuales</span><strong>{snapshot.commercial.contractualLeads}</strong></div>
          <div className="metric"><span>Pipeline estricto</span><strong>{snapshot.commercial.qualifiedOpportunities}</strong></div>
        </section>
        <section aria-label="Controles de liberación" className="release-strip">
          <div><span>Ambiente</span><strong>{snapshot.system.environment}</strong></div>
          <div><span>Kill switch</span><strong>{snapshot.system.killSwitch ? "ACTIVO" : "INACTIVO"}</strong></div>
          <div><span>Envío externo</span><strong>{snapshot.system.externalSendAllowed ? "HABILITADO" : "BLOQUEADO"}</strong></div>
          <div><span>Riesgos abiertos</span><strong>{snapshot.system.openP0} P0 / {snapshot.system.openP1} P1</strong></div>
        </section>
        <GoldenPathControl />
        <section className="panel">
          <div className="panel-head">
            <h2>Roadmap</h2>
            <span className="badge">Kill switch activo</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Milestone</th>
                  <th>Estado</th>
                  <th>Gate</th>
                  <th>Responsable</th>
                  <th>Fecha</th>
                  <th>Bloqueador</th>
                  <th>Siguiente acción</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.milestones.map((milestone) => (
                  <tr key={milestone.id}>
                    <td data-label="Milestone"><strong>{milestone.id}</strong><br />{milestone.name}</td>
                    <td data-label="Estado"><span className={`status ${milestone.status === "BLOCKED" ? "blocked" : ""}`}>{milestone.status}</span></td>
                    <td data-label="Gate">{milestone.gate ? <span className={`status ${milestone.gate !== "PASS" ? "blocked" : ""}`}>{milestone.gate}</span> : "Pendiente"}</td>
                    <td data-label="Responsable">{milestone.owner}</td>
                    <td data-label="Fecha">{milestone.dueDate}</td>
                    <td data-label="Bloqueador">{milestone.blocker ?? "Sin bloqueo"}</td>
                    <td data-label="Siguiente acción">{milestone.nextAction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
      <footer className="shell footer">Datos sintéticos. Ninguna actividad comercial real ha sido ejecutada.</footer>
    </>
  );
}
