"use client";

import Link from "next/link";
import { useState } from "react";
import type { Route } from "next";
import {
  SEGMENT_LABELS,
  STAGE_LABELS,
  type ProjectDetailResponse,
} from "@/lib/projects/types";
import {
  ContractSection,
  CollectionSection,
  ProposalsSection,
} from "./ProjectCommercial";
import {
  DocumentsSection,
  ProjectData,
  ReceiptsSection,
  SurveySection,
} from "./ProjectIntake";
import { EngineeringSection } from "./ProjectEngineering";
import {
  ClosureSection,
  ExecutionSection,
  ExpensesSection,
  PurchasesSection,
} from "./ProjectOperations";
import {
  Badge,
  LoadError,
  LoadingState,
  Notice,
  PageHeader,
  Readiness,
  dateLabel,
  useResource,
} from "./ui";

const tabs = [
  { key: "datos", label: "Datos", Component: ProjectData },
  { key: "recibos", label: "Recibos", Component: ReceiptsSection },
  { key: "levantamiento", label: "Levantamiento", Component: SurveySection },
  { key: "ingenieria", label: "Ingeniería", Component: EngineeringSection },
  { key: "propuestas", label: "Propuestas", Component: ProposalsSection },
  { key: "contrato", label: "Contrato", Component: ContractSection },
  { key: "compras", label: "Compras", Component: PurchasesSection },
  { key: "gastos", label: "Gastos", Component: ExpensesSection },
  { key: "obra", label: "Obra", Component: ExecutionSection },
  { key: "cobranza", label: "Cobranza", Component: CollectionSection },
  { key: "documentos", label: "Documentos", Component: DocumentsSection },
  { key: "cierre", label: "Cierre", Component: ClosureSection },
];
export function ProjectWorkspace({ id, tab }: { id: string; tab: string }) {
  const resource = useResource<ProjectDetailResponse>(`/api/v1/projects/${id}`);
  const [reset, setReset] = useState(0);
  const current = tabs.find((item) => item.key === tab) ?? tabs[0]!;
  const detail = resource.data;
  const Section = current.Component;
  return (
    <main
      className="shell section operations-main projects-page"
      id="main-content"
      tabIndex={-1}
    >
      <Link
        className="projects-help"
        href={"/operacion/proyectos/lista" as Route}
      >
        ← Todos los proyectos
      </Link>
      {resource.loading ? <LoadingState /> : null}
      {resource.error ? (
        <LoadError
          message={resource.error}
          retry={() => void resource.reload()}
        />
      ) : null}
      {detail ? (
        <>
          <PageHeader
            eyebrow={`${detail.project.folio} · ${SEGMENT_LABELS[detail.project.segment]}`}
            title={detail.project.name}
            description={`${detail.project.customerName}${detail.project.location ? ` · ${detail.project.location}` : ""}`}
          >
            <Badge
              tone={detail.project.stage === "CLOSED" ? "success" : "neutral"}
            >
              {STAGE_LABELS[detail.project.stage]}
            </Badge>
            <button
              className="projects-button"
              data-variant="secondary"
              type="button"
              onClick={() => {
                if (
                  !document.querySelector('form[data-dirty="true"]') ||
                  window.confirm(
                    "Hay cambios sin guardar. ¿Quieres actualizar y conservar sólo lo guardado?",
                  )
                )
                  void resource
                    .reload()
                    .then(() => setReset((value) => value + 1));
              }}
            >
              Actualizar
            </button>
          </PageHeader>
          <Readiness readiness={detail.readiness} />
          <div className="projects-toolbar">
            <span className="projects-help">
              Revisión {detail.project.version} · actualizado{" "}
              {dateLabel(detail.project.updatedAt)}
            </span>
            {detail.access.readOnly ? <Badge>Acceso de consulta</Badge> : null}
            {detail.project.lifecycle !== "ACTIVE" ? (
              <Badge tone="warning">
                {
                  {
                    PAUSED: "Proyecto en pausa",
                    CANCELLED: "Proyecto cancelado",
                    LOST: "Oportunidad no concretada",
                    ACTIVE: "Activo",
                  }[detail.project.lifecycle]
                }
              </Badge>
            ) : null}
          </div>
          <nav className="projects-tabs" aria-label="Secciones del expediente">
            {tabs.map((item) => (
              <Link
                href={`/operacion/proyectos/${id}?tab=${item.key}` as Route}
                key={item.key}
                aria-current={item.key === current.key ? "page" : undefined}
                scroll={false}
                onClick={(event) => {
                  if (
                    item.key !== current.key &&
                    document.querySelector('form[data-dirty="true"]') &&
                    !window.confirm(
                      "Hay datos sin guardar en esta sección. ¿Quieres cambiar de sección?",
                    )
                  )
                    event.preventDefault();
                }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          {detail.summary.alerts.filter((alert) => alert.level === "error")
            .length ? (
            <Notice tone="warning">
              <strong>Pendientes del proyecto</strong>
              <ul>
                {detail.summary.alerts
                  .filter((alert) => alert.level === "error")
                  .map((alert, index) => (
                    <li key={`${alert.code}-${index}`}>{alert.message}</li>
                  ))}
              </ul>
            </Notice>
          ) : null}
          <div key={`${current.key}-${reset}`}>
            <Section detail={detail} reload={resource.reload} />
          </div>
        </>
      ) : null}
    </main>
  );
}
