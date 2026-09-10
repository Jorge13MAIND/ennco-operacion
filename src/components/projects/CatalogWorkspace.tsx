"use client";

import { useState } from "react";
import type { EngineeringSource } from "@/lib/projects/engineering-sources";
import {
  AREA_LABELS,
  PROJECT_AREAS,
  type CatalogEntry,
  type JsonRecord,
  type ProjectAccess,
  type ProjectArea,
  type ProjectReadiness,
} from "@/lib/projects/types";
import {
  Badge,
  Check,
  DetailList,
  Empty,
  Field,
  Form,
  LoadError,
  LoadingState,
  Notice,
  PageHeader,
  Panel,
  Readiness,
  dateLabel,
  isChecked,
  num,
  str,
  textValue,
  useProjectMutation,
  useResource,
} from "./ui";
import {
  CatalogExtraData,
  HistoricalCatalogs,
  RefreshSources,
} from "./ProjectSources";

type CatalogResponse = {
  entries: CatalogEntry[];
  access: ProjectAccess;
  readiness: ProjectReadiness;
  historical?: Parameters<typeof HistoricalCatalogs>[0]["entries"];
  historicalMeta?: { sourceDateNote?: string };
  sourceLibrary?: EngineeringSource[];
};
type CatalogField = {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  min?: number;
  max?: number;
};
const categories: Record<string, { label: string; fields: CatalogField[] }> = {
  MODULE: {
    label: "Módulos fotovoltaicos",
    fields: [
      { key: "model", label: "Modelo", required: true },
      {
        key: "powerW",
        label: "Potencia (W)",
        type: "number",
        required: true,
        min: 1,
      },
      { key: "vocV", label: "Voc (V)", type: "number" },
      { key: "vmpV", label: "Vmp (V)", type: "number" },
      { key: "iscA", label: "Isc (A)", type: "number" },
      { key: "impA", label: "Imp (A)", type: "number" },
      {
        key: "vocTemperaturePctPerC",
        label: "Coeficiente Voc (%/°C)",
        type: "number",
        max: 0,
      },
      {
        key: "vmpTemperaturePctPerC",
        label: "Coeficiente Vmp (%/°C)",
        type: "number",
        max: 0,
      },
    ],
  },
  INVERTER: {
    label: "Inversores",
    fields: [
      { key: "model", label: "Modelo", required: true },
      ...[
        ["acPowerKw", "Potencia AC (kW)"],
        ["maxDcPowerKw", "Potencia DC máxima (kW)"],
        ["maxDcVoltageV", "Tensión DC máxima (V)"],
        ["mpptMinV", "MPPT mínimo (V)"],
        ["mpptMaxV", "MPPT máximo (V)"],
        ["mpptCount", "Número de MPPT"],
        ["maxInputCurrentPerMpptA", "Corriente máxima por MPPT (A)"],
        ["maxShortCircuitCurrentPerMpptA", "Isc máxima por MPPT (A)"],
      ].map(([key, label]) => ({
        key: key!,
        label: label!,
        type: "number",
        min: 0.001,
        required: true,
      })),
    ],
  },
  TARIFF: {
    label: "Tarifas energéticas",
    fields: [
      { key: "name", label: "Nombre de tarifa", required: true },
      {
        key: "energyRateMxnKwh",
        label: "Componente energético MXN/kWh",
        type: "number",
        min: 0,
        required: true,
      },
      {
        key: "fixedMonthlyMxn",
        label: "Cargo fijo mensual MXN",
        type: "number",
        min: 0,
        required: true,
      },
      {
        key: "demandMonthlyMxn",
        label: "Cargo mensual por demanda MXN",
        type: "number",
        min: 0,
        required: true,
      },
      {
        key: "validFrom",
        label: "Vigente desde",
        type: "month",
        required: true,
      },
      { key: "validTo", label: "Vigente hasta", type: "month", required: true },
    ],
  },
  AMPACITY: {
    label: "Reglas de ampacidad",
    fields: [
      ["baseA", "Ampacidad base (A)"],
      ["temperatureFactor", "Factor por temperatura"],
      ["groupingFactor", "Factor por agrupamiento"],
      ["terminalLimitA", "Límite de terminal (A)"],
      ["requiredCurrentMultiplier", "Multiplicador de corriente"],
    ].map(([key, label]) => ({
      key: key!,
      label: label!,
      type: "number",
      required: true,
      min: 0.001,
    })),
  },
  PROTECTION: {
    label: "Protecciones y tierra",
    fields: [
      ["minimumBreakerMultiplier", "Multiplicador mínimo de protección"],
      ["maximumBreakerA", "Protección máxima (A)"],
      ["minimumGroundMm2", "Tierra mínima (mm²)"],
    ].map(([key, label]) => ({
      key: key!,
      label: label!,
      type: "number",
      required: true,
      min: 0.001,
    })),
  },
  CONDUIT: {
    label: "Reglas de tubería",
    fields: [
      ["internalAreaMm2", "Área interna (mm²)"],
      ["occupiedAreaMm2", "Área ocupada por cables (mm²)"],
      ["allowedFillFraction", "Fracción de llenado permitida"],
    ].map(([key, label]) => ({
      key: key!,
      label: label!,
      type: "number",
      required: true,
      min: 0.001,
    })),
  },
  PRICE: {
    label: "Materiales y precios",
    fields: [
      { key: "sku", label: "Clave / SKU" },
      { key: "description", label: "Descripción", required: true },
      { key: "unit", label: "Unidad", required: true },
      {
        key: "unitCostMxn",
        label: "Costo unitario MXN",
        type: "number",
        min: 0,
        required: true,
      },
      { key: "supplier", label: "Proveedor" },
      {
        key: "validUntil",
        label: "Vigencia de precio",
        type: "date",
        required: true,
      },
    ],
  },
};

const categoryLabel = (key: string) =>
  categories[key]?.label ??
  (
    {
      SOLAR_RESOURCE: "Recurso solar",
      EXCHANGE_RATE: "Tipos de cambio",
    } as Record<string, string>
  )[key] ??
  key;

export function CatalogWorkspace() {
  const resource = useResource<CatalogResponse>("/api/v1/projects/catalogs");
  const mutation = useProjectMutation(resource.reload);
  const [category, setCategory] = useState("MODULE");
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [edit, setEdit] = useState<CatalogEntry | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [review, setReview] = useState<CatalogEntry | null>(null);
  const selectedCategory = categories[category] ?? categories.MODULE!;
  const entries = resource.data?.entries ?? [];
  const filtered = entries.filter(
    (entry) =>
      (!filter || entry.category === filter) &&
      `${entry.name} ${entry.category}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  async function save(form: FormData) {
    const data: JsonRecord = {};
    for (const field of selectedCategory.fields) {
      const value = textValue(form, `data-${field.key}`);
      if (value !== "")
        data[field.key] = field.type === "number" ? Number(value) : value;
    }
    const result = await mutation.run("/api/v1/projects/catalogs", {
      category,
      name: textValue(form, "name"),
      version: Number(textValue(form, "version")),
      data,
      sourceUrl: textValue(form, "sourceUrl"),
      sourceDate: textValue(form, "sourceDate"),
      status: textValue(form, "status"),
    });
    if (result) {
      setEdit(null);
      setShowForm(false);
    }
    return result;
  }
  return (
    <main
      className="shell section operations-main projects-page"
      id="main-content"
      tabIndex={-1}
    >
      <PageHeader
        title="Catálogos y fuentes"
        description="Equipos, precios y reglas con una fuente y una versión. Las actualizaciones se revisan antes de usarlas en nuevos proyectos."
      >
        <button
          className="projects-button"
          disabled={!resource.data?.access.canManageCatalogs}
          type="button"
          onClick={() => {
            setEdit(null);
            setShowForm((shown) => !shown);
          }}
        >
          {showForm ? "Cerrar formulario" : "+ Agregar al catálogo"}
        </button>
      </PageHeader>
      {resource.loading ? <LoadingState title="Cargando catálogos" /> : null}
      {resource.error ? (
        <LoadError
          message={resource.error}
          retry={() => void resource.reload()}
        />
      ) : null}
      {resource.data ? (
        <>
          <Readiness readiness={resource.data.readiness} />
          <Notice>
            <strong>Una actualización crea otra versión</strong>
            <p>
              Las propuestas y cálculos conservan la fuente que utilizaron. Los
              registros en borrador deben revisarse antes de considerarse una
              referencia aprobada.
            </p>
          </Notice>
          {review && resource.data.access.canApprove ? (
            <Panel
              title={`Revisar fuente: ${review.name}`}
              description="La aprobación crea una versión nueva; el candidato original conserva su estado."
            >
              <CatalogExtraData data={review.data} category={review.category} />
              <Form
                mutation={mutation}
                submit="Crear versión aprobada"
                onSubmit={async (form) => {
                  const result = await mutation.run(
                    "/api/v1/projects/catalogs",
                    {
                      category: review.category,
                      name: review.name,
                      version: Number(textValue(form, "reviewVersion")),
                      data: review.data,
                      sourceUrl: review.sourceUrl,
                      sourceDate: review.sourceDate,
                      status: "APPROVED",
                    },
                  );
                  if (result) setReview(null);
                  return result;
                }}
              >
                <Field
                  name="reviewVersion"
                  label="Nueva versión"
                  type="number"
                  min={review.version + 1}
                  step={1}
                  required
                  defaultValue={
                    Math.max(
                      ...entries
                        .filter(
                          (entry) =>
                            entry.name === review.name &&
                            entry.category === review.category,
                        )
                        .map((entry) => entry.version),
                    ) + 1
                  }
                />
                <Check name="reviewed" required>
                  Verifiqué los valores, la fuente, sus unidades y su vigencia
                  para el uso indicado.
                </Check>
              </Form>
            </Panel>
          ) : null}
          {showForm && resource.data.access.canManageCatalogs ? (
            <Panel
              title={
                edit
                  ? `Nueva versión de ${edit.name}`
                  : "Nueva entrada de catálogo"
              }
              description="Registra datos de la ficha o fuente oficial. No se reemplazan revisiones anteriores."
            >
              <Form
                mutation={mutation}
                onSubmit={save}
                submit="Guardar versión"
                disabled={resource.data.readiness.storage === "UNAVAILABLE"}
              >
                <div className="projects-form-grid" key={edit?.id ?? "new"}>
                  <label className="projects-field">
                    <span>Categoría *</span>
                    <select
                      value={category}
                      onChange={(event) => {
                        setCategory(event.target.value);
                        setEdit(null);
                      }}
                      required
                    >
                      {Object.entries(categories)
                        .filter(
                          ([key]) =>
                            key !== "PRICE" ||
                            resource.data?.access.canReadCosts,
                        )
                        .map(([key, value]) => (
                          <option value={key} key={key}>
                            {value.label}
                          </option>
                        ))}
                    </select>
                  </label>
                  <Field
                    name="name"
                    label="Nombre identificable"
                    required
                    defaultValue={edit?.name}
                  />
                  <Field
                    name="version"
                    label="Versión"
                    type="number"
                    min={1}
                    step={1}
                    required
                    defaultValue={edit ? edit.version + 1 : 1}
                  />
                  <Field
                    name="status"
                    label="Estado de revisión"
                    required
                    defaultValue="DRAFT"
                    options={[
                      { value: "DRAFT", label: "Borrador por revisar" },
                      ...(resource.data.access.canApprove
                        ? [
                            {
                              value: "APPROVED",
                              label: "Aprobado por Dirección",
                            },
                            { value: "RETIRED", label: "Retirado" },
                          ]
                        : []),
                    ]}
                  />
                  <Field
                    name="sourceUrl"
                    label="Fuente / ficha técnica"
                    type="url"
                    required
                    defaultValue={edit?.sourceUrl}
                  />
                  <Field
                    name="sourceDate"
                    label="Fecha de la fuente"
                    type="date"
                    required
                    defaultValue={edit?.sourceDate}
                  />
                </div>
                <fieldset
                  style={{ marginTop: 24 }}
                  key={`${category}-${edit?.id ?? "new"}`}
                >
                  <legend>{selectedCategory.label}</legend>
                  <div className="projects-form-grid">
                    {selectedCategory.fields.map((field) => (
                      <Field
                        name={`data-${field.key}`}
                        key={field.key}
                        label={field.label}
                        type={field.type}
                        required={field.required}
                        min={field.min}
                        max={field.max}
                        defaultValue={
                          edit && typeof edit.data[field.key] === "number"
                            ? num(edit.data, field.key)
                            : edit
                              ? str(edit.data, field.key)
                              : undefined
                        }
                      />
                    ))}
                  </div>
                </fieldset>
              </Form>
            </Panel>
          ) : null}
          <Panel title="Referencias disponibles">
            <div className="projects-toolbar">
              <label className="projects-field">
                <span>Buscar</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Equipo, tarifa o regla"
                />
              </label>
              <label className="projects-field">
                <span>Filtrar categoría</span>
                <select
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                >
                  <option value="">Todas las categorías</option>
                  {[...new Set(entries.map((entry) => entry.category))].map(
                    (key) => (
                      <option key={key} value={key}>
                        {categoryLabel(key)}
                      </option>
                    ),
                  )}
                </select>
              </label>
            </div>
            <p className="projects-help" role="status">
              {filtered.length} referencias
            </p>
            {!filtered.length ? (
              <Empty
                title="Sin referencias para mostrar"
                description="Agrega las fichas, tarifas y precios que el equipo haya revisado. Cada registro conserva su procedencia."
              />
            ) : (
              <div
                className="projects-table-wrap"
                tabIndex={0}
                role="region"
                aria-label="Catálogos versionados"
              >
                <table className="projects-table">
                  <thead>
                    <tr>
                      <th>Referencia</th>
                      <th>Versión / fecha</th>
                      <th>Estado</th>
                      <th>Fuente y datos</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          <strong>{entry.name}</strong>
                          <small>{categoryLabel(entry.category)}</small>
                        </td>
                        <td>
                          v{entry.version}
                          <small>{dateLabel(entry.sourceDate)}</small>
                        </td>
                        <td>
                          <Badge
                            tone={
                              entry.status === "APPROVED"
                                ? "success"
                                : entry.status === "DRAFT"
                                  ? "warning"
                                  : "neutral"
                            }
                          >
                            {entry.status === "APPROVED"
                              ? "Aprobado"
                              : entry.status === "DRAFT"
                                ? "Por revisar"
                                : "Retirado"}
                          </Badge>
                        </td>
                        <td>
                          <a
                            href={
                              /^https?:\/\//.test(entry.sourceUrl)
                                ? entry.sourceUrl
                                : undefined
                            }
                            target="_blank"
                            rel="noreferrer"
                          >
                            Consultar fuente ↗
                          </a>
                          <details style={{ marginTop: 10 }}>
                            <summary>Ver datos de la versión</summary>
                            <DetailList
                              values={(categories[entry.category]?.fields ?? [])
                                .filter(
                                  (field) =>
                                    entry.data[field.key] !== undefined &&
                                    (resource.data?.access.canReadCosts ||
                                      !field.key
                                        .toLowerCase()
                                        .includes("cost")),
                                )
                                .map((field) => [
                                  field.label,
                                  String(entry.data[field.key]),
                                ])}
                            />
                            <CatalogExtraData
                              data={entry.data}
                              category={entry.category}
                            />
                          </details>
                        </td>
                        <td>
                          {resource.data?.access.canManageCatalogs &&
                          categories[entry.category] ? (
                            <button
                              className="projects-button"
                              data-variant="secondary"
                              type="button"
                              onClick={() => {
                                setEdit(entry);
                                setCategory(entry.category);
                                setShowForm(true);
                                window.scrollTo({ top: 0, behavior: "smooth" });
                              }}
                            >
                              Nueva versión
                            </button>
                          ) : resource.data?.access.canApprove &&
                            ["SOLAR_RESOURCE", "EXCHANGE_RATE"].includes(
                              entry.category,
                            ) ? (
                            <button
                              className="projects-button"
                              data-variant="secondary"
                              type="button"
                              onClick={() => {
                                setReview(entry);
                                window.scrollTo({ top: 0, behavior: "smooth" });
                              }}
                            >
                              Revisar y aprobar
                            </button>
                          ) : (
                            "Consulta"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          {resource.data.access.canManageCatalogs ? (
            <RefreshSources reload={resource.reload} />
          ) : null}
          <HistoricalCatalogs
            entries={resource.data.historical ?? []}
            sourceDateNote={resource.data.historicalMeta?.sourceDateNote}
            sourceLibrary={resource.data.sourceLibrary ?? []}
          />
          {resource.data.access.canManageMembers ? <ProjectMembers /> : null}
        </>
      ) : null}
    </main>
  );
}

type Member = {
  userId: string;
  email: string;
  displayName: string;
  role: string;
  areas: ProjectArea[];
};
function ProjectMembers() {
  const resource = useResource<{ members: Member[]; access: ProjectAccess }>(
    "/api/v1/projects/members",
  );
  const mutation = useProjectMutation(resource.reload);
  const [selected, setSelected] = useState("");
  const member = resource.data?.members.find(
    (item) => item.userId === selected,
  );
  return (
    <Panel
      title="Responsabilidades del equipo"
      description="Asigna funciones a usuarios existentes. Los permisos del proyecto se aplican también a sus costos y documentos."
    >
      {resource.loading ? <LoadingState title="Consultando equipo" /> : null}
      {resource.error ? (
        <LoadError
          message={resource.error}
          retry={() => void resource.reload()}
        />
      ) : null}
      {resource.data ? (
        <>
          <div className="projects-table-wrap">
            <table className="projects-table">
              <thead>
                <tr>
                  <th>Persona</th>
                  <th>Funciones</th>
                </tr>
              </thead>
              <tbody>
                {resource.data.members.map((item) => (
                  <tr key={item.userId}>
                    <td>
                      {item.displayName || item.email}
                      <small>{item.email}</small>
                    </td>
                    <td>
                      {item.areas.length
                        ? item.areas.map((area) => AREA_LABELS[area]).join(", ")
                        : "Sin funciones asignadas"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 24 }}>
            <Form
              mutation={mutation}
              submit="Guardar funciones"
              onSubmit={(form) =>
                mutation.run("/api/v1/projects/members", {
                  userId: selected,
                  areas: PROJECT_AREAS.filter((area) =>
                    isChecked(form, `area-${area}`),
                  ),
                })
              }
            >
              <label className="projects-field">
                <span>Persona *</span>
                <select
                  value={selected}
                  onChange={(event) => setSelected(event.target.value)}
                  required
                >
                  <option value="">Seleccionar…</option>
                  {resource.data.members.map((item) => (
                    <option key={item.userId} value={item.userId}>
                      {item.displayName || item.email}
                    </option>
                  ))}
                </select>
              </label>
              <div
                className="projects-form-grid"
                key={selected}
                style={{ marginTop: 18 }}
              >
                {PROJECT_AREAS.map((area) => (
                  <Check
                    key={area}
                    name={`area-${area}`}
                    checked={member?.areas.includes(area)}
                  >
                    {AREA_LABELS[area]}
                  </Check>
                ))}
              </div>
            </Form>
          </div>
        </>
      ) : null}
    </Panel>
  );
}
