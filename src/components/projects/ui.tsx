"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  JsonRecord,
  ProjectReadiness,
  ProjectRecord,
} from "@/lib/projects/types";

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
export const str = (data: JsonRecord, key: string, fallback = "") =>
  typeof data[key] === "string" ? (data[key] as string) : fallback;
export const num = (data: JsonRecord, key: string, fallback = 0) =>
  typeof data[key] === "number" && Number.isFinite(data[key])
    ? (data[key] as number)
    : fallback;
export const obj = (value: unknown): JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
export const list = (value: unknown): JsonRecord[] =>
  Array.isArray(value) ? value.map(obj) : [];
export const textValue = (form: FormData, key: string) =>
  String(form.get(key) ?? "").trim();
export const numberValue = (form: FormData, key: string) =>
  Number(textValue(form, key));
export function optionalNumber(form: FormData, key: string) {
  const value = textValue(form, key);
  return value ? Number(value) : undefined;
}
export function optionalText(form: FormData, key: string) {
  return textValue(form, key) || undefined;
}
export const isChecked = (form: FormData, key: string) =>
  form.get(key) === "on";
export function activeRecords(records: ProjectRecord[]) {
  const reversed = new Set(
    records
      .filter((record) => record.kind === "reversal")
      .map((record) => str(record.data, "recordId")),
  );
  return records.filter((record) => !reversed.has(record.id));
}
export function recordName(record: ProjectRecord) {
  return (
    str(record.data, "name") ||
    str(record.data, "number") ||
    str(record.data, "reference") ||
    str(record.data, "description") ||
    str(record.data, "supplier") ||
    `Registro ${record.revision} · ${dateLabel(record.createdAt)}`
  );
}

const errors: Record<string, string> = {
  PROJECT_VERSION_CONFLICT:
    "El proyecto cambió en otra sesión. Actualiza el expediente y revisa tus datos antes de guardar otra vez.",
  VERSION_CONFLICT:
    "Hay una revisión más reciente. Actualiza el expediente antes de guardar.",
  PROJECT_NOT_FOUND:
    "No encontramos este proyecto o tu cuenta no tiene acceso.",
  PROJECTS_UNAVAILABLE:
    "Los proyectos no están disponibles por el momento. Intenta actualizar en unos minutos.",
  PROJECTS_STORAGE_UNAVAILABLE:
    "El almacenamiento de proyectos todavía no está disponible. No se guardaron cambios.",
  PROJECT_ACCESS_DENIED:
    "Tu cuenta no tiene permiso para realizar esta acción.",
  PROJECT_PERMISSION_DENIED:
    "Tu cuenta no tiene permiso para realizar esta acción.",
  PROJECT_PURCHASES_NOT_RELEASED:
    "Compras requiere el anticipo confirmado por Administración o una excepción de Dirección.",
  PURCHASES_NOT_RELEASED:
    "Confirma el anticipo o registra una excepción de Dirección antes de emitir una orden.",
  DRIVE_NOT_CONFIGURED:
    "La conexión al Drive de ENNCO está pendiente. Puedes continuar con el resto del expediente.",
  DRIVE_UNAVAILABLE:
    "No fue posible sincronizar con Drive. Conservamos el expediente para que puedas reintentar.",
  SYNTHETIC_MUTATION_DISABLED:
    "Este ambiente es de demostración y no guarda información real.",
  PROJECTS_DEMO_READ_ONLY:
    "Este ambiente es de demostración y no guarda información real.",
  NETWORK_ERROR:
    "No fue posible conectar. Tus datos siguen en el formulario; vuelve a intentar.",
  VALIDATION_ERROR:
    "Revisa los datos del formulario. Hay información incompleta o fuera del rango permitido.",
};
export function errorMessage(code: string): string {
  if (errors[code]) return errors[code];
  if (/VERSION|CONFLICT|DRIFT/.test(code))
    return errors.PROJECT_VERSION_CONFLICT!;
  if (/PERMISSION|FORBIDDEN|ROLE_REQUIRED|AUTHORIZATION/.test(code))
    return errors.PROJECT_ACCESS_DENIED!;
  if (/PURCHASE.*RELEASE|ADVANCE_REQUIRED/.test(code))
    return errors.PURCHASES_NOT_RELEASED!;
  if (/INVALID|REQUIRED|INCOMPLETE/.test(code)) return errors.VALIDATION_ERROR!;
  return "No se completó la acción. Revisa los datos y vuelve a intentar; si el problema continúa, contacta al administrador.";
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

export function useProjectMutation(onSaved: () => Promise<unknown>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const command = useRef<{ fingerprint: string; key: string } | null>(null);
  const inflight = useRef(false);
  async function run<T = unknown>(
    url: string,
    body: unknown,
    method = "POST",
  ): Promise<T | null> {
    if (inflight.current) return null;
    inflight.current = true;
    setPending(true);
    setError(null);
    setSuccess(false);
    try {
      const isMultipart = body instanceof FormData;
      const fingerprint = `${method}:${url}:${isMultipart ? Array.from(body.entries(), ([key, value]) => `${key}:${typeof value === "string" ? value : `${value.name}:${value.size}:${value.lastModified}`}`).join("|") : JSON.stringify(body)}`;
      if (command.current?.fingerprint !== fingerprint) {
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(crypto.randomUUID()),
        );
        command.current = {
          fingerprint,
          key: Array.from(new Uint8Array(digest), (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join(""),
        };
      }
      const response = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: {
          ...(isMultipart ? {} : { "Content-Type": "application/json" }),
          "Idempotency-Key": command.current.key,
        },
        body: isMultipart ? body : JSON.stringify(body),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          typeof result?.error === "string"
            ? result.error
            : "PROJECTS_UNAVAILABLE",
        );
      command.current = null;
      setSuccess(true);
      await onSaved();
      return result as T;
    } catch (failure) {
      setError(
        errorMessage(
          failure instanceof Error ? failure.message : "NETWORK_ERROR",
        ),
      );
      return null;
    } finally {
      setPending(false);
      inflight.current = false;
    }
  }
  return { pending, error, success, run };
}
export type Mutation = ReturnType<typeof useProjectMutation>;

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
      <strong>{value}</strong>
      {help ? <small>{help}</small> : null}
    </div>
  );
}
export function Readiness({ readiness }: { readiness: ProjectReadiness }) {
  if (readiness.demo)
    return (
      <Notice tone="warning">
        <strong>Espacio de demostración</strong>
        <p>
          Usa únicamente datos de prueba. Los cambios se conservan temporalmente
          durante la sesión del servidor y pueden perderse al reiniciarlo. Drive
          y operaciones externas están desactivados.
        </p>
      </Notice>
    );
  if (readiness.storage !== "READY")
    return (
      <Notice tone="warning">
        <strong>El almacenamiento todavía no está listo</strong>
        <p>
          {readiness.message ||
            "Puedes revisar la estructura del espacio. Tus proyectos aparecerán al completar la conexión."}
        </p>
      </Notice>
    );
  return null;
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
export function MutationResult({ mutation }: { mutation: Mutation }) {
  return (
    <>
      {mutation.pending ? (
        <span className="projects-status-text" role="status">
          Guardando…
        </span>
      ) : null}
      {!mutation.pending && mutation.error ? (
        <Notice tone="danger" role="alert">
          {mutation.error}
        </Notice>
      ) : !mutation.pending && mutation.success ? (
        <span className="projects-status-text" role="status">
          Información guardada.
        </span>
      ) : null}
    </>
  );
}
export function Field({
  label,
  name,
  type = "text",
  help,
  required,
  defaultValue,
  min,
  max,
  step,
  options,
  wide,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  help?: string;
  required?: boolean;
  defaultValue?: string | number;
  min?: number | string;
  max?: number | string;
  step?: string | number;
  options?: readonly (string | { value: string; label: string })[];
  wide?: boolean;
  placeholder?: string;
}) {
  const id = `project-field-${useId()}`;
  return (
    <label className="projects-field" data-wide={wide} htmlFor={id}>
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      {type === "textarea" ? (
        <textarea
          defaultValue={defaultValue}
          id={id}
          name={name}
          required={required}
          maxLength={12000}
          placeholder={placeholder}
          aria-describedby={help ? `${id}-help` : undefined}
        />
      ) : options ? (
        <select
          defaultValue={defaultValue ?? ""}
          id={id}
          name={name}
          required={required}
          aria-describedby={help ? `${id}-help` : undefined}
        >
          <option value="">Seleccionar…</option>
          {options.map((option) =>
            typeof option === "string" ? (
              <option key={option} value={option}>
                {option}
              </option>
            ) : (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ),
          )}
        </select>
      ) : (
        <input
          defaultValue={defaultValue}
          id={id}
          name={name}
          type={type}
          min={min}
          max={max}
          step={step ?? (type === "number" ? "any" : undefined)}
          required={required}
          maxLength={type === "number" ? undefined : 1200}
          placeholder={placeholder}
          aria-describedby={help ? `${id}-help` : undefined}
        />
      )}
      {help ? <small id={`${id}-help`}>{help}</small> : null}
    </label>
  );
}
export function Check({
  name,
  children,
  required,
  checked,
}: {
  name: string;
  children: ReactNode;
  required?: boolean;
  checked?: boolean;
}) {
  return (
    <label className="projects-check">
      <input
        type="checkbox"
        name={name}
        required={required}
        defaultChecked={checked}
      />
      <span>{children}</span>
    </label>
  );
}
export function Form({
  children,
  onSubmit,
  mutation,
  submit = "Guardar registro",
  disabled = false,
}: {
  children: ReactNode;
  onSubmit: (data: FormData) => Promise<unknown>;
  mutation: Mutation;
  submit?: string;
  disabled?: boolean;
}) {
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const listener = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, [dirty]);
  return (
    <form
      className="projects-form"
      data-dirty={dirty}
      onChange={() => setDirty(true)}
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const result = await onSubmit(new FormData(form));
        if (result !== null && result !== false) {
          setDirty(false);
        }
      }}
    >
      <fieldset disabled={mutation.pending || disabled}>{children}</fieldset>
      <div className="projects-form-actions">
        <button
          className="projects-button"
          disabled={disabled || mutation.pending}
          type="submit"
        >
          {mutation.pending ? "Guardando…" : submit}
        </button>
        <span className="projects-help">* Campos obligatorios</span>
        <MutationResult mutation={mutation} />
      </div>
    </form>
  );
}
export function RecordSelect({
  records,
  name,
  label,
  required = true,
  defaultValue,
}: {
  records: ProjectRecord[];
  name: string;
  label: string;
  required?: boolean;
  defaultValue?: string;
}) {
  return (
    <Field
      name={name}
      label={label}
      required={required}
      defaultValue={defaultValue}
      options={records.map((record) => ({
        value: record.id,
        label: recordName(record),
      }))}
    />
  );
}
export function DetailList({ values }: { values: Array<[string, ReactNode]> }) {
  return (
    <dl className="projects-detail-grid">
      {values.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value ?? "Sin registrar"}</dd>
        </div>
      ))}
    </dl>
  );
}

export const EVIDENCE_HELP =
  "Liga al documento o referencia verificable dentro del expediente.";
export function EvidenceField({
  name = "evidence",
  label = "Evidencia",
  required = true,
}: {
  name?: string;
  label?: string;
  required?: boolean;
}) {
  return (
    <Field
      name={name}
      label={label}
      required={required}
      help={EVIDENCE_HELP}
      wide
    />
  );
}
