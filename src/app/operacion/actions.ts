"use server";

import { redirectTo } from "@/lib/auth/navigation";
import { getRuntimeConfig, hasDedicatedSupabase } from "@/lib/runtime/config";
import { SIGN_OUT_CSRF_FIELD, signOutCsrfTokenMatches } from "@/lib/security/csrf";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function signOut(formData: FormData) {
  const config = getRuntimeConfig();
  if (config.demoMode || !hasDedicatedSupabase(config)) {
    redirectTo("/ingreso?reason=signed_out");
  }

  const supabase = await createSupabaseServerClient();
  // El token del formulario debe ser el emitido para este mismo usuario
  // (src/app/operacion/layout.tsx); un POST forjado desde otro sitio no lo tiene.
  const { data: claimsData } = await supabase.auth.getClaims();
  const subject = claimsData?.claims?.sub ?? "anonymous";
  if (!signOutCsrfTokenMatches(formData.get(SIGN_OUT_CSRF_FIELD), subject, config)) {
    redirectTo("/ingreso?reason=signout_failed");
  }

  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    redirectTo("/ingreso?reason=signout_failed");
  }

  redirectTo("/ingreso?reason=signed_out");
}
