import { createServerClient } from "@supabase/ssr";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getRuntimeConfig, hasDedicatedSupabase } from "@/lib/runtime/config";

/** Cookies donde Supabase guarda la sesión, incluidas las partidas en trozos (`.0`, `.1`). */
function isSessionCookie(name: string): boolean {
  return name.startsWith("sb-") && name.includes("-auth-token");
}

function copyAuthResponse(source: NextResponse, target: NextResponse): NextResponse {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = source.headers.get(header);
    if (value) target.headers.set(header, value);
  }
  return target;
}

function unavailable(): NextResponse {
  const body = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acceso no disponible</title><body style="margin:0;font:16px/1.6 system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;min-height:100vh"><main style="max-width:32rem;padding:2rem;text-align:center"><h1 style="font-size:1.35rem;margin:0 0 .75rem">El acceso seguro no está disponible.</h1><p style="margin:0 0 1.5rem;color:#94a3b8">No pudimos contactar al servicio de identidad. Es temporal: vuelve a intentarlo en un momento.</p><a href="/ingreso" style="display:inline-block;padding:.65rem 1.25rem;border-radius:.5rem;background:#38bdf8;color:#0f172a;font-weight:600;text-decoration:none">Ir al inicio de sesión</a></main></body></html>`;
  return new NextResponse(body, {
    status: 503,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

/** Manda a iniciar sesión; si la sesión ya no sirve, borra sus cookies para no dejar al usuario atorado. */
function toSignIn(request: NextRequest, response: NextResponse, reason: string, clearSession: boolean): NextResponse {
  const destination = new URL("/ingreso", request.url);
  destination.searchParams.set("reason", reason);
  const redirect = copyAuthResponse(response, NextResponse.redirect(destination));
  if (clearSession) {
    for (const cookie of request.cookies.getAll()) {
      if (isSessionCookie(cookie.name)) redirect.cookies.set(cookie.name, "", { path: "/", maxAge: 0 });
    }
  }
  return redirect;
}

export async function updateSupabaseSession(request: NextRequest, requestHeaders = new Headers(request.headers)): Promise<NextResponse> {
  let config;
  try {
    config = getRuntimeConfig();
  } catch {
    return unavailable();
  }

  if (config.demoMode && config.appEnv !== "production") {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }
  if (!hasDedicatedSupabase(config)) return unavailable();

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const supabase = createServerClient(config.supabaseUrl, config.supabasePublishableKey, {
    cookies: {
      encode: "tokens-only",
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: requestHeaders } });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();
  if (error) {
    // Solo un fallo de red o de Supabase es una indisponibilidad. Una sesión caducada,
    // revocada o con el token de refresco ya usado es simplemente dejar de estar dentro:
    // si respondemos 503 el usuario queda atorado, porque la cookie muerta sigue ahí.
    if (isAuthRetryableFetchError(error)) return unavailable();
    return toSignIn(request, response, "expirada", true);
  }
  if (!data?.claims?.sub || data.claims.is_anonymous) return toSignIn(request, response, "auth", false);

  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
