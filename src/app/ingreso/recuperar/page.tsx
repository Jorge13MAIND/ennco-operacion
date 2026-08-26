import Link from "next/link";
import type { Route } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { requestPasswordRecovery } from "@/app/ingreso/recuperar/actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = "force-dynamic";

export default async function PasswordRecoveryPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const sent = params.status === "sent";

  return (
    <>
      <SiteHeader />
      <main className="shell auth-shell" id="main-content" tabIndex={-1}>
        <section className="panel auth-panel">
          <p className="eyebrow">Alta segura</p>
          <h1>Activa tu acceso</h1>
          {sent ? (
            <div className="notice" role="status">
              <strong>Revisa tu correo.</strong>
              <p>Si la cuenta está autorizada, recibirás un enlace de un solo uso para crear una contraseña exclusiva del Control Room.</p>
              <Link className="button secondary" href={"/ingreso" as Route}>Volver al acceso</Link>
            </div>
          ) : (
            <form action={requestPasswordRecovery} className="auth-form">
              <p className="lede">Usa el correo autorizado. No reutilices la contraseña de Google Workspace.</p>
              <label htmlFor="email">Correo</label>
              <input autoComplete="email" id="email" name="email" required type="email" />
              <button className="button" type="submit">Enviar enlace seguro</button>
              <Link className="auth-help-link" href={"/ingreso" as Route}>Volver</Link>
            </form>
          )}
        </section>
      </main>
    </>
  );
}
