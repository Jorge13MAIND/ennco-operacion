"use server";

import { z } from "zod";
import { redirectTo } from "@/lib/auth/navigation";
import { getRuntimeConfig, hasDedicatedSupabase } from "@/lib/runtime/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const recoverySchema = z.object({
  email: z.email().trim().toLowerCase(),
});

export async function requestPasswordRecovery(formData: FormData) {
  const parsed = recoverySchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) redirectTo("/ingreso/recuperar?status=sent");

  const config = getRuntimeConfig();
  if (!hasDedicatedSupabase(config) || config.demoMode) {
    redirectTo("/ingreso?reason=unavailable");
  }

  const supabase = await createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${config.appUrl}/auth/callback?next=/ingreso/nueva-contrasena`,
  });

  // The response is intentionally identical for known and unknown addresses.
  redirectTo("/ingreso/recuperar?status=sent");
}
