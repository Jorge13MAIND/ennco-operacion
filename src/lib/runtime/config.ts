import { z } from "zod";

const runtimeSchema = z.object({
  appEnv: z.enum(["development", "staging", "production"]),
  appUrl: z.url(),
  demoMode: z.boolean(),
  requireMfa: z.boolean(),
  externalSendAllowed: z.boolean(),
  globalKillSwitch: z.boolean(),
  publicSurfaceReleased: z.boolean(),
  privacyNoticeApproved: z.boolean(),
  gmailWebhookReleased: z.boolean(),
  supabaseUrl: z.url().optional(),
  supabasePublishableKey: z.string().min(20).optional(),
  organizationId: z.uuid().optional(),
  prequoteIngestSecret: z.string().min(32).optional(),
  pdfSigningSecret: z.string().min(32).optional(),
  gmailIngestSecret: z.string().min(32).optional(),
  gmailPubSubAudience: z.url().optional(),
  gmailPubSubServiceAccount: z.email().optional(),
  gmailPubSubSubscription: z.string().min(3).max(512).optional(),
});

export type RuntimeConfig = z.infer<typeof runtimeSchema>;

type RuntimeEnvironment = Record<string, string | undefined>;

function envBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true";
}

function inferAppEnvironment(environment: RuntimeEnvironment): "development" | "staging" | "production" {
  if (environment.NEXT_PUBLIC_APP_ENV) {
    return z.enum(["development", "staging", "production"]).parse(environment.NEXT_PUBLIC_APP_ENV);
  }
  if (environment.VERCEL_ENV === "production") return "production";
  if (environment.VERCEL_ENV === "preview") return "staging";
  return "development";
}

export function getRuntimeConfig(environment: RuntimeEnvironment = process.env): RuntimeConfig {
  const appEnv = inferAppEnvironment(environment);
  if (
    (environment.VERCEL_ENV === "production" && appEnv !== "production") ||
    (environment.VERCEL_ENV === "preview" && appEnv === "production")
  ) {
    throw new Error("APP_ENV_PLATFORM_MISMATCH");
  }
  const config = runtimeSchema.parse({
    appEnv,
    appUrl: environment.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    demoMode: envBoolean(environment.ENNCO_DEMO_MODE, appEnv === "development"),
    requireMfa: envBoolean(environment.ENNCO_REQUIRE_MFA, appEnv !== "development"),
    externalSendAllowed: envBoolean(environment.ENNCO_ALLOW_EXTERNAL_SEND, false),
    globalKillSwitch: envBoolean(environment.ENNCO_GLOBAL_KILL_SWITCH, true),
    publicSurfaceReleased: envBoolean(environment.ENNCO_PUBLIC_SURFACE_RELEASED, false),
    privacyNoticeApproved: envBoolean(environment.ENNCO_PRIVACY_NOTICE_APPROVED, false),
    gmailWebhookReleased: envBoolean(environment.ENNCO_GMAIL_WEBHOOK_RELEASED, false),
    supabaseUrl: environment.NEXT_PUBLIC_SUPABASE_URL || undefined,
    supabasePublishableKey:
      environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      environment.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      undefined,
    organizationId: environment.NEXT_PUBLIC_ENNCO_ORGANIZATION_ID || undefined,
    prequoteIngestSecret: environment.ENNCO_PREQUOTE_INGEST_SECRET || undefined,
    pdfSigningSecret: environment.ENNCO_PDF_SIGNING_SECRET || undefined,
    gmailIngestSecret: environment.ENNCO_GMAIL_INGEST_SECRET || undefined,
    gmailPubSubAudience: environment.GMAIL_PUBSUB_AUDIENCE || undefined,
    gmailPubSubServiceAccount: environment.GMAIL_PUBSUB_SERVICE_ACCOUNT || undefined,
    gmailPubSubSubscription: environment.GMAIL_PUBSUB_SUBSCRIPTION || undefined,
  });

  const configuredValues = [config.supabaseUrl, config.supabasePublishableKey, config.organizationId];
  const configuredCount = configuredValues.filter(Boolean).length;

  if (configuredCount > 0 && configuredCount < configuredValues.length) {
    throw new Error("INCOMPLETE_DEDICATED_SUPABASE_CONFIGURATION");
  }
  if (!config.demoMode && configuredCount !== configuredValues.length) {
    throw new Error("DEDICATED_SUPABASE_REQUIRED_OUTSIDE_DEMO");
  }
  if (config.appEnv === "production" && config.demoMode) {
    throw new Error("DEMO_MODE_FORBIDDEN_IN_PRODUCTION");
  }
  if (config.appEnv === "production" && !config.requireMfa) {
    throw new Error("MFA_REQUIRED_IN_PRODUCTION");
  }
  if (config.appEnv === "production" && (!config.prequoteIngestSecret || !config.pdfSigningSecret)) {
    throw new Error("PREQUOTE_SERVER_SECRETS_REQUIRED_IN_PRODUCTION");
  }
  if (config.publicSurfaceReleased && (config.demoMode || !config.privacyNoticeApproved)) {
    throw new Error("PUBLIC_SURFACE_RELEASE_GATES_INCOMPLETE");
  }
  if (
    config.gmailWebhookReleased
    && (
      config.demoMode
      || !config.gmailIngestSecret
      || !config.gmailPubSubAudience
      || !config.gmailPubSubServiceAccount
      || !config.gmailPubSubSubscription
      || configuredCount !== configuredValues.length
    )
  ) {
    throw new Error("GMAIL_WEBHOOK_RELEASE_GATES_INCOMPLETE");
  }

  return config;
}

export function getPdfSigningSecret(config: RuntimeConfig): string {
  if (config.pdfSigningSecret) return config.pdfSigningSecret;
  if (config.demoMode && config.appEnv !== "production") {
    return "ennco-local-synthetic-pdf-secret-only";
  }
  throw new Error("PDF_SIGNING_SECRET_REQUIRED");
}

export function hasDedicatedSupabase(config: RuntimeConfig): config is RuntimeConfig & {
  supabaseUrl: string;
  supabasePublishableKey: string;
  organizationId: string;
} {
  return Boolean(config.supabaseUrl && config.supabasePublishableKey && config.organizationId);
}
