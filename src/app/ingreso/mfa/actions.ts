"use server";

import { z } from "zod";
import { redirectTo } from "@/lib/auth/navigation";
import { safeInternalNextPath } from "@/lib/auth/policy";
import { getRuntimeConfig } from "@/lib/runtime/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const challengeSchema = z.object({
  factorId: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
  next: z.string().optional(),
});

export async function verifyMfa(formData: FormData) {
  if (!getRuntimeConfig().requireMfa) redirectTo("/operacion");
  const parsed = challengeSchema.safeParse({
    factorId: formData.get("factorId"),
    code: formData.get("code"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) redirectTo("/ingreso/mfa?reason=invalid");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: parsed.data.factorId,
    code: parsed.data.code,
  });
  if (error) redirectTo("/ingreso/mfa?reason=invalid");

  redirectTo(safeInternalNextPath(parsed.data.next));
}
