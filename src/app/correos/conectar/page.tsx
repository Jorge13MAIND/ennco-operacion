import { headers } from "next/headers";

import { SiteHeader } from "@/components/SiteHeader";
import { readDirectLaneInvitation } from "@/lib/correos/client";
import { invitationTokenSha256 } from "@/lib/correos/oauth";
import { getRuntimeConfig, hasDedicatedSupabase } from "@/lib/runtime/config";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ t?: string; estado?: string; buzon?: string }>;

const estados: Record<string, { title: string; body: string; tone: "ok" | "warn" }> = {
  conectado: { title: "Buzón conectado.", body: "El sistema ya puede enviar y leer respuestas desde este buzón. Puedes cerrar esta ventana.", tone: "ok" },
  duplicado: { title: "Este buzón ya estaba conectado.", body: "No se hizo ningún cambio. Puedes cerrar esta ventana.", tone: "ok" },
  identidad: { title: "La cuenta de Google no coincide con el buzón invitado.", body: "Vuelve a abrir la liga y, en la pantalla de Google, elige exactamente la cuenta que dice la invitación.", tone: "warn" },
  vencida: { title: "La invitación venció o ya se usó.", body: "Pide una liga nueva a quien te la envió.", tone: "warn" },
  invalida: { title: "La liga no es válida.", body: "Revisa que la hayas copiado completa.", tone: "warn" },
  rechazada: { title: "Google no completó la autorización.", body: "Si cancelaste, vuelve a abrir la liga. Si el error persiste, avisa a quien te la envió.", tone: "warn" },
  "no-configurado": { title: "La conexión de buzones aún no está habilitada.", body: "Falta configuración del lado de Teckel. No es algo que tú tengas que resolver.", tone: "warn" },
  "no-disponible": { title: "El servicio no está disponible en este momento.", body: "Inténtalo más tarde.", tone: "warn" },
  origen: { title: "La solicitud no vino de esta página.", body: "Vuelve a abrir la liga y presiona Conectar desde aquí.", tone: "warn" },
};

/**
 * Página pública de invitación (sin sesión). Muestra a qué buzón corresponde
 * la liga, qué permisos se piden y un solo botón. El POST va a
 * /api/v1/public/correos/oauth/start, que redirige a Google.
 */
export default async function ConectarBuzonPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const config = getRuntimeConfig();
  const estado = params.estado ? estados[params.estado] : null;

  let invitation: { normalized_email: string; sender_name: string; expires_at: string; is_client_primary: boolean } | null = null;
  let problem: string | null = null;
  if (!estado && params.t) {
    const tokenSha256 = invitationTokenSha256(params.t);
    if (!tokenSha256) problem = "invalida";
    else if (!hasDedicatedSupabase(config) || !config.directLaneReleased) problem = "no-configurado";
    else {
      const result = await readDirectLaneInvitation(config, tokenSha256).catch(() => null);
      if (!result || result.status !== "VALID" || !result.normalized_email) problem = "vencida";
      else invitation = { normalized_email: result.normalized_email, sender_name: result.sender_name ?? "", expires_at: result.expires_at ?? "", is_client_primary: result.is_client_primary ?? false };
    }
  }
  const shown = estado ?? (problem ? estados[problem] : null);

  return (
    <>
      <SiteHeader />
      <main className="public-main" id="main-content" tabIndex={-1}>
        <div className="shell section" style={{ maxWidth: 720 }}>
        <p className="eyebrow">ENNCO · Conexión de buzón</p>
        {shown ? (
          <section className="notice">
            <strong>{shown.title}</strong>
            <p>{shown.body}{params.buzon ? ` (${params.buzon})` : ""}</p>
          </section>
        ) : invitation ? (
          <section className="panel connect-card">
            <h1 className="connect-title">Conecta tu buzón</h1>
            <p className="connect-mailbox"><code>{invitation.normalized_email}</code></p>
            <p>
              Esta liga autoriza al sistema comercial de ENNCO a <strong>enviar correos</strong> y <strong>leer las respuestas</strong> desde este buzón, y nada más.
              No pide tu contraseña, no da acceso a otros buzones y puedes revocarlo cuando quieras desde tu cuenta de Google.
            </p>
            {invitation.is_client_primary ? (
              <p>
                Este es el buzón principal de tu empresa. El sistema lo trata con tope bajo (máximo 20 correos al día) para cuidar su reputación.
              </p>
            ) : null}
            <ol className="connect-steps">
              <li>Presiona <strong>Conectar con Google</strong>.</li>
              <li>En la pantalla de Google, inicia sesión <strong>exactamente</strong> como <code>{invitation.normalized_email}</code>.</li>
              <li>Acepta los permisos de Gmail. Serás regresado aquí con la confirmación.</li>
            </ol>
            <form action="/api/v1/public/correos/oauth/start" method="post">
              <input name="t" type="hidden" value={params.t} />
              <button className="button" nonce={nonce} type="submit">Conectar con Google</button>
            </form>
            <p className="fine">La liga vence el {new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "America/Mexico_City" }).format(new Date(invitation.expires_at))}.</p>
          </section>
        ) : (
          <section className="notice">
            <strong>Falta la liga de invitación.</strong>
            <p>Abre la liga completa que te enviaron; incluye un código después de <code>?t=</code>.</p>
          </section>
        )}
        </div>
      </main>
    </>
  );
}
