"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Route } from "next";

/** Acciones por cotización: editar, duplicar, hoja en PDF y archivar o restaurar. */
export function SolarQuoteActions({ id, archived }: { id: string; archived: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "duplicar" | "archivar", label: string) {
    setBusy(label); setError(null);
    const url = action === "duplicar" ? `/api/v1/solar/quotes/${id}/duplicar` : `/api/v1/solar/quotes/${id}/estado`;
    const init: RequestInit = action === "duplicar"
      ? { method: "POST" }
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: archived ? "DRAFT" : "ARCHIVED" }) };
    try {
      const res = await fetch(url, init);
      const data = (await res.json().catch(() => null)) as { quote?: { id: string }; error?: string } | null;
      if (!res.ok) {
        setError(res.status === 403 ? "Tu rol no permite esta acción." : data?.error === "SOLAR_QUOTE_NOT_FOUND" ? "La cotización ya no existe." : "No se pudo completar. Intenta de nuevo.");
        return;
      }
      if (action === "duplicar" && data?.quote?.id) {
        router.push(`/operacion/proyectos/cotizar?cotizacion=${data.quote.id}` as Route);
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError("No se pudo completar. Revisa tu conexión.");
    } finally {
      setBusy(null);
    }
  }

  const working = busy !== null || pending;
  return (
    <div className="solar-row-actions">
      {archived ? null : (
        <>
          <Link className="projects-button" href={`/operacion/proyectos/cotizar?cotizacion=${id}` as Route}>Editar</Link>
          <Link className="projects-button" href={`/operacion/proyectos/cotizar/hoja?cotizacion=${id}` as Route} target="_blank">PDF</Link>
          <button type="button" className="projects-button" disabled={working} onClick={() => void run("duplicar", "duplicar")}>{busy === "duplicar" ? "Duplicando…" : "Duplicar"}</button>
        </>
      )}
      <button type="button" className="projects-button" disabled={working} onClick={() => void run("archivar", "archivar")}>
        {busy === "archivar" ? "Guardando…" : archived ? "Restaurar" : "Archivar"}
      </button>
      {error ? <span className="solar-row-error">{error}</span> : null}
    </div>
  );
}
