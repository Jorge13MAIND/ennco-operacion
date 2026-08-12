"use client";

import { useState } from "react";

import type { PrequoteEstimate } from "@/lib/domain/types";

type PrequoteApiResponse = {
  record_id: string;
  correlation_id: string;
  folio: string;
  estimate: PrequoteEstimate;
  evidence_class: "synthetic_demo" | "live";
};

function mxnRange(value: { min: number; max: number }): string {
  const formatter = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
  return `${formatter.format(value.min)} a ${formatter.format(value.max)}`;
}

function numberRange(value: { min: number; max: number }, unit: string): string {
  const formatter = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
  return `${formatter.format(value.min)} a ${formatter.format(value.max)} ${unit}`;
}

export function PrequoteForm() {
  const [result, setResult] = useState<PrequoteApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData): Promise<void> {
    setPending(true);
    setError(null);
    setResult(null);
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
    };

    try {
      const response = await fetch("/api/v1/prequotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = typeof body === "object" && body !== null && "error" in body ? String(body.error) : "No se pudo calcular.";
        throw new Error(message);
      }
      setResult(body as PrequoteApiResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo calcular.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="form-shell">
      <form
        className="form-card"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(new FormData(event.currentTarget));
        }}
      >
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
          <div className="field">
            <label htmlFor="monthlySpendMxn">Gasto mensual CFE</label>
            <input defaultValue="150000" id="monthlySpendMxn" min="0" name="monthlySpendMxn" required type="number" />
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
            <input defaultValue="0" id="existingCapacityKwp" min="0" name="existingCapacityKwp" type="number" />
          </div>
          <div className="field">
            <label htmlFor="coverageTargetPct">Cobertura objetivo, %</label>
            <input defaultValue="75" id="coverageTargetPct" max="100" min="30" name="coverageTargetPct" type="number" />
          </div>
          <div className="field">
            <label htmlFor="city">Ciudad</label>
            <input defaultValue="León" id="city" name="city" required />
          </div>
          <div className="field">
            <label htmlFor="state">Estado</label>
            <input defaultValue="Guanajuato" id="state" name="state" required />
          </div>
          <div className="field full">
            <label htmlFor="zone">Tipo de zona</label>
            <select defaultValue="URBAN" id="zone" name="zone">
              <option value="URBAN">Urbana</option>
              <option value="SUBURBAN">Suburbana</option>
              <option value="RURAL">Rural</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="company">Empresa</label>
            <input defaultValue="Planta de prueba" id="company" name="company" required />
          </div>
          <div className="field">
            <label htmlFor="fullName">Nombre</label>
            <input defaultValue="Contacto sintético" id="fullName" name="fullName" required />
          </div>
          <div className="field">
            <label htmlFor="role">Cargo</label>
            <input defaultValue="Dirección de planta" id="role" name="role" required />
          </div>
          <div className="field">
            <label htmlFor="email">Correo</label>
            <input defaultValue="synthetic@example.com" id="email" name="email" required type="email" />
          </div>
          <div className="field full">
            <label htmlFor="phone">Teléfono</label>
            <input defaultValue="4770000000" id="phone" name="phone" required type="tel" />
          </div>
        </div>
        <label className="checkbox-row">
          <input defaultChecked name="consent" type="checkbox" />
          <span>Acepto que ENNCO use estos datos para elaborar y dar seguimiento al diagnóstico.</span>
        </label>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <button className="button" disabled={pending} type="submit">
          {pending ? "Calculando..." : "Generar referencia"}
        </button>
      </form>
      <aside aria-live="polite" className="result-card">
        <span className="badge">Modelo preliminar en staging</span>
        <h2>Referencia técnica</h2>
        {!result ? (
          <p className="lede">Completa los datos para probar el flujo. Todavía no constituye una precotización aprobada.</p>
        ) : (
          <>
            <p><strong>{result.folio}</strong></p>
            <div className="result-grid">
              <div className="result-item"><span>Capacidad</span><strong>{numberRange(result.estimate.capacityKwp, "kWp")}</strong></div>
              <div className="result-item"><span>Inversión</span><strong>{mxnRange(result.estimate.investmentMxn)}</strong></div>
              <div className="result-item"><span>Techo</span><strong>{numberRange(result.estimate.roofAreaM2, "m²")}</strong></div>
              <div className="result-item"><span>Modelo</span><strong>{result.estimate.modelStatus}</strong></div>
            </div>
            <p className="fine">{result.estimate.disclaimer}</p>
            <p className="fine">Evidencia: {result.evidence_class}. Correlation ID: {result.correlation_id}</p>
          </>
        )}
      </aside>
    </div>
  );
}
