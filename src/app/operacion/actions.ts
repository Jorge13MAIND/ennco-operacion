"use server";

import { redirectTo } from "@/lib/auth/navigation";
import { getRuntimeConfig, hasDedicatedSupabase } from "@/lib/runtime/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function signOut() {
  const config = getRuntimeConfig();
  if (config.demoMode || !hasDedicatedSupabase(config)) {
    redirectTo("/ingreso?reason=signed_out");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    redirectTo("/ingreso?reason=signout_failed");
  }

  redirectTo("/ingreso?reason=signed_out");
}
