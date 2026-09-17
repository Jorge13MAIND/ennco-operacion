"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/* Piezas visuales compartidas por cotizador, precios y proyectos. Antes vivian en components/projects/ui.tsx. */

export const money = (value: number | undefined) =>
  value === undefined
    ? "Sin acceso"
    : new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: "MXN",
        maximumFractionDigits: 2,
      }).format(value);

export const quantity = (value: number, digits = 2) =>
  new Intl.NumberFormat("es-MX", { maximumFractionDigits: digits }).format(
    value,
  );

export function dateLabel(value: string | undefined) {
  if (!value) return "Sin fecha";
  const parsed = new Date(
    value.length === 10 ? `${value}T12:00:00-06:00` : value,
  );
  return Number.isNaN(parsed.getTime())
    ? "Sin fecha"
    : new Intl.DateTimeFormat("es-MX", {
        dateStyle: "medium",
        timeZone: "America/Mexico_City",
      }).format(parsed);
}

export function errorMessage(code: string): string {
  const known: Record<string, string> = {
    PROJECT_AUTHENTICATION_REQUIRED: "Tu sesión terminó. Vuelve a entrar.",
    PROJECT_JSON_INVALID: "La información enviada no es válida.",
    PROJECT_INPUT_INVALID: "Revisa los campos señalados.",
    SOLAR_FORBIDDEN: "Tu rol no permite esta acción.",
    SOLAR_STORAGE_UNAVAILABLE: "La base no respondió. Intenta de nuevo.",
    NETWORK_ERROR: "Sin conexión. Revisa tu red e intenta de nuevo.",
  };
  if (known[code]) return known[code]!;
  if (/NOT_FOUND/.test(code)) return "El registro ya no existe.";
  if (/FORBIDDEN|ROLE_REQUIRED/.test(code)) return "Tu rol no permite esta acción.";
  return "No se completó la acción. Intenta de nuevo; si sigue igual, avisa a Teckel.";
}

export function useResource<T>(url: string) {
  const [state, setState] = useState<{
    data: T | null;
    error: string | null;
    loading: boolean;
  }>({ data: null, error: null, loading: true });
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    try {
      const response = await fetch(url, {
        cache: "no-store",
        credentials: "same-origin",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data)
        throw new Error(
          typeof data?.error === "string" ? data.error : "PROJECTS_UNAVAILABLE",
        );
      if (current === generation.current)
        setState({ data: data as T, error: null, loading: false });
    } catch (error) {
      if (current === generation.current)
        setState((previous) => ({
          ...previous,
          error: errorMessage(
            error instanceof Error ? error.message : "NETWORK_ERROR",
          ),
          loading: false,
        }));
    }
  }, [url]);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    void reload();
    return invalidate;
  }, [reload, invalidate]);
  return { ...state, reload };
}

export function useMutation(onSaved?: () => Promise<unknown> | void) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  async function run<T = unknown>(url: string, payload: unknown, method = "POST"): Promise<T | null> {
    setPending(true); setError(null); setSuccess(false);
    try {
      const response = await fetch(url, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: payload === undefined ? undefined : JSON.stringify(payload) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "PROJECTS_UNAVAILABLE");
      setSuccess(true);
      if (onSaved) await onSaved();
      return result as T;
    } catch (failure) {
      setError(errorMessage(failure instanceof Error ? failure.message : "NETWORK_ERROR"));
      return null;
    } finally { setPending(false); }
  }
  return { pending, error, success, run };
}
export type Mutation = ReturnType<typeof useMutation>;

export function PageHeader({
  eyebrow = "Proyectos ENNCO",
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="projects-header">
      <div>
        <span className="projects-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children ? <div className="projects-toolbar">{children}</div> : null}
    </header>
  );
}

export function Panel({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="projects-panel">
      <div className="projects-panel-head">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Notice({
  children,
  tone = "info",
  role,
}: {
  children: ReactNode;
  tone?: "info" | "warning" | "danger" | "success";
  role?: "alert" | "status";
}) {
  return (
    <div className="projects-notice" data-tone={tone} role={role}>
      {children}
    </div>
  );
}

export function Empty({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="projects-empty">
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "warning" | "danger" | "success";
}) {
  return (
    <span className="projects-badge" data-tone={tone}>
      {children}
    </span>
  );
}

export function Metric({
  label,
  value,
  help,
}: {
  label: string;
  value: ReactNode;
  help?: string;
}) {
  return (
    <div className="projects-metric">
      <span>{label}</span>
      <strong
        data-numeric={
          typeof value === "number" ||
          (typeof value === "string" && /^[$\d-]/.test(value))
            ? true
            : undefined
        }
      >
        {value}
      </strong>
      {help ? <small>{help}</small> : null}
    </div>
  );
}

export function LoadingState({
  title = "Cargando expediente",
}: {
  title?: string;
}) {
  return (
    <Notice role="status">
      <strong>{title}</strong>
      <p>Consultando la información más reciente…</p>
    </Notice>
  );
}

export function LoadError({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <Notice tone="danger" role="alert">
      <strong>No pudimos cargar esta información</strong>
      <p>{message}</p>
      <button
        className="projects-button"
        data-variant="secondary"
        onClick={retry}
        type="button"
      >
        Volver a intentar
      </button>
    </Notice>
  );
}

