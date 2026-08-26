"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

import type { OperationModuleKey } from "@/lib/operations/portal";

const moduleLabels: Record<OperationModuleKey, string> = {
  alertas: "Alertas e incidentes",
  cadencia: "Cadencia",
  respuestas: "Respuestas",
  leads: "Leads",
  empresas: "Empresas",
  precotizaciones: "Precotizaciones",
  infraestructura: "Infraestructura",
  campanas: "Campañas",
  pipeline: "Pipeline",
  roadmap: "Roadmap",
  aprobaciones: "Aprobaciones",
  reportes: "Reportes",
  exportaciones: "Exportaciones",
  entrega: "Entrega",
};

const groups: Array<{ label: string; items: Array<{ key: "home" | OperationModuleKey; href: string }> }> = [
  {
    label: "Control",
    items: [
      { key: "home", href: "/operacion" },
      { key: "alertas", href: "/operacion/alertas" },
      { key: "cadencia", href: "/operacion/cadencia" },
      { key: "infraestructura", href: "/operacion/infraestructura" },
    ],
  },
  {
    label: "Comercial",
    items: [
      { key: "respuestas", href: "/operacion/respuestas" },
      { key: "leads", href: "/operacion/leads" },
      { key: "empresas", href: "/operacion/empresas" },
      { key: "precotizaciones", href: "/operacion/precotizaciones" },
      { key: "campanas", href: "/operacion/campanas" },
      { key: "pipeline", href: "/operacion/pipeline" },
    ],
  },
  {
    label: "Gobierno",
    items: [
      { key: "aprobaciones", href: "/operacion/aprobaciones" },
      { key: "roadmap", href: "/operacion/roadmap" },
      { key: "reportes", href: "/operacion/reportes" },
      { key: "exportaciones", href: "/operacion/exportaciones" },
      { key: "entrega", href: "/operacion/entrega" },
    ],
  },
];

function itemLabel(key: "home" | OperationModuleKey): string {
  return key === "home" ? "Hoy" : moduleLabels[key];
}

export function OperationsNav({ variant }: { variant: "desktop" | "mobile" }) {
  const pathname = usePathname();
  const links = groups.map((group) => (
    <section className="operations-nav-group" key={group.label}>
      <h2>{group.label}</h2>
      <div>
        {group.items.map((item) => {
          const active = pathname === item.href;
          return (
            <Link aria-current={active ? "page" : undefined} href={item.href as Route} key={item.key}>
              <span aria-hidden="true" className="nav-indicator" />
              {itemLabel(item.key)}
            </Link>
          );
        })}
      </div>
    </section>
  ));

  if (variant === "mobile") {
    return (
      <details className="operations-mobile-menu">
        <summary>Menú de operación</summary>
        <nav aria-label="Módulos de operación">{links}</nav>
      </details>
    );
  }

  return <nav aria-label="Módulos de operación" className="operations-nav">{links}</nav>;
}
