import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getRuntimeConfig, hasDedicatedSupabase } from "@/lib/runtime/config";

function copyAuthResponse(source: NextResponse, target: NextResponse): NextResponse {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = source.headers.get(header);
    if (value) target.headers.set(header, value);
  }
  return target;
}

function unavailable(): NextResponse {
  return new NextResponse("El acceso seguro no está disponible.", {
    status: 503,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export async function updateSupabaseSession(request: NextRequest): Promise<NextResponse> {
  let config;
  try {
    config = getRuntimeConfig();
  } catch {
    return unavailable();
  }

  if (config.demoMode && config.appEnv !== "production") {
    return NextResponse.next({ request });
  }
  if (!hasDedicatedSupabase(config)) return unavailable();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.supabaseUrl, config.supabasePublishableKey, {
    cookies: {
      encode: "tokens-only",
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();
  if (error) return unavailable();
  if (!data?.claims?.sub || data.claims.is_anonymous) {
    const destination = new URL("/ingreso", request.url);
    destination.searchParams.set("reason", "auth");
    return copyAuthResponse(response, NextResponse.redirect(destination));
  }

  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
