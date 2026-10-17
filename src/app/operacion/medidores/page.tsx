import { MedidoresApp } from "@/components/medidores/MedidoresApp";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { loadMedidores } from "@/lib/medidores/load";
import { operationalLabel } from "@/lib/operations/presentation";
import "@/styles/crm.css";
import "@/styles/medidores.css";

export const dynamic = "force-dynamic";

export default async function MedidoresPage() {
  const access = await requireOperationsAccess();
  const screen = await loadMedidores(access);
  return (
    <main className="shell section operations-main med-page" id="main-content" tabIndex={-1}>
      <header className="operations-page-heading">
        <div>
          <p className="eyebrow">Control Room · Medidores</p>
          <h1>La energía de cada cliente, <span className="cr-accent-text">medida</span>.</h1>
          <p>Analizadores de red e inversores por planta y por punto de medición. Carga el archivo del analizador o recibe lecturas en vivo por API; conecta las plantas solares de Growatt. La pantalla resume consumo, envío a la red, calidad de la energía y alertas, separando lo urgente de lo que solo es dato.</p>
        </div>
        {screen.evidenceClass === "live" ? null : <span className="badge">{operationalLabel(screen.evidenceClass)}</span>}
      </header>
      {screen.evidenceClass === "live" ? null : (
        <div className="notice operations-disclosure">
          <strong>Ejemplo operativo.</strong>
          <p>La planta marcada SIMULACION no es un cliente real: muestra la forma de la pantalla con datos generados.</p>
        </div>
      )}
      <MedidoresApp overview={screen.overview} canEdit={screen.canEdit} />
    </main>
  );
}
