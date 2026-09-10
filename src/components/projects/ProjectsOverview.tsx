"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  PROJECT_SEGMENTS,
  PROJECT_STAGES,
  SEGMENT_LABELS,
  STAGE_LABELS,
  type ProjectDetailResponse,
  type ProjectListResponse,
  type ProjectSegment,
} from "@/lib/projects/types";
import { CrmLinkFields, type ProjectLinks } from "./CrmLinkFields";
import {
  Badge,
  Empty,
  Field,
  Form,
  LoadError,
  LoadingState,
  Metric,
  Notice,
  PageHeader,
  Panel,
  Readiness,
  dateLabel,
  money,
  optionalText,
  str,
  textValue,
  useProjectMutation,
  useResource,
} from "./ui";

export function ProjectsOverview({ view }: { view: "master" | "list" }) {
  const resource = useResource<ProjectListResponse & { links?: ProjectLinks }>(
    "/api/v1/projects",
  );
  const router = useRouter();
  const mutation = useProjectMutation(resource.reload);
  const [showCreate, setShowCreate] = useState(false);
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState("");
  const [stage, setStage] = useState("");
  const projects = resource.data?.projects;
  const filtered = useMemo(
    () =>
      (projects ?? []).filter(
        (project) =>
          (!segment || project.segment === segment) &&
          (!stage || project.stage === stage) &&
          `${project.folio} ${project.name} ${project.customerName} ${project.location}`
            .toLocaleLowerCase("es-MX")
            .includes(query.toLocaleLowerCase("es-MX")),
      ),
    [projects, query, segment, stage],
  );
  const summaries = resource.data?.summaries ?? {};
  const active = (projects ?? []).filter(
    (project) => project.lifecycle === "ACTIVE" && project.stage !== "CLOSED",
  );
  const alerts = (projects ?? []).flatMap((project) =>
    (summaries[project.id]?.alerts ?? []).map((alert) => ({
      ...alert,
      project,
    })),
  );
  const total = (
    key: "contractedMxn" | "collectedMxn" | "balanceMxn" | "incurredMxn",
  ) =>
    Object.values(summaries).reduce(
      (sum, summary) => sum + (summary[key] ?? 0),
      0,
    );
  const showCosts = resource.data?.access.costScope === "ALL";
  const showMargins = resource.data?.access.canReadMargins;
  const costBases = Object.values(summaries).filter(
    (summary) => summary.projectedCostMxn !== undefined,
  );
  const profitBases = Object.values(summaries).filter(
    (summary) => summary.projectedProfitMxn !== undefined,
  );
  const deviationBases = costBases.filter(
    (summary) => summary.budgetMxn !== undefined,
  );
  const costCoverage = `${costBases.length} de ${projects?.length ?? 0} con base de costos`;
  const canCreate =
    resource.data?.access.canCreate &&
    resource.data.readiness.storage !== "UNAVAILABLE";

  async function create(form: FormData) {
    const result = await mutation.run<ProjectDetailResponse>(
      "/api/v1/projects",
      {
        name: textValue(form, "name"),
        segment: textValue(form, "segment") as ProjectSegment,
        customerName: textValue(form, "customerName"),
        contactName: optionalText(form, "contactName"),
        email: optionalText(form, "email"),
        phone: optionalText(form, "phone"),
        location: optionalText(form, "location"),
        scope: optionalText(form, "scope"),
        data: {
          accountId: optionalText(form, "accountId"),
          opportunityId: optionalText(form, "opportunityId"),
          ownerName: optionalText(form, "ownerName"),
          dueDate: optionalText(form, "dueDate"),
        },
      },
    );
    if (result?.project?.id)
      router.push(`/operacion/proyectos/${result.project.id}` as Route);
    return result;
  }
  return (
    <main
      className="shell section operations-main projects-page"
      id="main-content"
      tabIndex={-1}
    >
      <PageHeader
        title={view === "master" ? "Control Maestro" : "Tus proyectos"}
        description={
          view === "master"
            ? "Una vista de cada oportunidad y obra: qué sigue, cuánto se ha cobrado y dónde hace falta actuar."
            : "Del primer recibo a la entrega final. Encuentra un expediente o inicia un proyecto residencial, comercial o industrial."
        }
      >
        <button
          className="projects-button"
          type="button"
          onClick={() => setShowCreate((shown) => !shown)}
          disabled={!canCreate}
          aria-expanded={showCreate}
          aria-controls="new-project-form"
        >
          {showCreate ? "Cerrar formulario" : "+ Nuevo proyecto"}
        </button>
      </PageHeader>
      {resource.loading ? <LoadingState title="Cargando proyectos" /> : null}
      {resource.error ? (
        <LoadError
          message={resource.error}
          retry={() => void resource.reload()}
        />
      ) : null}
      {resource.data ? (
        <>
          <Readiness readiness={resource.data.readiness} />
          {showCreate ? (
            <section id="new-project-form">
              <Panel
                title="Nuevo proyecto"
                description="Se asignará un folio ENNCO al guardar. Puedes completar el expediente conforme recibas información."
              >
                <Form
                  onSubmit={create}
                  mutation={mutation}
                  submit="Crear expediente"
                  disabled={!canCreate}
                >
                  <div className="projects-form-grid">
                    <Field
                      label="Nombre del proyecto"
                      name="name"
                      required
                      placeholder="Instalación fotovoltaica · sitio o sucursal"
                    />
                    <Field
                      label="Tipo de proyecto"
                      name="segment"
                      required
                      options={PROJECT_SEGMENTS.map((value) => ({
                        value,
                        label: SEGMENT_LABELS[value],
                      }))}
                    />
                    <Field
                      label="Cliente o razón social"
                      name="customerName"
                      required
                    />
                    <Field label="Persona de contacto" name="contactName" />
                    <Field
                      label="Correo electrónico"
                      name="email"
                      type="email"
                    />
                    <Field label="Teléfono" name="phone" type="tel" />
                    <Field label="Ubicación del proyecto" name="location" />
                    <Field label="Responsable ENNCO" name="ownerName" />
                    <CrmLinkFields links={resource.data.links} />
                    <Field label="Fecha objetivo" name="dueDate" type="date" />
                    <Field
                      label="Necesidad y alcance inicial"
                      name="scope"
                      type="textarea"
                      wide
                    />
                  </div>
                </Form>
              </Panel>
            </section>
          ) : null}
          {view === "master" ? (
            <>
              <section
                className="projects-metrics"
                aria-label="Resumen de proyectos"
              >
                <Metric
                  label="Proyectos activos"
                  value={active.length}
                  help={`${projects?.length ?? 0} expedientes en total`}
                />
                <Metric
                  label="Valor contratado"
                  value={money(total("contractedMxn"))}
                  help="Contratos registrados en estos expedientes"
                />
                <Metric
                  label="Cobrado"
                  value={money(total("collectedMxn"))}
                  help="Pagos confirmados por Administración"
                />
                <Metric
                  label="Por cobrar"
                  value={money(total("balanceMxn"))}
                  help="Saldo de contratos registrados"
                />
              </section>
              {showCosts ? (
                <section
                  className="projects-metrics"
                  aria-label="Control financiero interno"
                >
                  <Metric
                    label="Costos incurridos"
                    value={money(total("incurredMxn"))}
                    help="Base de costo registrada por Administración"
                  />
                  <Metric
                    label="Costo proyectado"
                    value={
                      costBases.length
                        ? money(
                            costBases.reduce(
                              (sum, summary) => sum + summary.projectedCostMxn!,
                              0,
                            ),
                          )
                        : "Pendiente de presupuesto"
                    }
                    help={`${costCoverage}. Suma sólo los expedientes con base disponible.`}
                  />
                  <Metric
                    label="Desviación del presupuesto"
                    value={
                      deviationBases.length
                        ? money(
                            deviationBases.reduce(
                              (sum, summary) =>
                                sum +
                                summary.projectedCostMxn! -
                                summary.budgetMxn!,
                              0,
                            ),
                          )
                        : "Pendiente de presupuesto"
                    }
                    help={`${deviationBases.length} de ${projects?.length ?? 0} con presupuesto. Positivo indica sobrecosto.`}
                  />
                  {showMargins ? (
                    <Metric
                      label="Utilidad proyectada"
                      value={
                        profitBases.length
                          ? money(
                              profitBases.reduce(
                                (sum, summary) =>
                                  sum + summary.projectedProfitMxn!,
                                0,
                              ),
                            )
                          : "Pendiente de presupuesto"
                      }
                      help={`${profitBases.length} de ${projects?.length ?? 0} con base de costos. Venta neta de IVA menos costo proyectado.`}
                    />
                  ) : null}
                </section>
              ) : null}
              {alerts.length ? (
                <Panel
                  title="Lo que requiere atención"
                  description="Pendientes detectados en los expedientes. Abre el proyecto para resolverlos."
                >
                  <div
                    className="projects-table-wrap"
                    tabIndex={0}
                    role="region"
                    aria-label="Pendientes por proyecto"
                  >
                    <table className="projects-table">
                      <thead>
                        <tr>
                          <th>Proyecto</th>
                          <th>Pendiente</th>
                          <th>Atención</th>
                        </tr>
                      </thead>
                      <tbody>
                        {alerts.slice(0, 12).map((alert, index) => (
                          <tr
                            key={`${alert.project.id}-${alert.code}-${index}`}
                          >
                            <td>
                              <Link
                                href={
                                  `/operacion/proyectos/${alert.project.id}` as Route
                                }
                              >
                                {alert.project.folio}
                              </Link>
                              <small>{alert.project.name}</small>
                            </td>
                            <td>{alert.message}</td>
                            <td>
                              <Badge
                                tone={
                                  alert.level === "error"
                                    ? "danger"
                                    : alert.level === "warning"
                                      ? "warning"
                                      : "neutral"
                                }
                              >
                                {alert.level === "error"
                                  ? "Por resolver"
                                  : alert.level === "warning"
                                    ? "Revisar"
                                    : "Seguimiento"}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              ) : projects?.length ? (
                <Notice tone="success">
                  No hay alertas detectadas en los expedientes registrados.
                </Notice>
              ) : null}
            </>
          ) : null}
          <Panel
            title={
              view === "master"
                ? "Oportunidades y obras"
                : "Buscar un expediente"
            }
            description="Cada folio conserva su historial técnico, comercial y financiero."
          >
            <div className="projects-toolbar">
              <label className="projects-field">
                <span>Buscar</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Folio, cliente, proyecto o ubicación"
                />
              </label>
              <label className="projects-field">
                <span>Segmento</span>
                <select
                  value={segment}
                  onChange={(event) => setSegment(event.target.value)}
                >
                  <option value="">Todos los segmentos</option>
                  {PROJECT_SEGMENTS.map((value) => (
                    <option key={value} value={value}>
                      {SEGMENT_LABELS[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="projects-field">
                <span>Etapa</span>
                <select
                  value={stage}
                  onChange={(event) => setStage(event.target.value)}
                >
                  <option value="">Todas las etapas</option>
                  {PROJECT_STAGES.map((value) => (
                    <option key={value} value={value}>
                      {STAGE_LABELS[value]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="projects-help" role="status">
              {filtered.length} de {projects?.length ?? 0} proyectos
            </p>
            {!filtered.length ? (
              <Empty
                title={
                  projects?.length
                    ? "No hay coincidencias"
                    : "El siguiente proyecto empieza aquí"
                }
                description={
                  projects?.length
                    ? "Prueba con otro nombre o cambia los filtros."
                    : "Crea el primer expediente para organizar recibos, ingeniería, propuestas y seguimiento de obra en un solo lugar."
                }
              />
            ) : view === "list" ? (
              <div className="projects-card-grid">
                {filtered.map((project) => (
                  <Link
                    className="projects-card"
                    href={`/operacion/proyectos/${project.id}` as Route}
                    key={project.id}
                  >
                    <div className="projects-toolbar">
                      <span className="projects-eyebrow">{project.folio}</span>
                      <Badge
                        tone={
                          project.lifecycle === "ACTIVE" ? "neutral" : "warning"
                        }
                      >
                        {SEGMENT_LABELS[project.segment]}
                      </Badge>
                    </div>
                    <h3>{project.name}</h3>
                    <p>
                      {project.customerName}
                      <br />
                      {project.location || "Ubicación por completar"}
                    </p>
                    <div className="projects-card-foot">
                      <Badge>{STAGE_LABELS[project.stage]}</Badge>
                      <span>Revisión {project.version} →</span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div
                className="projects-table-wrap"
                tabIndex={0}
                role="region"
                aria-label="Control maestro de proyectos"
              >
                <table className="projects-table">
                  <thead>
                    <tr>
                      <th>Proyecto / cliente</th>
                      <th>Etapa</th>
                      <th>Responsable / fecha</th>
                      <th>Contratado</th>
                      <th>Por cobrar</th>
                      {showCosts ? (
                        <>
                          <th>Costo incurrido</th>
                          <th>Costo proyectado</th>
                          <th>Desviación</th>
                        </>
                      ) : null}
                      {showMargins ? <th>Utilidad proyectada</th> : null}
                      <th>Obra</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((project) => (
                      <tr key={project.id}>
                        <td>
                          <Link
                            href={`/operacion/proyectos/${project.id}` as Route}
                          >
                            {project.folio} · {project.name}
                          </Link>
                          <small>
                            {project.customerName} ·{" "}
                            {SEGMENT_LABELS[project.segment]}
                          </small>
                        </td>
                        <td>
                          <Badge
                            tone={
                              project.stage === "CLOSED"
                                ? "success"
                                : project.lifecycle !== "ACTIVE"
                                  ? "warning"
                                  : "neutral"
                            }
                          >
                            {STAGE_LABELS[project.stage]}
                          </Badge>
                          {project.lifecycle !== "ACTIVE" ? (
                            <small>
                              {
                                {
                                  PAUSED: "En pausa",
                                  CANCELLED: "Cancelado",
                                  LOST: "No concretado",
                                  ACTIVE: "Activo",
                                }[project.lifecycle]
                              }
                            </small>
                          ) : null}
                        </td>
                        <td>
                          {str(project.data, "ownerName", "Por asignar")}
                          <small>
                            {dateLabel(str(project.data, "dueDate"))}
                          </small>
                        </td>
                        <td>
                          {summaries[project.id]
                            ? money(summaries[project.id]?.contractedMxn)
                            : "Sin contrato"}
                        </td>
                        <td>
                          {summaries[project.id]
                            ? money(summaries[project.id]?.balanceMxn)
                            : "—"}
                        </td>
                        {showCosts ? (
                          <>
                            <td>{money(summaries[project.id]?.incurredMxn)}</td>
                            <td>
                              {summaries[project.id]?.projectedCostMxn ===
                              undefined
                                ? "Pendiente de presupuesto"
                                : money(
                                    summaries[project.id]?.projectedCostMxn,
                                  )}
                            </td>
                            <td>
                              {summaries[project.id]?.projectedCostMxn !==
                                undefined &&
                              summaries[project.id]?.budgetMxn !== undefined
                                ? money(
                                    summaries[project.id]!.projectedCostMxn! -
                                      summaries[project.id]!.budgetMxn!,
                                  )
                                : "Pendiente de presupuesto"}
                            </td>
                          </>
                        ) : null}
                        {showMargins ? (
                          <td>
                            {summaries[project.id]?.projectedProfitMxn ===
                            undefined
                              ? "Pendiente de presupuesto"
                              : money(
                                  summaries[project.id]?.projectedProfitMxn,
                                )}
                          </td>
                        ) : null}
                        <td>
                          {summaries[project.id]
                            ? `${summaries[project.id]?.physicalProgressPct}%`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      ) : null}
    </main>
  );
}
