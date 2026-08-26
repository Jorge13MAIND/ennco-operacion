import { NextResponse, type NextRequest } from "next/server";
import { safeInternalNextPath } from "@/lib/auth/policy";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeInternalNextPath(request.nextUrl.searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(new URL("/ingreso?reason=invalid", request.url));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/ingreso?reason=invalid", request.url));
  }

  return NextResponse.redirect(new URL(next, request.url));
}
