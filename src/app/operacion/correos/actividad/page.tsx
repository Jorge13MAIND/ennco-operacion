import type { Route } from "next";
import Link from "next/link";

import { CorreosActividad } from "@/components/CorreosActividad";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { loadDirectLaneActivityPage, type ActivityRequest } from "@/lib/correos/activity-page";
import { operationalLabel } from "@/lib/operations/presentation";

export const dynamic = "force-dynamic";

export default async function CorreosActividadPage({ searchParams }: { searchParams: Promise<ActivityRequest> }) {
  const access = await requireOperationsAccess();
  const page = await loadDirectLaneActivityPage(access, await searchParams);
  return (
    <main className="shell section operations-main" id="main-content" tabIndex={-1}>
      <header className="operations-page-heading">
        <div>
          <p className="eyebrow">Control Room · Correos</p>
          <h1>Actividad del <span className="cr-accent-text">carril</span>.</h1>
          <p>Lo que salió, lo que entró y lo que falló, correo por correo. Filtra por buzón, tipo de toque, estado o campaña. Operar el carril es en <Link href={"/operacion/correos" as Route}>Correos</Link>; las tasas están en <Link href={"/operacion/correos/estadisticas" as Route}>Estadísticas</Link>.</p>
        </div>
        {page.evidenceClass === "live" ? null : <span className="badge">{operationalLabel(page.evidenceClass)}</span>}
      </header>
      {page.evidenceClass === "live" ? null : (
        <div className="notice operations-disclosure">
          <strong>Ejemplo operativo.</strong>
          <p>Los registros marcados SIMULACION no son correos reales: muestran la forma de la pantalla, no el negocio.</p>
        </div>
      )}
      <CorreosActividad page={page} />
    </main>
  );
}
