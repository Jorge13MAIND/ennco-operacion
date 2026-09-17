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
  infraestructura: "Infraestructura",
  campanas: "Campañas",
};

type NavKey =
  | "home"
  | "correos"
  | "estadisticas"
  | "actividad"
  | "inteligencia"
  | "projects-master"
  | "projects-consumption"
  | "projects-engineering"
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
      { key: "actividad", href: "/operacion/correos/actividad" },
      { key: "respuestas", href: "/operacion/respuestas" },
      { key: "leads", href: "/operacion/leads" },
      { key: "campanas", href: "/operacion/campanas" },
    ],
  },
  {
    label: "Proyectos ENNCO",
    items: [
      { key: "projects-master", href: "/operacion/proyectos" },
      { key: "projects-consumption", href: "/operacion/proyectos/consumo" },
      { key: "projects-engineering", href: "/operacion/proyectos/ingenieria" },
      { key: "projects-list", href: "/operacion/proyectos/lista" },
      { key: "projects-catalogs", href: "/operacion/proyectos/catalogos" },
    ],
  },
];


/* Iconos a trazo, mismo estilo que el hub de ILT (caja 24, trazo 1.75, currentColor). */
function NavIcon({ id }: { id: NavKey }) {
  const c = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<string, React.ReactNode> = {
    home: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
    inteligencia: <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z" /></>,
    alertas: <><path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" /><path d="M10.5 19a1.8 1.8 0 0 0 3 0" /></>,
    cadencia: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /><path d="M12 13v3l2 1.5" /></>,
    infraestructura: <><rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" /><path d="M7 7h.01M7 17h.01" /></>,
    correos: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
    estadisticas: <><path d="M4 20V10M10 20V4M16 20v-8M22 20H2" /></>,
    actividad: <><path d="M3 12h4l3-7 4 14 3-7h4" /></>,
    respuestas: <><path d="M9 14 4 9l5-5" /><path d="M4 9h9a7 7 0 0 1 7 7v4" /></>,
    leads: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M16 6.2a3 3 0 0 1 0 5.6" /><path d="M18.5 19a5 5 0 0 0-3-4.6" /></>,
    empresas: <><path d="M3 21h18M5 21V7l7-4 7 4v14" /><path d="M9 10h.01M15 10h.01M9 14h.01M15 14h.01" /></>,
    campanas: <><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z" /><path d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12" /></>,
    "projects-master": <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8" /><path d="M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" /></>,
    "projects-consumption": <><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" /></>,
    "projects-engineering": <><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.4 2.4-2.1-2.1 2.5-2.4z" /></>,
    "projects-list": <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>,
    "projects-catalogs": <><path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z" /><path d="M20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z" /></>,
  };
  return <svg aria-hidden="true" className="nav-icon" {...c}>{paths[id] ?? paths.home}</svg>;
}

function itemLabel(key: NavKey): string {
  if (key === "home") return "Hoy";
  if (key === "correos") return "Correos";
  if (key === "estadisticas") return "Estadísticas";
  if (key === "actividad") return "Actividad";
  if (key === "inteligencia") return "Inteligencia";
  if (key === "projects-master") return "Cotizador";
  if (key === "projects-consumption") return "Calculadora de consumo";
  if (key === "projects-engineering") return "Ingeniería básica";
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
                !pathname.startsWith("/operacion/proyectos/catalogos") &&
                !pathname.startsWith("/operacion/proyectos/consumo") &&
                !pathname.startsWith("/operacion/proyectos/ingenieria")
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
              <NavIcon id={item.key} />
              <span className="nav-label">{itemLabel(item.key)}</span>
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
