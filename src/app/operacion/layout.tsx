import { OperationsNav } from "@/components/OperationsNav";
import { SiteHeader } from "@/components/SiteHeader";
import { signOut } from "@/app/operacion/actions";

export default function OperationsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <SiteHeader
        operationsAction={(
          <form action={signOut} className="nav-signout-form">
            <button className="nav-signout-button" type="submit">Cerrar sesión</button>
          </form>
        )}
        variant="operations"
      />
      <div className="operations-shell">
        <aside className="operations-sidebar">
          <div className="operations-sidebar-label">ENNCO / Control Room 01</div>
          <OperationsNav variant="desktop" />
          <p className="operations-sidebar-foot">Sistema comercial privado. Evidencia, pipeline y revenue se validan por separado.</p>
        </aside>
        <div className="operations-workspace">
          <div className="operations-mobile-nav"><OperationsNav variant="mobile" /></div>
          {children}
          <footer className="footer operations-footer">
            <span>ENNCO Control Room / Acceso restringido.</span>
            <span>Fuente de verdad operativa.</span>
          </footer>
        </div>
      </div>
    </>
  );
}
