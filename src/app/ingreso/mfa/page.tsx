import { SiteHeader } from "@/components/SiteHeader";
import { verifyMfa } from "@/app/ingreso/mfa/actions";
import { redirectTo } from "@/lib/auth/navigation";
import { safeInternalNextPath } from "@/lib/auth/policy";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = "force-dynamic";

export default async function MfaPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeInternalNextPath(params.next);
  const supabase = await createSupabaseServerClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) redirectTo("/ingreso?reason=auth");
  if (claimsData.claims.aal === "aal2") redirectTo(next);

  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) redirectTo("/ingreso?reason=unavailable");
  const factors = data.totp.filter((factor) => factor.status === "verified");

  return (
    <>
      <SiteHeader />
      <main className="shell auth-shell" id="main-content" tabIndex={-1}>
        <section className="panel auth-panel">
          <p className="eyebrow">Segundo factor</p>
          <h1>Confirma tu acceso</h1>
          {factors.length === 0 ? (
            <div className="notice danger">
              <strong>Cuenta sin factor verificado.</strong>
              <p>El acceso permanece bloqueado. Un administrador debe completar el alta segura de MFA.</p>
            </div>
          ) : (
            <form action={verifyMfa} className="auth-form">
              <input name="factorId" type="hidden" value={factors[0]?.id} />
              <input name="next" type="hidden" value={next} />
              <label htmlFor="code">Código de seis dígitos</label>
              <input autoComplete="one-time-code" id="code" inputMode="numeric" maxLength={6} minLength={6} name="code" pattern="[0-9]{6}" required />
              <button className="button" type="submit">Verificar</button>
            </form>
          )}
        </section>
      </main>
    </>
  );
}
