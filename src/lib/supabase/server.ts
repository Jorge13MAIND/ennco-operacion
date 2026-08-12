import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getRuntimeConfig, hasDedicatedSupabase } from "@/lib/runtime/config";

export async function createSupabaseServerClient() {
  const config = getRuntimeConfig();
  if (!hasDedicatedSupabase(config)) {
    throw new Error("DEDICATED_SUPABASE_NOT_CONFIGURED");
  }

  const cookieStore = await cookies();

  return createServerClient(config.supabaseUrl, config.supabasePublishableKey, {
    cookies: {
      encode: "tokens-only",
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot always write cookies. src/proxy.ts owns refreshes.
        }
      },
    },
  });
}
