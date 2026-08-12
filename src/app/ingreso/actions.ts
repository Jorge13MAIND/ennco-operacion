"use server";

import { z } from "zod";
import { redirectTo } from "@/lib/auth/navigation";
import { safeInternalNextPath } from "@/lib/auth/policy";
import { getRuntimeConfig, hasDedicatedSupabase } from "@/lib/runtime/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const credentialsSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(12).max(256),
  next: z.string().optional(),
});

export async function signIn(formData: FormData) {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) redirectTo("/ingreso?reason=invalid");

  const config = getRuntimeConfig();
  if (!hasDedicatedSupabase(config) || config.demoMode) {
    redirectTo("/ingreso?reason=unavailable");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) redirectTo("/ingreso?reason=invalid");

  const { data: assurance, error: assuranceError } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError) redirectTo("/ingreso?reason=unavailable");

  const next = safeInternalNextPath(parsed.data.next);
  if (config.requireMfa && assurance.currentLevel !== "aal2") {
    redirectTo(`/ingreso/mfa?next=${encodeURIComponent(next)}`);
  }
  redirectTo(next);
}
