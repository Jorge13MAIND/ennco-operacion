import { z } from "zod";

const runtimeSchema = z.object({
  appEnv: z.enum(["development", "staging", "production"]),
  appUrl: z.url(),
  demoMode: z.boolean(),
  externalSendAllowed: z.boolean(),
  globalKillSwitch: z.boolean(),
  supabaseUrl: z.url().optional(),
  supabaseAnonKey: z.string().min(20).optional(),
  supabaseServiceRoleKey: z.string().min(20).optional(),
});

export type RuntimeConfig = z.infer<typeof runtimeSchema>;

function envBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true";
}

export function getRuntimeConfig(): RuntimeConfig {
  const config = runtimeSchema.parse({
    appEnv: process.env.NEXT_PUBLIC_APP_ENV ?? "development",
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    demoMode: envBoolean(process.env.ENNCO_DEMO_MODE, true),
    externalSendAllowed: envBoolean(process.env.ENNCO_ALLOW_EXTERNAL_SEND, false),
    globalKillSwitch: envBoolean(process.env.ENNCO_GLOBAL_KILL_SWITCH, true),
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || undefined,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || undefined,
  });

  if (config.appEnv === "production") {
    if (config.demoMode) throw new Error("DEMO_MODE_FORBIDDEN_IN_PRODUCTION");
    if (!config.supabaseUrl || !config.supabaseAnonKey || !config.supabaseServiceRoleKey) {
      throw new Error("DEDICATED_SUPABASE_REQUIRED_IN_PRODUCTION");
    }
  }
  return config;
}
