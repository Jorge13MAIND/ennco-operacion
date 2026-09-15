import type { Route } from "next";
import Link from "next/link";

import { LeadsInventario } from "@/components/LeadsInventario";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { loadLeadInventoryPage, type LeadRequest } from "@/lib/leads/inventory-page";
import { operationalLabel } from "@/lib/operations/presentation";

export const dynamic = "force-dynamic";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<LeadRequest> }) {
  const access = await requireOperationsAccess();
  const page = await loadLeadInventoryPage(access, await searchParams);
  return (
    <main className="shell section operations-main" id="main-content" tabIndex={-1}>
      <header className="operations-page-heading">
        <div>
          <p className="eyebrow">Control Room · Leads</p>
          <h1>Todos los <span className="cr-accent-text">leads</span>.</h1>
          <p>Cada contacto de la base con la lista de la que salió, la empresa y la etapa en que va: sin enviar, en cola, toque enviado, respondió o rebotó. Los porcentajes de arriba se calculan sobre el filtro. Inscribir es en <Link href={"/operacion/correos" as Route}>Correos</Link>; clasificar y contestar respuestas es en <Link href={"/operacion/respuestas" as Route}>Respuestas</Link>.</p>
        </div>
        {page.evidenceClass === "live" ? null : <span className="badge">{operationalLabel(page.evidenceClass)}</span>}
      </header>
      {page.evidenceClass === "live" ? null : (
        <div className="notice operations-disclosure">
          <strong>Ejemplo operativo.</strong>
          <p>Los renglones marcados SIMULACION no son empresas ni personas reales: muestran la forma de la pantalla, no el negocio.</p>
        </div>
      )}
      <LeadsInventario page={page} />
    </main>
  );
}
