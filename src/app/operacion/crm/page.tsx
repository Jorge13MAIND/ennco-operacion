import { CrmApp } from "@/components/crm/CrmApp";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { loadCrm } from "@/lib/crm/load";
import { operationalLabel } from "@/lib/operations/presentation";
import "@/styles/crm.css";

export const dynamic = "force-dynamic";

export default async function CrmPage() {
  const access = await requireOperationsAccess();
  const screen = await loadCrm(access);
  return (
    <main className="shell section operations-main crm-main" id="main-content" tabIndex={-1}>
      <header className="operations-page-heading">
        <div>
          <p className="eyebrow">Control Room · CRM</p>
          <h1>Los contactos que <span className="cr-accent-text">respondieron</span>.</h1>
          <p>Cada respuesta humana a los correos entra sola, con su empresa, lo que escribió y el responsable. Para pasar a Calificado se marcan las condiciones del informe de Paco y una siguiente acción con fecha. Los negativos quedan en Descartados con su motivo.</p>
        </div>
        {screen.evidenceClass === "live" ? null : <span className="badge">{operationalLabel(screen.evidenceClass)}</span>}
      </header>
      {screen.evidenceClass === "live" ? null : (
        <div className="notice operations-disclosure">
          <strong>Ejemplo operativo.</strong>
          <p>Los contactos marcados SIMULACION no son personas reales: muestran la forma de la pantalla, no el negocio.</p>
        </div>
      )}
      <CrmApp data={screen} me={screen.me} canEdit={screen.canEdit} />
    </main>
  );
}
