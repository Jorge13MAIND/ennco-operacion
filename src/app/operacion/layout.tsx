import { OperationsNav } from "@/components/OperationsNav";
import { SiteHeader } from "@/components/SiteHeader";
import { signOut } from "@/app/operacion/actions";
import { getRuntimeConfig, hasDedicatedSupabase, type RuntimeConfig } from "@/lib/runtime/config";
import { SIGN_OUT_CSRF_FIELD, signOutCsrfToken } from "@/lib/security/csrf";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Sujeto al que se ata el token anti-CSRF del cierre de sesión. Mismo origen
// que usa la action (claims de la sesión); sin Supabase dedicado no hay sesión.
async function signOutSubject(config: RuntimeConfig): Promise<string> {
  if (config.demoMode || !hasDedicatedSupabase(config)) return "anonymous";
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.sub ?? "anonymous";
}

export default async function OperationsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const config = getRuntimeConfig();
  const csrfToken = signOutCsrfToken(await signOutSubject(config), config);
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
