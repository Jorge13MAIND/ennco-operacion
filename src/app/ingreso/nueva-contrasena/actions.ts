"use server";

import { z } from "zod";
import { redirectTo } from "@/lib/auth/navigation";
import { getRuntimeConfig } from "@/lib/runtime/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const passwordSchema = z.object({
  password: z.string().min(12).max(256),
  confirmation: z.string().min(12).max(256),
}).refine((value) => value.password === value.confirmation, {
  message: "PASSWORD_CONFIRMATION_MISMATCH",
});

export async function updatePassword(formData: FormData) {
  const parsed = passwordSchema.safeParse({
    password: formData.get("password"),
    confirmation: formData.get("confirmation"),
  });
  if (!parsed.success) redirectTo("/ingreso/nueva-contrasena?reason=invalid");

  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData?.claims?.sub) redirectTo("/ingreso?reason=auth");

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) redirectTo("/ingreso/nueva-contrasena?reason=invalid");

  redirectTo(getRuntimeConfig().requireMfa ? "/ingreso/mfa?next=/operacion" : "/operacion");
}
