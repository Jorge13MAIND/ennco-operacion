import { OperationsNav } from "@/components/OperationsNav";
import { SiteHeader } from "@/components/SiteHeader";
import { signOut } from "@/app/operacion/actions";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getRuntimeConfig } from "@/lib/runtime/config";
import { SIGN_OUT_CSRF_FIELD, signOutCsrfToken } from "@/lib/security/csrf";

export default async function OperationsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Sin sesión válida y pertenencia activa no se dibuja nada del hub, ni el menú (2-oct: la
  // precarga del router mostraba el esqueleto a visitantes anónimos). Cada página lo vuelve a exigir.
  const access = await requireOperationsAccess();
  const config = getRuntimeConfig();
  // El token anti-CSRF del cierre de sesión se ata al mismo sujeto que usa la action.
  const csrfToken = signOutCsrfToken(access.userId ?? "anonymous", config);
  return (
    <div className="cr-root" data-cr-skin="atlas">
      <SiteHeader
        operationsAction={(
          <form action={signOut} className="nav-signout-form">
            <input name={SIGN_OUT_CSRF_FIELD} type="hidden" value={csrfToken} />
            <button className="nav-signout-button" type="submit">Cerrar sesión</button>
          </form>
        )}
        variant="operations"
      />
      <div className="operations-shell">
        <aside className="operations-sidebar">
          <div className="operations-sidebar-label">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="" aria-hidden="true" className="cr-sidebar-lockup" height="70" src="/brand/ennco-lockup-knockout.svg" width="132" />
            <span>Centro de comando</span>
          </div>
          <OperationsNav variant="desktop" />
          <div className="cr-sidebar-profile">
            <span aria-hidden="true" className="cr-sidebar-profile-avatar">EN</span>
            <div>
              <strong>ENNCO / Control Room 01</strong>
              <span>Operado por Teckel <span aria-hidden="true" className="cr-pulse-dot" /></span>
            </div>
          </div>
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
    </div>
  );
}
