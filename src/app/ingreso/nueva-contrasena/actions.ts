"use server";

import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { redirectTo } from "@/lib/auth/navigation";
import { getRuntimeConfig } from "@/lib/runtime/config";
import { PASSWORD_RESET_COOKIE, passwordResetIsValid } from "@/lib/security/password-reset";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const passwordSchema = z.object({
  password: z.string().min(12).max(256),
  confirmation: z.string().min(12).max(256),
  current: z.string().max(256).optional(),
}).refine((value) => value.password === value.confirmation, {
  message: "PASSWORD_CONFIRMATION_MISMATCH",
});

/** Comprueba la contraseña actual con un cliente aparte, sin tocar la sesión del navegador. */
async function currentPasswordMatches(email: string, password: string): Promise<boolean> {
  const config = getRuntimeConfig();
  if (!config.supabaseUrl || !config.supabasePublishableKey) return false;
  const probe = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await probe.auth.signInWithPassword({ email, password });
  if (data.session) await probe.auth.signOut({ scope: "local" }).catch(() => undefined);
  return !error && Boolean(data.session);
}

export async function updatePassword(formData: FormData) {
  const parsed = passwordSchema.safeParse({
    password: formData.get("password"),
    confirmation: formData.get("confirmation"),
    current: formData.get("current") ?? undefined,
  });
  if (!parsed.success) redirectTo("/ingreso/nueva-contrasena?reason=invalid");

  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const subject = claimsData?.claims?.sub;
  if (claimsError || !subject) redirectTo("/ingreso?reason=auth");

  // Sin una liga de recuperación recién canjeada, hay que dar la contraseña actual (2-oct, auditoría).
  const config = getRuntimeConfig();
  const jar = await cookies();
  const fromRecovery = passwordResetIsValid(jar.get(PASSWORD_RESET_COOKIE)?.value, subject, config);
  if (!fromRecovery) {
    const email = typeof claimsData.claims.email === "string" ? claimsData.claims.email : "";
    if (!email || !parsed.data.current || !(await currentPasswordMatches(email, parsed.data.current))) {
      redirectTo("/ingreso/nueva-contrasena?reason=current");
    }
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) redirectTo("/ingreso/nueva-contrasena?reason=invalid");
  jar.delete({ name: PASSWORD_RESET_COOKIE, path: "/ingreso" });

  redirectTo(config.requireMfa ? "/ingreso/mfa?next=/operacion" : "/operacion");
}
