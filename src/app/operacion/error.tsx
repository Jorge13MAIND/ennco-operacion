"use client";

export default function OperationsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="shell section">
      <section className="panel auth-panel">
        <p className="eyebrow">Control Room</p>
        <h1>Los datos live no están disponibles.</h1>
        <p className="lede">El portal no sustituirá una falla de base con datos sintéticos. Reintenta después de revisar la conexión y el incidente.</p>
        <button className="button" onClick={reset} type="button">Reintentar</button>
      </section>
    </main>
  );
}
