"use client";

import { useRef, useState } from "react";

import type { GoldenPathResult } from "@/lib/domain/types";

type GoldenPathApiResponse = {
  evidence_class: "synthetic_demo";
  external_side_effects: 0;
  result: GoldenPathResult;
};

export function GoldenPathControl() {
  const runKey = useRef(`control-room-${crypto.randomUUID()}`);
  const [response, setResponse] = useState<GoldenPathApiResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const result = await fetch("/api/v1/internal/synthetic/golden-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: runKey.current, suppressed: false }),
      });
      if (!result.ok) throw new Error("No se pudo ejecutar el golden path.");
      setResponse((await result.json()) as GoldenPathApiResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo ejecutar el golden path.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="card" style={{ marginBottom: 22 }}>
      <p className="eyebrow">Golden path local</p>
      <h2 style={{ fontSize: 28 }}>Prueba la columna vertebral sin contacto externo.</h2>
      <p>
        Empresa, supresión, mensaje dry run, respuesta, lead estricto, alerta, portal y siguiente acción. La segunda ejecución usa la misma llave y debe responder DUPLICATE.
      </p>
      <button className="button" disabled={pending} onClick={() => void run()} type="button">
        {pending ? "Ejecutando..." : response ? "Repetir con la misma llave" : "Ejecutar golden path"}
      </button>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {response ? (
        <>
          <div className="result-grid">
            <div className="result-item"><span>Estado</span><strong>{response.result.status}</strong></div>
            <div className="result-item"><span>Efectos externos</span><strong>{response.external_side_effects}</strong></div>
            <div className="result-item"><span>Lead sintético</span><strong>{response.result.leadId ? "Creado" : "No creado"}</strong></div>
            <div className="result-item"><span>Auditoría</span><strong>{response.result.trace.length} etapas</strong></div>
          </div>
          <ol className="audit-trace" aria-label="Traza del golden path">
            {response.result.trace.map((event) => (
              <li key={`${event.sequence}-${event.stage}`}>
                <span>{event.sequence}</span>
                <strong>{event.stage}</strong>
                <code>{event.recordId.slice(0, 8)}</code>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  );
}
