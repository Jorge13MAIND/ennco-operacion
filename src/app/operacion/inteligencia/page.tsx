import type { Route } from "next";
import Link from "next/link";

import { MetricValue } from "@/components/MetricValue";
import { RecalcularAction } from "@/components/InteligenciaActions";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { CLASSIFICATION_LABELS, INTENT_LABELS, type ReplyIntent, type SuggestedClassification } from "@/lib/inteligencia/clasificador";
import { ICP_BAND_LABELS, type IcpBand } from "@/lib/inteligencia/icp";
import { loadIntelligenceScreen } from "@/lib/inteligencia/overview";
import { operationalLabel } from "@/lib/operations/presentation";

export const dynamic = "force-dynamic";

const stamp = new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: "America/Mexico_City" });

const severityClass: Record<string, string> = { CRITICAL: "blocked", WARNING: "warning", INFO: "ready" };

export default async function InteligenciaPage() {
  const access = await requireOperationsAccess();
  const screen = await loadIntelligenceScreen(access);
  const { icp, suggestions, brief } = screen;
  const isLive = screen.evidenceClass === "live";

  return (
    <main className="shell section operations-main" id="main-content" tabIndex={-1}>
      <header className="operations-page-heading">
        <div>
          <p className="eyebrow">Control Room · Inteligencia</p>
          <h1>Qué atender <span className="cr-accent-text">primero</span>.</h1>
          <p>
            Prioriza cuentas contra el ICP contractual y propone la lectura de cada respuesta.
            Nada de esto decide por ti: la clasificación sigue siendo manual. Actualizado {stamp.format(new Date(screen.generatedAt))}.
          </p>
        </div>
        {isLive ? null : <span className="badge">{operationalLabel(screen.evidenceClass)}</span>}
      </header>

      {/* Brief: patrón de los agentes 11 y 12 de Atlas. Ordena por consecuencia. */}
      <section aria-label="Brief de operación" className={`command-status ${brief.severity === "INFO" ? "ready" : "blocked"}`}>
        <div className="command-status-primary">
          <span>{brief.moment === "PREFLIGHT" ? "Brief de apertura" : "Cierre del día"}</span>
          <strong>{brief.headline}</strong>
          <p>{brief.items.length} punto{brief.items.length === 1 ? "" : "s"} en revisión.</p>
        </div>
        <div className="command-status-facts">
          <div><span>Respuestas por leer</span><strong>{suggestions.needs_human_now}</strong></div>
          <div><span>Cuentas puntuadas</span><strong>{icp.totals.scored}</strong></div>
          <div><span>Prioridad alta</span><strong>{icp.totals.band_a}</strong></div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Pendientes por consecuencia</h2>
            <p>Lo que puede congelar el canal va primero. Un P1 abierto bloquea todo envío externo.</p>
          </div>
        </div>
        {brief.items.length === 0 ? (
          <p className="notice">Sin pendientes.</p>
        ) : (
          <ul className="brief-list">
            {brief.items.map((item, index) => (
              <li className="brief-item" key={`${item.title}-${index}`}>
                <span className={`status ${severityClass[item.severity] ?? "ready"}`}>{item.severity}</span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                  {item.action ? <p className="brief-action">→ {item.action}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ICP: patrón del agente 05. Determinista y auditable factor por factor. */}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Cola de prioridad ICP</h2>
            <p>
              Rúbrica {screen.rubricVersion}. El estado es compuerta: fuera de los cuatro estados del contrato
              la cuenta no puede ser lead calificado por mucho que cumpla lo demás.
            </p>
          </div>
          {screen.canOperate && isLive ? <RecalcularAction kind="icp" /> : null}
        </div>

        <section className="metric-grid operations-metrics">
          <div className="metric"><span>Prioridad alta (A)</span><strong><MetricValue value={icp.totals.band_a} /></strong></div>
          <div className="metric"><span>Media (B)</span><strong><MetricValue value={icp.totals.band_b} /></strong></div>
          <div className="metric"><span>Baja (C)</span><strong><MetricValue value={icp.totals.band_c} /></strong></div>
          <div className="metric"><span>Descartable (D)</span><strong><MetricValue value={icp.totals.band_d} /></strong></div>
          <div className="metric"><span>Fuera de contrato</span><strong><MetricValue value={icp.totals.out_of_contract} /></strong></div>
        </section>

        {icp.totals.contract_only_state > 0 ? (
          <p className="notice">
            {icp.totals.contract_only_state} cuenta{icp.totals.contract_only_state === 1 ? "" : "s"} en Jalisco o Michoacán:
            el contrato las incluye pero el módulo de investigación todavía no las acepta. Mercado contractual sin explotar.
          </p>
        ) : null}

        {icp.accounts.length === 0 ? (
          <p className="notice">Sin cuentas puntuadas. Carga las empresas y ejecuta el recálculo.</p>
        ) : (
          <div aria-label="Tabla: Cola de prioridad ICP" className="table-wrap" role="region" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>Empresa</th><th>Ubicación</th><th>Puntuación</th><th>Banda</th><th>Factores</th><th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {icp.accounts.map((account) => (
                  <tr key={account.account_id}>
                    <td data-label="Empresa">
                      {account.legal_name}
                      {account.industrial_park ? <><br /><span className="muted">{account.industrial_park}</span></> : null}
                    </td>
                    <td data-label="Ubicación">
                      {[account.city, account.state].filter(Boolean).join(", ") || "Sin ubicación"}
                      {account.contract_only_state ? <><br /><span className="status warning">Sólo contrato</span></> : null}
                    </td>
                    <td data-label="Puntuación"><strong>{account.score}</strong> / 100</td>
                    <td data-label="Banda">
                      <span className={`status ${account.band === "A" ? "ready" : account.band === "FUERA_DE_CONTRATO" ? "blocked" : "warning"}`}>
                        {ICP_BAND_LABELS[account.band as IcpBand]}
                      </span>
                    </td>
                    <td data-label="Factores">
                      <ul className="factor-list">
                        {account.factors.map((factor) => (
                          <li key={factor.key}>
                            <span className={factor.points > 0 ? "factor-hit" : "factor-miss"}>{factor.points}/{factor.max}</span> {factor.label}
                            <br /><span className="muted">{factor.evidence}</span>
                          </li>
                        ))}
                      </ul>
                      {account.missing.length > 0 ? <p className="muted">Sin evidencia: {account.missing.join(", ")}</p> : null}
                    </td>
                    <td data-label="Estado">
                      {account.suppressed ? <span className="status blocked">Suprimida</span>
                        : account.enrolled ? <span className="status ready">Inscrita</span>
                        : <span className="status warning">Sin inscribir</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Clasificación asistida: patrón del agente 03, pero sin decidir nunca. */}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Lectura sugerida de respuestas</h2>
            <p>
              {screen.classifierVersion}. La máquina propone y muestra la frase que la llevó ahí;
              clasificar sigue siendo tuyo, en <Link href={"/operacion/respuestas" as Route}>Respuestas</Link>.
            </p>
          </div>
          {screen.canOperate && isLive ? <RecalcularAction kind="sugerencias" /> : null}
        </div>

        {suggestions.suggestions.length === 0 ? (
          <p className="notice">Sin respuestas pendientes de clasificar.</p>
        ) : (
          <div aria-label="Tabla: Lectura sugerida" className="table-wrap" role="region" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>Recibida</th><th>De</th><th>Asunto</th><th>Lectura sugerida</th><th>Confianza</th><th>Por qué</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.suggestions.map((row) => (
                  <tr key={row.provider_event_id}>
                    <td data-label="Recibida">{row.observed_at ? stamp.format(new Date(row.observed_at)) : "Sin fecha"}</td>
                    <td data-label="De">{row.from_email ?? "Sin remitente"}</td>
                    <td data-label="Asunto">{row.subject ?? "Sin asunto"}</td>
                    <td data-label="Lectura sugerida">
                      <span className={`status ${row.classification === "POSITIVE" ? "ready" : row.classification === "NEGATIVE" ? "blocked" : "warning"}`}>
                        {CLASSIFICATION_LABELS[row.classification as SuggestedClassification]}
                      </span>
                      <br />
                      <span className="muted">{INTENT_LABELS[row.intent as ReplyIntent] ?? row.intent}</span>
                      {row.needs_human_now ? <><br /><span className="status warning">Trato humano</span></> : null}
                    </td>
                    <td data-label="Confianza">
                      {Math.round(row.confidence * 100)}%
                      {row.confidence < 0.5 ? <><br /><span className="muted">lee completo</span></> : null}
                    </td>
                    <td data-label="Por qué">
                      <ul className="factor-list">
                        {row.signals.map((signal, index) => <li key={index}><span className="muted">{signal}</span></li>)}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="notice">
          Una sugerencia no clasifica nada. Marcar Positiva crea un lead, asigna tarea y abre un caso SLA P1
          cuyo vencimiento congela el outbound, así que esa decisión es siempre de una persona.
        </p>
      </section>
    </main>
  );
}
