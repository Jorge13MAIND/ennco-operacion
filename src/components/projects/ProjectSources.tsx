"use client";

import { useState } from "react";
import type { EngineeringSource } from "@/lib/projects/engineering-sources";
import type {
  ExchangeRateDraft,
  SolarResourceDraft,
} from "@/lib/projects/source-refresh";
import type { JsonRecord } from "@/lib/projects/types";
import {
  Badge,
  DetailList,
  Field,
  Form,
  Notice,
  Panel,
  dateLabel,
  list,
  num,
  numberValue,
  obj,
  quantity,
  str,
  textValue,
  useProjectMutation,
} from "./ui";

type HistoricalEntry = {
  id: string;
  category: string;
  name: string;
  data: JsonRecord;
  sourceSheet: string;
  sourceRow: number;
  status: string;
};
export function HistoricalCatalogs({
  entries,
  sourceDateNote,
  sourceLibrary,
}: {
  entries: HistoricalEntry[];
  sourceDateNote?: string;
  sourceLibrary: EngineeringSource[];
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const labels: Record<string, string> = {
    module: "Módulos",
    inverter: "Inversores",
    solar_resource: "Recurso solar",
    conductor_rule: "Conductores",
    mounting_rule: "Estructuras",
  };
  const filtered = entries.filter(
    (entry) =>
      (!category || entry.category === category) &&
      `${entry.name} ${entry.sourceSheet}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      {entries.length ? (
        <Panel
          title="Referencias recuperadas de MEST"
          description="Datos históricos con su ubicación de origen. Revisa ficha, unidades y vigencia antes de crear una versión aprobada."
        >
          <Notice tone="warning">
            {sourceDateNote ||
              "La fecha de recuperación del archivo no acredita la vigencia de sus equipos, reglas o datos."}
          </Notice>
          <div className="projects-toolbar">
            <label className="projects-field">
              <span>Buscar en MEST</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Modelo, referencia u hoja"
              />
            </label>
            <label className="projects-field">
              <span>Tipo de referencia</span>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="">Todos</option>
                {[...new Set(entries.map((entry) => entry.category))].map(
                  (key) => (
                    <option key={key} value={key}>
                      {labels[key] ?? key}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
          <p className="projects-help" role="status">
            {filtered.length} referencias históricas
          </p>
          <div
            className="projects-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Datos recuperados de MEST"
          >
            <table className="projects-table">
              <thead>
                <tr>
                  <th>Referencia</th>
                  <th>Origen</th>
                  <th>Datos recuperados</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 80).map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <strong>{entry.name}</strong>
                      <small>{labels[entry.category] ?? entry.category}</small>
                      <Badge tone="warning">Por revisar</Badge>
                    </td>
                    <td>
                      {entry.sourceSheet}
                      <small>Fila {entry.sourceRow}</small>
                    </td>
                    <td>
                      <details>
                        <summary>
                          Consultar valores y unidades de origen
                        </summary>
                        <dl className="projects-detail-grid">
                          {Object.entries(obj(entry.data.rawFields)).map(
                            ([key, value]) => {
                              const source = obj(
                                obj(entry.data.fieldProvenance)[key],
                              );
                              return (
                                <div key={key}>
                                  <dt>
                                    {str(source, "label", key)} ·{" "}
                                    {str(source, "cell", key)}
                                  </dt>
                                  <dd>{String(value)}</dd>
                                </div>
                              );
                            },
                          )}
                        </dl>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > 80 ? (
            <p className="projects-help">
              Se muestran las primeras 80 coincidencias. Usa el buscador para
              encontrar una referencia específica.
            </p>
          ) : null}
        </Panel>
      ) : null}
      {sourceLibrary.length ? (
        <Panel
          title="Biblioteca de métodos y fuentes"
          description="La referencia documenta el método; la validación de un proyecto depende de su información y revisión técnica."
        >
          <div className="projects-card-grid">
            {sourceLibrary.map((source) => (
              <article className="projects-card" key={source.id}>
                <span className="projects-eyebrow">{source.publisher}</span>
                <h3>{source.title}</h3>
                <p>{source.scope}</p>
                <div className="projects-card-foot">
                  <span>{dateLabel(source.consultedOn)}</span>
                  {source.url ? (
                    <a href={source.url} target="_blank" rel="noreferrer">
                      Fuente ↗
                    </a>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </Panel>
      ) : null}
    </>
  );
}

export function RefreshSources({ reload }: { reload: () => Promise<unknown> }) {
  const [provider, setProvider] = useState<"PVGIS" | "BANXICO">("PVGIS");
  const [candidate, setCandidate] = useState<
    SolarResourceDraft | ExchangeRateDraft | null
  >(null);
  const lookup = useProjectMutation(async () => undefined);
  const save = useProjectMutation(reload);
  return (
    <Panel
      title="Consultar fuentes actualizadas"
      description="Recupera recurso solar o tipo de cambio. La respuesta se conserva como candidato por revisar y no cambia una propuesta existente."
    >
      <Form
        mutation={lookup}
        submit="Consultar fuente"
        onSubmit={async (form) => {
          const result = await lookup.run<{
            candidate: SolarResourceDraft | ExchangeRateDraft;
          }>(
            "/api/v1/projects/catalogs/refresh",
            provider === "PVGIS"
              ? {
                  provider,
                  lat: numberValue(form, "lat"),
                  lon: numberValue(form, "lon"),
                  tilt: numberValue(form, "tilt"),
                  azimuth: numberValue(form, "azimuth"),
                  year: numberValue(form, "year"),
                }
              : { provider },
          );
          if (result?.candidate) setCandidate(result.candidate);
          return result;
        }}
      >
        <div className="projects-form-grid">
          <label className="projects-field">
            <span>Fuente *</span>
            <select
              value={provider}
              onChange={(event) => {
                setProvider(event.target.value as "PVGIS" | "BANXICO");
                setCandidate(null);
              }}
            >
              <option value="PVGIS">PVGIS · recurso solar</option>
              <option value="BANXICO">Banco de México · tipo de cambio</option>
            </select>
          </label>
          {provider === "PVGIS" ? (
            <>
              <Field
                label="Latitud"
                name="lat"
                type="number"
                min={-89.9}
                max={89.9}
                required
              />
              <Field
                label="Longitud"
                name="lon"
                type="number"
                min={-180}
                max={180}
                required
              />
              <Field
                label="Inclinación del plano (°)"
                name="tilt"
                type="number"
                min={0}
                max={90}
                required
              />
              <Field
                label="Azimut del plano (°)"
                name="azimuth"
                type="number"
                min={-180}
                max={180}
                required
                help="Convención PVGIS: sur 0°, este −90°, oeste +90°."
              />
              <Field
                label="Año del escenario"
                name="year"
                type="number"
                min={2000}
                max={2099}
                step={1}
                required
                help="Se aplica el calendario del escenario a una climatología; no es un pronóstico del año."
              />
            </>
          ) : (
            <p className="projects-help">
              Consulta una observación publicada. Verifica fecha, sentido MXN
              por USD y aplicabilidad comercial.
            </p>
          )}
        </div>
      </Form>
      {candidate ? (
        <div style={{ marginTop: 26 }}>
          <Notice tone="warning">
            <strong>Candidato pendiente de revisión</strong>
            <ul>
              {candidate.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </Notice>
          {candidate.provider === "PVGIS" ? (
            <>
              <DetailList
                values={[
                  ["Fuente", candidate.dataset.name],
                  [
                    "Periodo climático",
                    `${candidate.dataset.startYear}–${candidate.dataset.endYear}`,
                  ],
                  ["Año de escenario", candidate.dataset.scenarioYear],
                ]}
              />
              <div className="projects-table-wrap" style={{ marginBlock: 18 }}>
                <table className="projects-table">
                  <thead>
                    <tr>
                      <th>Mes</th>
                      <th>Recurso diario del plano (kWh/m²)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidate.monthlyResource.map((row) => (
                      <tr key={row.month}>
                        <td>{row.month}</td>
                        <td>{quantity(row.dailyPlaneOfArrayKwhM2, 4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <DetailList
              values={[
                [
                  "Tipo de cambio MXN por USD",
                  quantity(candidate.rateMxnPerUsd, 6),
                ],
                ["Fecha de observación", dateLabel(candidate.observationDate)],
                ["Serie publicada", candidate.seriesId],
              ]}
            />
          )}
          <Form
            mutation={save}
            submit="Guardar candidato en catálogo"
            onSubmit={(form) =>
              save.run("/api/v1/projects/catalogs", {
                category:
                  candidate.provider === "PVGIS"
                    ? "SOLAR_RESOURCE"
                    : "EXCHANGE_RATE",
                name: textValue(form, "candidateName"),
                version: numberValue(form, "candidateVersion"),
                status: "DRAFT",
                sourceUrl: candidate.sourceUrl,
                sourceDate: candidate.consultedAt.slice(0, 10),
                data:
                  candidate.provider === "PVGIS"
                    ? {
                        provider: candidate.provider,
                        dataset: candidate.dataset,
                        monthlyResource: candidate.monthlyResource,
                      }
                    : {
                        provider: candidate.provider,
                        rateMxnPerUsd: candidate.rateMxnPerUsd,
                        observationDate: candidate.observationDate,
                        seriesId: candidate.seriesId,
                        fromCurrency: "USD",
                        toCurrency: "MXN",
                      },
              })
            }
          >
            <div className="projects-form-grid" style={{ marginTop: 18 }}>
              <Field
                name="candidateName"
                label="Nombre para identificar la referencia"
                required
              />
              <Field
                name="candidateVersion"
                label="Versión del candidato"
                type="number"
                min={1}
                step={1}
                required
                defaultValue={1}
              />
            </div>
          </Form>
        </div>
      ) : null}
    </Panel>
  );
}

export function CatalogExtraData({
  data,
  category,
}: {
  data: JsonRecord;
  category: string;
}) {
  if (category === "EXCHANGE_RATE")
    return (
      <DetailList
        values={[
          ["Tipo de cambio MXN/USD", quantity(num(data, "rateMxnPerUsd"), 6)],
          ["Fecha de observación", dateLabel(str(data, "observationDate"))],
        ]}
      />
    );
  if (category === "SOLAR_RESOURCE")
    return (
      <DetailList
        values={[
          ["Conjunto de datos", str(obj(data.dataset), "name")],
          ["Meses del escenario", list(data.monthlyResource).length],
        ]}
      />
    );
  return null;
}
