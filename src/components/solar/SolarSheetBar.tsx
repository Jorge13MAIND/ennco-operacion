"use client";

import { useEffect } from "react";

/** Barra que no se imprime: dispara el diálogo de impresión para guardar como PDF. */
export function SolarSheetBar({ name, auto }: { name: string; auto: boolean }) {
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [auto]);
  return (
    <div className="hj-bar">
      <button type="button" className="projects-button is-primary" onClick={() => window.print()}>Descargar PDF</button>
      <button type="button" className="projects-button" onClick={() => window.history.back()}>Volver</button>
      <p>{name} · elige &ldquo;Guardar como PDF&rdquo; en el destino de impresión.</p>
    </div>
  );
}
