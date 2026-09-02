"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type MutationStatus = "idle" | "pending" | "done" | "error";

const errorLabels: Record<string, string> = {
  LIVE_ACCESS_REQUIRED: "Esta acción sólo corre con datos reales, no en modo demo.",
  ACCOUNTS_READ_FAILED: "No se pudieron leer las cuentas.",
  EVENTS_READ_FAILED: "No se pudieron leer las respuestas.",
  ICP_WRITE_REJECTED: "La base rechazó la escritura de puntuaciones.",
  SUGGESTIONS_WRITE_REJECTED: "La base rechazó la escritura de sugerencias.",
  INTELLIGENCE_OPERATOR_REQUIRED: "Tu cuenta no tiene rol de operador.",
};

function label(code: string): string {
  return errorLabels[code] ?? code;
}

/**
 * Botón de recálculo. Ambas acciones son idempotentes por diseño: la
 * puntuación se reescribe por (cuenta, rúbrica) y la sugerencia por (evento,
 * clasificador), así que repetirlas no duplica nada ni cambia el resultado.
 */
export function RecalcularAction({ kind, disabled }: { kind: "icp" | "sugerencias"; disabled?: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<MutationStatus>("idle");
  const [message, setMessage] = useState<string>("");

  const copy = kind === "icp"
    ? { button: "Recalcular puntuación", pending: "Puntuando…" }
    : { button: "Generar sugerencias", pending: "Analizando…" };

  async function run() {
    setStatus("pending");
    setMessage("");
    try {
      const response = await fetch(`/api/v1/operations/inteligencia/${kind}`, { method: "POST" });
      const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : "MUTATION_REJECTED");

      const written = Number(payload?.written ?? 0);
      const reason = typeof payload?.reason === "string" ? payload.reason : null;
      setStatus("done");
      setMessage(reason === "SIN_CUENTAS_CARGADAS" ? "No hay empresas cargadas todavía."
        : reason === "SIN_RESPUESTAS_PENDIENTES" ? "No hay respuestas sin clasificar."
        : `${written} registro${written === 1 ? "" : "s"} actualizado${written === 1 ? "" : "s"}.`);
      router.refresh();
    } catch (error) {
      setStatus("error");
      setMessage(label(error instanceof Error ? error.message : "MUTATION_REJECTED"));
    }
  }

  return (
    <span className="action-inline">
      <button className="button" disabled={disabled || status === "pending"} onClick={run} type="button">
        {status === "pending" ? copy.pending : copy.button}
      </button>
      {message ? <span className={`status ${status === "error" ? "blocked" : "ready"}`}>{message}</span> : null}
    </span>
  );
}
