import type { Route } from "next";
import Link from "next/link";

import { CorreosEstadisticas } from "@/components/CorreosEstadisticas";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { loadDirectLaneStatsPage } from "@/lib/correos/stats-page";
import { operationalLabel } from "@/lib/operations/presentation";

export const dynamic = "force-dynamic";

export default async function CorreosEstadisticasPage({ searchParams }: { searchParams: Promise<{ campana?: string; rango?: string }> }) {
  const access = await requireOperationsAccess();
  const page = await loadDirectLaneStatsPage(access, await searchParams);
  return (
    <main className="shell section operations-main" id="main-content" tabIndex={-1}>
      <header className="operations-page-heading">
        <div>
          <p className="eyebrow">Control Room · Correos</p>
          <h1>Estadísticas del <span className="cr-accent-text">carril</span>.</h1>
          <p>Una campaña a la vez, sin mezclar la prueba interna con los prospectos reales. Operar el carril es en <Link href={"/operacion/correos" as Route}>Correos</Link>.</p>
        </div>
        {page.evidenceClass === "live" ? null : <span className="badge">{operationalLabel(page.evidenceClass)}</span>}
      </header>
      {page.evidenceClass === "live" ? null : (
        <div className="notice operations-disclosure">
          <strong>Ejemplo operativo.</strong>
          <p>Los números marcados SIMULACION no son campañas ni prospectos reales: muestran la forma de la pantalla, no el negocio.</p>
        </div>
      )}
      <CorreosEstadisticas page={page} />
    </main>
  );
}
