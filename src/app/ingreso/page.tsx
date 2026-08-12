import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { signIn } from "@/app/ingreso/actions";
import { safeInternalNextPath } from "@/lib/auth/policy";
import { getRuntimeConfig, hasDedicatedSupabase } from "@/lib/runtime/config";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const reasonMessages: Record<string, string> = {
  auth: "Inicia sesión para entrar al Control Room.",
  forbidden: "La cuenta no tiene acceso activo a esta organización.",
  invalid: "No pudimos validar esas credenciales.",
  unavailable: "El acceso seguro todavía no está disponible.",
};

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const reason = typeof params.reason === "string" ? params.reason : "auth";
  const next = safeInternalNextPath(params.next);
  const config = getRuntimeConfig();
  const enabled = !config.demoMode && hasDedicatedSupabase(config);

  return (
    <>
      <SiteHeader />
      <main className="shell auth-shell" id="main-content" tabIndex={-1}>
        <section className="panel auth-panel">
          <p className="eyebrow">Acceso protegido</p>
          <h1>Control Room ENNCO</h1>
          <p className="lede">{reasonMessages[reason] ?? reasonMessages.auth}</p>
          {enabled ? (
            <form action={signIn} className="auth-form">
              <input name="next" type="hidden" value={next} />
              <label htmlFor="email">Correo</label>
              <input autoComplete="username" id="email" name="email" required type="email" />
              <label htmlFor="password">Contraseña</label>
              <input autoComplete="current-password" id="password" minLength={12} name="password" required type="password" />
              <button className="button" type="submit">Entrar</button>
            </form>
          ) : (
            <div className="notice">
              <strong>Modo local con tráfico cero.</strong>
              <p>Las cuentas, credenciales y MFA reales son un gate externo. El demo sintético permanece separado.</p>
              {config.demoMode ? <Link className="button secondary" href="/operacion">Abrir demo sintético</Link> : null}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
