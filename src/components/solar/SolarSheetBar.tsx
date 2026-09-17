"use client";

import { useEffect } from "react";

/** Barra que no se imprime: dispara el diálogo de impresión para guardar como PDF. */
export function SolarSheetBar({ name, auto, quoteId }: { name: string; auto: boolean; quoteId?: string | null }) {
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [auto]);
  return (
    <div className="hj-bar">
      {quoteId ? <a className="projects-button is-primary" href={`/api/v1/solar/quotes/${quoteId}/pdf`}>Descargar PDF</a> : <button type="button" className="projects-button is-primary" onClick={() => window.print()}>Descargar PDF</button>}
      <button type="button" className="projects-button" onClick={() => window.history.back()}>Volver</button>
      <p>{name} · el PDF se genera con el formato del libro, en dos páginas.</p>
    </div>
  );
}
