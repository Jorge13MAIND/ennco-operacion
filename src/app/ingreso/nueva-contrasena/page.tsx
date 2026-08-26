import { SiteHeader } from "@/components/SiteHeader";
import { updatePassword } from "@/app/ingreso/nueva-contrasena/actions";
import { redirectTo } from "@/lib/auth/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = "force-dynamic";

export default async function NewPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) redirectTo("/ingreso?reason=auth");

  return (
    <>
      <SiteHeader />
      <main className="shell auth-shell" id="main-content" tabIndex={-1}>
        <section className="panel auth-panel">
          <p className="eyebrow">Contraseña del Control Room</p>
          <h1>Crea una contraseña exclusiva</h1>
          {params.reason === "invalid" ? <div className="notice danger" role="alert">Usa al menos 12 caracteres y confirma exactamente la misma contraseña.</div> : null}
          <form action={updatePassword} className="auth-form">
            <label htmlFor="password">Nueva contraseña</label>
            <input autoComplete="new-password" id="password" minLength={12} name="password" required type="password" />
            <label htmlFor="confirmation">Confirmar contraseña</label>
            <input autoComplete="new-password" id="confirmation" minLength={12} name="confirmation" required type="password" />
            <button className="button" type="submit">Guardar contraseña</button>
          </form>
        </section>
      </main>
    </>
  );
}
