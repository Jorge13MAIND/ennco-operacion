"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { AttributionInput, PrequoteEstimate } from "@/lib/domain/types";
import { PRIVACY_NOTICE_VERSION } from "@/lib/privacy/notice";

type PrequoteApiResponse = {
  record_id: string;
  correlation_id: string;
  idempotency_key: string;
  folio: string;
  estimate: PrequoteEstimate;
  evidence_class: "synthetic_demo" | "live";
  persistence_status: "SYNTHETIC_NOT_PERSISTED" | "PERSISTED";
  pdf_url: string;
  pdf_expires_at: string;
};

type PrequoteFormProps = {
  demoMode: boolean;
  attribution: AttributionInput;
};

function mxnRange(value: { min: number; max: number }): string {
  const formatter = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
  return `${formatter.format(value.min)} a ${formatter.format(value.max)}`;
}

function mxn(value: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(value);
}

function numberRange(value: { min: number; max: number }, unit: string): string {
  const formatter = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
  return `${formatter.format(value.min)} a ${formatter.format(value.max)} ${unit}`;
}

function confidenceLabel(value: PrequoteEstimate["evidenceConfidence"]): string {
  if (value === "SOURCE_RANGE") return "Rango respaldado por referencias";
  if (value === "INDUSTRIAL_REVIEW_REQUIRED") return "Proyecto industrial, revisión técnica y comercial requerida";
  return "Revisión técnica requerida";
}

export function PrequoteForm({ demoMode, attribution }: PrequoteFormProps) {
  const [result, setResult] = useState<PrequoteApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const sessionId = useRef(crypto.randomUUID());
  const started = useRef(false);

  function track(
    eventName: "DIAGNOSTIC_VIEWED" | "PREQUOTE_STARTED" | "PREQUOTE_SUBMITTED" | "PREQUOTE_SUCCEEDED" | "PREQUOTE_FAILED" | "PDF_DOWNLOADED",
    properties: Record<string, string> = {},
    correlationId: string | null = null,
  ): void {
    void fetch("/api/v1/events", {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        eventName,
        sessionId: sessionId.current,
        correlationId,
        path: "/diagnostico",
        properties,
        occurredAt: new Date().toISOString(),
      }),
    }).catch(() => undefined);
  }

  useEffect(() => {
    track("DIAGNOSTIC_VIEWED");
  }, []);

  async function submit(formData: FormData): Promise<void> {
    setPending(true);
    setError(null);
    setResult(null);
    track("PREQUOTE_SUBMITTED");
    const payload = {
      needType: formData.get("needType"),
      monthlySpendMxn: Number(formData.get("monthlySpendMxn")),
      tariff: formData.get("tariff"),
      existingCapacityKwp: Number(formData.get("existingCapacityKwp")),
      coverageTargetPct: Number(formData.get("coverageTargetPct")),
      city: formData.get("city"),
      state: formData.get("state"),
      zone: formData.get("zone"),
      contact: {
        company: formData.get("company"),
        fullName: formData.get("fullName"),
        role: formData.get("role"),
        email: formData.get("email"),
        phone: formData.get("phone"),
      },
      consent: formData.get("consent") === "on",
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      attribution,
      website: formData.get("website"),
    };

    try {
      const response = await fetch("/api/v1/prequotes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = typeof body === "object" && body !== null && "error" in body ? String(body.error) : "No se pudo calcular.";
        throw new Error(message);
      }
      if (response.status === 202) throw new Error("No se pudo procesar la solicitud.");
      const successful = body as PrequoteApiResponse;
      setResult(successful);
      track("PREQUOTE_SUCCEEDED", {
        estimate_kind: successful.estimate.estimateKind,
        verdict: successful.estimate.verdict,
        model_version: successful.estimate.modelVersion,
      }, successful.correlation_id);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "No se pudo calcular.";
      setError(message);
      track("PREQUOTE_FAILED", { error_code: /^[A-Z0-9_.:-]+$/.test(message) ? message : "CLIENT_ERROR" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="form-shell">
      <form
        className="form-card"
        onChange={() => {
          if (!started.current) {
            started.current = true;
            track("PREQUOTE_STARTED");
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          void submit(new FormData(event.currentTarget));
        }}
      >
        <div aria-hidden="true" className="honeypot-field">
          <label htmlFor="website">Sitio web</label>
          <input autoComplete="off" id="website" name="website" tabIndex={-1} />
        </div>

        <fieldset className="form-step">
          <legend><span>1</span> Necesidad</legend>
          <div className="form-grid">
            <div className="field full">
              <label htmlFor="needType">¿Qué necesita la planta?</label>
              <select defaultValue="SOLAR_NEW" id="needType" name="needType">
                <option value="SOLAR_NEW">Proyecto solar nuevo</option>
                <option value="SOLAR_EXISTING">Sistema solar existente</option>
                <option value="MAINTENANCE_THERMOGRAPHY">Mantenimiento y termografía</option>
                <option value="ELECTRICAL_INFRASTRUCTURE">Infraestructura eléctrica</option>
                <option value="TRANSFORMERS">Transformadores</option>
                <option value="STORAGE">Almacenamiento</option>
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset className="form-step">
          <legend><span>2</span> Consumo y objetivo</legend>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="monthlySpendMxn">Gasto mensual CFE</label>
              <input defaultValue={demoMode ? "150000" : undefined} id="monthlySpendMxn" min="0" name="monthlySpendMxn" required step="0.01" type="number" />
            </div>
            <div className="field">
              <label htmlFor="tariff">Tarifa</label>
              <select defaultValue="GDMTH" id="tariff" name="tariff">
                <option value="GDMTH">GDMTH</option>
                <option value="GDMTO">GDMTO</option>
                <option value="PDBT">PDBT</option>
                <option value="UNKNOWN">No sé</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="existingCapacityKwp">Capacidad instalada actual, kWp</label>
              <input defaultValue="0" id="existingCapacityKwp" min="0" name="existingCapacityKwp" step="0.001" type="number" />
            </div>
            <div className="field">
              <label htmlFor="coverageTargetPct">Cobertura objetivo, %</label>
              <input defaultValue="75" id="coverageTargetPct" max="100" min="30" name="coverageTargetPct" step="0.1" type="number" />
            </div>
          </div>
        </fieldset>

        <fieldset className="form-step">
          <legend><span>3</span> Sitio</legend>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="city">Ciudad</label>
              <input defaultValue={demoMode ? "León" : undefined} id="city" name="city" required />
            </div>
            <div className="field">
              <label htmlFor="state">Estado</label>
              <input defaultValue={demoMode ? "Guanajuato" : undefined} id="state" name="state" required />
            </div>
            <div className="field full">
              <label htmlFor="zone">Tipo de zona</label>
              <select defaultValue="URBAN" id="zone" name="zone">
                <option value="URBAN">Urbana</option>
                <option value="SUBURBAN">Suburbana</option>
                <option value="RURAL">Rural</option>
              </select>
            </div>
            <div className="field full">
              <label htmlFor="receipt">Recibo CFE, opcional</label>
              <input disabled id="receipt" type="file" />
              <small>Documento sensible. La carga permanece cerrada hasta confirmar antivirus y almacenamiento privado.</small>
            </div>
          </div>
        </fieldset>

        <fieldset className="form-step">
          <legend><span>4</span> Contacto</legend>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="company">Empresa</label>
              <input defaultValue={demoMode ? "Planta de prueba" : undefined} id="company" name="company" required />
            </div>
            <div className="field">
              <label htmlFor="fullName">Nombre</label>
              <input defaultValue={demoMode ? "Contacto sintético" : undefined} id="fullName" name="fullName" required />
            </div>
            <div className="field">
              <label htmlFor="role">Cargo</label>
              <input defaultValue={demoMode ? "Dirección de planta" : undefined} id="role" name="role" required />
            </div>
            <div className="field">
              <label htmlFor="email">Correo</label>
              <input defaultValue={demoMode ? "synthetic@example.com" : undefined} id="email" name="email" required type="email" />
            </div>
            <div className="field full">
              <label htmlFor="phone">Teléfono</label>
              <input defaultValue={demoMode ? "4770000000" : undefined} id="phone" name="phone" required type="tel" />
            </div>
          </div>
        </fieldset>

        <label className="checkbox-row">
          <input defaultChecked={demoMode} name="consent" required type="checkbox" />
          <span>
            Acepto que ENNCO use estos datos para elaborar y dar seguimiento al diagnóstico. Consulta el{` `}
            <Link href="/privacidad" onClick={(event) => event.stopPropagation()}>aviso de privacidad</Link>.
          </span>
        </label>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <button className="button" disabled={pending} type="submit">
          {pending ? "Calculando..." : "Generar referencia"}
        </button>
      </form>

      <aside aria-live="polite" className="result-card">
        <div className="result-card-heading">
          <span className="result-step">5</span>
          <div><span className="badge">Resultado preliminar</span><h2>Referencia técnica</h2></div>
        </div>
        {!result ? (
          <div className="result-empty">
            <p className="lede">Completa las cuatro etapas. Aquí aparecerán los rangos, supuestos y nivel de confianza.</p>
            <ul>
              <li>Capacidad estimada</li>
              <li>Área y módulos</li>
              <li>Inversión preliminar</li>
              <li>Condiciones de revisión</li>
            </ul>
          </div>
        ) : (
          <>
            <p><strong>{result.folio}</strong></p>
            {result.estimate.estimateKind === "SOLAR_RANGE" ? (
              <div className="result-grid">
                <div className="result-item"><span>Capacidad</span><strong>{numberRange(result.estimate.capacityKwp, "kWp")}</strong></div>
                <div className="result-item">
                  <span>Inversión</span>
                  <strong>{result.estimate.investmentMxn
                    ? mxnRange(result.estimate.investmentMxn)
                    : "Revisión técnica y comercial"}</strong>
                </div>
                <div className="result-item"><span>Área</span><strong>{numberRange(result.estimate.roofAreaM2, "m²")}</strong></div>
                <div className="result-item"><span>Módulos</span><strong>{numberRange(result.estimate.panelCount, "")}</strong></div>
              </div>
            ) : (
              <div className="notice">
                <strong>Revisión técnica requerida.</strong>
                <p>Este servicio no genera precio, garantía ni fecha automáticos.</p>
              </div>
            )}
            <div className="notice">
              <strong>Referencias comerciales sujetas al contrato final.</strong>
              <p>
                Precio de arranque: {mxn(result.estimate.commercialReferences.installedModuleStartingPriceMxn)} por módulo instalado.
                Pago de contado: {result.estimate.commercialReferences.cashDiscountPct.min}% a {result.estimate.commercialReferences.cashDiscountPct.max}%.
                Garantía de referencia: {result.estimate.commercialReferences.hiddenDefectsWarrantyMonths} meses por vicios ocultos.
              </p>
              <p>El precio contractual y la fecha de instalación requieren validación comercial, disponibilidad de materiales y programación de obra.</p>
            </div>
            <p className="fine">{result.estimate.disclaimer}</p>
            <p className="fine">Confianza: {confidenceLabel(result.estimate.evidenceConfidence)}. Esta solicitud todavía no cuenta como lead contractual.</p>
            <a
              className="button secondary"
              href={result.pdf_url}
              onClick={() => track("PDF_DOWNLOADED", { model_version: result.estimate.modelVersion }, result.correlation_id)}
            >
              Descargar PDF
            </a>
            <p className="fine">Evidencia: {result.evidence_class}. Persistencia: {result.persistence_status}. Correlation ID: {result.correlation_id}</p>
          </>
        )}
      </aside>
    </div>
  );
}
