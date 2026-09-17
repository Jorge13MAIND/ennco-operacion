import { NextRequest } from "next/server";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims } }),
}));

vi.mock("@/lib/runtime/config", () => ({
  getRuntimeConfig: () => ({
    appEnv: "production",
    demoMode: false,
    supabaseUrl: "https://proyecto.supabase.co",
    supabasePublishableKey: "sb_publishable_clave_de_prueba_1234567890",
  }),
  hasDedicatedSupabase: () => true,
}));

const { updateSupabaseSession } = await import("./proxy");

function pedir(cookie?: string): NextRequest {
  return new NextRequest("https://ennco-operacion.vercel.app/operacion", {
    headers: cookie ? { cookie } : undefined,
  });
}

const COOKIE = "sb-isnzaoifdjtwnugupidj-auth-token";

describe("updateSupabaseSession", () => {
  beforeEach(() => getClaims.mockReset());

  it("deja pasar a la sesión válida", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "u1", is_anonymous: false } }, error: null });
    const res = await updateSupabaseSession(pedir(`${COOKIE}=lo-que-sea`));
    expect(res.status).toBe(200);
  });

  it("manda a iniciar sesión cuando no hay sesión", async () => {
    getClaims.mockResolvedValue({ data: { claims: null }, error: null });
    const res = await updateSupabaseSession(pedir());
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/ingreso?reason=auth");
  });

  // El 503 dejaba atorado a quien tuviera una cookie muerta: recargar repetía el error.
  it("con la sesión caducada o revocada manda a /ingreso y borra la cookie, no responde 503", async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: new AuthApiError("Invalid Refresh Token: Already Used", 400, "refresh_token_already_used"),
    });
    const res = await updateSupabaseSession(pedir(`${COOKIE}=sesion-muerta`));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/ingreso?reason=expirada");
    expect(res.cookies.get(COOKIE)?.value).toBe("");
  });

  it("borra también las cookies partidas en trozos", async () => {
    getClaims.mockResolvedValue({ data: null, error: new AuthApiError("Session from session_id claim in JWT does not exist", 403, "session_not_found") });
    const res = await updateSupabaseSession(pedir(`${COOKIE}.0=parte-uno; ${COOKIE}.1=parte-dos`));
    expect(res.cookies.get(`${COOKIE}.0`)?.value).toBe("");
    expect(res.cookies.get(`${COOKIE}.1`)?.value).toBe("");
  });

  it("solo responde 503 cuando Supabase no contesta", async () => {
    getClaims.mockResolvedValue({ data: null, error: new AuthRetryableFetchError("fetch failed", 0) });
    const res = await updateSupabaseSession(pedir(`${COOKIE}=sesion-viva`));
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("Ir al inicio de sesión");
  });
});
