"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

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

type NavKey =
  | "home"
  | "correos"
  | "estadisticas"
  | "inteligencia"
  | "projects-master"
  | "projects-list"
  | "projects-catalogs"
  | OperationModuleKey;

const groups: Array<{
  label: string;
  items: Array<{ key: NavKey; href: string }>;
}> = [
  {
    label: "Control",
    items: [
      { key: "home", href: "/operacion" },
      { key: "inteligencia", href: "/operacion/inteligencia" },
      { key: "alertas", href: "/operacion/alertas" },
      { key: "cadencia", href: "/operacion/cadencia" },
      { key: "infraestructura", href: "/operacion/infraestructura" },
    ],
  },
  {
    label: "Comercial",
    items: [
      { key: "correos", href: "/operacion/correos" },
      { key: "estadisticas", href: "/operacion/correos/estadisticas" },
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
  {
    label: "Proyectos ENNCO",
    items: [
      { key: "projects-master", href: "/operacion/proyectos" },
      { key: "projects-list", href: "/operacion/proyectos/lista" },
      { key: "projects-catalogs", href: "/operacion/proyectos/catalogos" },
    ],
  },
];

function itemLabel(key: NavKey): string {
  if (key === "home") return "Hoy";
  if (key === "correos") return "Correos";
  if (key === "estadisticas") return "Estadísticas";
  if (key === "inteligencia") return "Inteligencia";
  if (key === "projects-master") return "Control Maestro";
  if (key === "projects-list") return "Proyectos";
  if (key === "projects-catalogs") return "Catálogos";
  return moduleLabels[key];
}

export function OperationsNav({ variant }: { variant: "desktop" | "mobile" }) {
  const pathname = usePathname();
  const navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    if (variant === "desktop" && pathname.startsWith("/operacion/proyectos")) {
      const sidebar = navigation.current?.closest<HTMLElement>(
        ".operations-sidebar",
      );
      const activeGroup = navigation.current
        ?.querySelector('[aria-current="page"]')
        ?.closest(".operations-nav-group");
      if (sidebar && activeGroup) {
        const container = sidebar.getBoundingClientRect();
        const group = activeGroup.getBoundingClientRect();
        if (group.bottom > container.bottom)
          sidebar.scrollTop += group.bottom - container.bottom + 16;
        else if (group.top < container.top)
          sidebar.scrollTop -= container.top - group.top + 16;
      }
    }
  }, [pathname, variant]);
  const links = groups.map((group) => (
    <section className="operations-nav-group" key={group.label}>
      <h2>{group.label}</h2>
      <div>
        {group.items.map((item) => {
          const active =
            item.key === "projects-list"
              ? pathname.startsWith("/operacion/proyectos/") &&
                !pathname.startsWith("/operacion/proyectos/catalogos")
              : item.key === "projects-catalogs"
                ? pathname === item.href || pathname.startsWith(`${item.href}/`)
                : pathname === item.href;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              href={item.href as Route}
              key={item.key}
              prefetch
            >
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
        <nav aria-label="Módulos de operación" className="operations-nav">
          {links}
        </nav>
      </details>
    );
  }

  return (
    <nav
      aria-label="Módulos de operación"
      className="operations-nav"
      ref={navigation}
    >
      {links}
    </nav>
  );
}
