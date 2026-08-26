/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import type { ReactNode } from "react";

export function SiteHeader({
  operationsAction,
  variant = "public",
}: {
  operationsAction?: ReactNode;
  variant?: "public" | "operations";
}) {
  const isOperations = variant === "operations";
  return (
    <header className={`site-header ${isOperations ? "site-header-operations" : ""}`}>
      <div className="shell topbar">
        <div className="site-brand-cluster">
          <Link aria-label={isOperations ? "ENNCO Control Room, Hoy" : "ENNCO, inicio"} className="brand" href={isOperations ? "/operacion" : "/"}>
            <img alt="" className="brand-lockup" height="85" src="/brand/ennco-lockup.svg" width="160" />
          </Link>
          {isOperations ? (
            <div className="brand-context" aria-label="Área privada">
              <strong>Control Room</strong>
              <span>Operación privada</span>
            </div>
          ) : null}
        </div>
        <nav aria-label="Navegación principal" className="navlinks">
          {!isOperations ? <Link className="nav-capabilities" href="/#capacidades">Capacidades</Link> : null}
          <Link className="nav-diagnostic" href="/diagnostico">Diagnóstico</Link>
          <Link className="nav-private-link" href="/operacion">{isOperations ? "Hoy" : "Acceso privado"}</Link>
          {isOperations ? operationsAction : null}
        </nav>
      </div>
    </header>
  );
}
