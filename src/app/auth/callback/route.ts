import { NextResponse, type NextRequest } from "next/server";
import { safeInternalNextPath } from "@/lib/auth/policy";
import { getRuntimeConfig } from "@/lib/runtime/config";
import { PASSWORD_RESET_COOKIE, PASSWORD_RESET_TTL_SECONDS, sealPasswordReset } from "@/lib/security/password-reset";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const NEW_PASSWORD_PATH = "/ingreso/nueva-contrasena";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeInternalNextPath(request.nextUrl.searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(new URL("/ingreso?reason=invalid", request.url));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/ingreso?reason=invalid", request.url));
  }

  const response = NextResponse.redirect(new URL(next, request.url));
  // Solo una liga de recuperación recién canjeada permite cambiar la contraseña sin la actual.
  const subject = data.user?.id;
  const sealed = next === NEW_PASSWORD_PATH && subject ? sealPasswordReset(subject, getRuntimeConfig()) : null;
  if (sealed) {
    response.cookies.set(PASSWORD_RESET_COOKIE, sealed, {
      httpOnly: true, secure: true, sameSite: "lax", path: "/ingreso", maxAge: PASSWORD_RESET_TTL_SECONDS,
    });
  }
  return response;
}
