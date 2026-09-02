import { z } from "zod";

import {
  PRIVACY_NOTICE_CONTENT_SHA256,
  PRIVACY_NOTICE_VERSION,
} from "@/lib/privacy/notice";

const runtimeSchema = z.object({
  appEnv: z.enum(["development", "staging", "production"]),
  appUrl: z.url(),
  demoMode: z.boolean(),
  requireMfa: z.boolean(),
  externalSendAllowed: z.boolean(),
  globalKillSwitch: z.boolean(),
  publicSurfaceReleased: z.boolean(),
  publicSurfaceReleasedAt: z.iso.datetime({ offset: true }).optional(),
  privacyNoticeApproved: z.boolean(),
  privacyNoticeApprovedVersion: z.string().min(1).optional(),
  privacyNoticeApprovedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  gmailWebhookReleased: z.boolean(),
  gmailOauthReleased: z.boolean(),
  assistantReleased: z.boolean(),
  unsubscribeReleased: z.boolean(),
  supabaseUrl: z.url().optional(),
  supabasePublishableKey: z.string().min(20).optional(),
  organizationId: z.uuid().optional(),
  prequoteIngestSecret: z.string().min(32).optional(),
  pdfSigningSecret: z.string().min(32).optional(),
  gmailIngestSecret: z.string().min(32).optional(),
  unsubscribeSigningSecret: z.string().min(32).optional(),
  unsubscribeIngestSecret: z.string().min(32).optional(),
  gmailPubSubAudience: z.url().optional(),
  gmailPubSubServiceAccount: z.email().optional(),
  gmailPubSubSubscription: z.string().min(3).max(512).optional(),
  googleOauthClientId: z.string().min(20).optional(),
  googleOauthClientSecret: z.string().min(20).optional(),
  googleOauthRedirectUri: z.url().optional(),
  googleKmsKeyName: z.string().regex(/^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+$/u).optional(),
  gmailOauthStateSecret: z.string().min(32).optional(),
  gmailOauthCompletionSecret: z.string().min(32).optional(),
  dispatchReleased: z.boolean(),
  dispatchMode: z.enum(["shadow", "live"]),
  dispatchSecret: z.string().min(32).optional(),
  cronSecret: z.string().min(32).optional(),
  telegramBotToken: z.string().min(20).optional(),
  telegramChatId: z.string().min(3).optional(),
  directLaneReleased: z.boolean(),
  directLaneMode: z.enum(["shadow", "live"]),
  directLaneVaultKey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/u).optional(),
});

export type RuntimeConfig = z.infer<typeof runtimeSchema>;

type RuntimeEnvironment = Record<string, string | undefined>;

export const PUBLIC_SURFACE_ORIGIN = "https://diagnostico.ennco.com.mx";

function envBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true";
}

function explicitReleaseBoolean(value: string | undefined): boolean {
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new Error("PUBLIC_SURFACE_RELEASE_FLAG_INVALID");
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
    requireMfa: envBoolean(environment.ENNCO_REQUIRE_MFA, false),
    externalSendAllowed: envBoolean(environment.ENNCO_ALLOW_EXTERNAL_SEND, false),
    globalKillSwitch: envBoolean(environment.ENNCO_GLOBAL_KILL_SWITCH, true),
    publicSurfaceReleased: explicitReleaseBoolean(environment.ENNCO_PUBLIC_SURFACE_RELEASED),
    publicSurfaceReleasedAt: environment.ENNCO_PUBLIC_SURFACE_RELEASED_AT || undefined,
    privacyNoticeApproved: envBoolean(environment.ENNCO_PRIVACY_NOTICE_APPROVED, false),
    privacyNoticeApprovedVersion: environment.ENNCO_PRIVACY_NOTICE_APPROVED_VERSION || undefined,
    privacyNoticeApprovedSha256: environment.ENNCO_PRIVACY_NOTICE_APPROVED_SHA256 || undefined,
    gmailWebhookReleased: envBoolean(environment.ENNCO_GMAIL_WEBHOOK_RELEASED, false),
    gmailOauthReleased: envBoolean(environment.ENNCO_GMAIL_OAUTH_RELEASED, false),
    assistantReleased: envBoolean(environment.ENNCO_ASSISTANT_RELEASED, false),
    unsubscribeReleased: envBoolean(environment.ENNCO_UNSUBSCRIBE_RELEASED, false),
    supabaseUrl: environment.NEXT_PUBLIC_SUPABASE_URL || undefined,
    supabasePublishableKey:
      environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      environment.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      undefined,
    organizationId: environment.NEXT_PUBLIC_ENNCO_ORGANIZATION_ID || undefined,
    prequoteIngestSecret: environment.ENNCO_PREQUOTE_INGEST_SECRET || undefined,
    pdfSigningSecret: environment.ENNCO_PDF_SIGNING_SECRET || undefined,
    gmailIngestSecret: environment.ENNCO_GMAIL_INGEST_SECRET || undefined,
    unsubscribeSigningSecret: environment.ENNCO_UNSUBSCRIBE_SIGNING_SECRET || undefined,
    unsubscribeIngestSecret: environment.ENNCO_UNSUBSCRIBE_INGEST_SECRET || undefined,
    gmailPubSubAudience: environment.GMAIL_PUBSUB_AUDIENCE || undefined,
    gmailPubSubServiceAccount: environment.GMAIL_PUBSUB_SERVICE_ACCOUNT || undefined,
    gmailPubSubSubscription: environment.GMAIL_PUBSUB_SUBSCRIPTION || undefined,
    googleOauthClientId: environment.GOOGLE_OAUTH_CLIENT_ID || undefined,
    googleOauthClientSecret: environment.GOOGLE_OAUTH_CLIENT_SECRET || undefined,
    googleOauthRedirectUri: environment.GOOGLE_OAUTH_REDIRECT_URI || undefined,
    googleKmsKeyName: environment.GOOGLE_KMS_KEY_NAME || undefined,
    gmailOauthStateSecret: environment.ENNCO_GMAIL_OAUTH_STATE_SECRET || undefined,
    gmailOauthCompletionSecret: environment.ENNCO_GMAIL_OAUTH_COMPLETION_SECRET || undefined,
    dispatchReleased: envBoolean(environment.ENNCO_DISPATCH_RELEASED, false),
    dispatchMode: environment.ENNCO_DISPATCH_MODE === "live" ? "live" : "shadow",
    dispatchSecret: environment.ENNCO_DISPATCH_SECRET || undefined,
    cronSecret: environment.CRON_SECRET || undefined,
    telegramBotToken: environment.TELEGRAM_BOT_TOKEN || undefined,
    telegramChatId: environment.TELEGRAM_CHAT_ID || undefined,
    directLaneReleased: envBoolean(environment.ENNCO_DIRECT_LANE_RELEASED, false),
    directLaneMode: environment.ENNCO_DIRECT_LANE_MODE === "live" ? "live" : "shadow",
    directLaneVaultKey: environment.ENNCO_DIRECT_LANE_VAULT_KEY || undefined,
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
  if (config.appEnv === "production" && (!config.prequoteIngestSecret || !config.pdfSigningSecret)) {
    throw new Error("PREQUOTE_SERVER_SECRETS_REQUIRED_IN_PRODUCTION");
  }
  if (
    config.privacyNoticeApproved
    && (
      config.privacyNoticeApprovedVersion !== PRIVACY_NOTICE_VERSION
      || config.privacyNoticeApprovedSha256 !== PRIVACY_NOTICE_CONTENT_SHA256
    )
  ) {
    throw new Error("PRIVACY_NOTICE_APPROVAL_VERSION_MISMATCH");
  }
  const publicUrl = new URL(config.appUrl);
  const releaseTimestamp = config.publicSurfaceReleasedAt
    ? Date.parse(config.publicSurfaceReleasedAt)
    : Number.NaN;
  if (
    config.publicSurfaceReleased
    && (
      config.appEnv !== "production"
      || config.demoMode
      || !config.privacyNoticeApproved
      || !config.publicSurfaceReleasedAt
      || !environment.NEXT_PUBLIC_APP_URL
      || publicUrl.protocol !== "https:"
      || publicUrl.origin !== PUBLIC_SURFACE_ORIGIN
      || publicUrl.pathname !== "/"
      || Boolean(publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password)
      || !Number.isFinite(releaseTimestamp)
      || releaseTimestamp > Date.now() + 5 * 60 * 1000
    )
  ) {
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
  if (config.gmailOauthReleased) {
    const expectedRedirect = new URL("/api/v1/operations/infrastructure/gmail/oauth/callback", config.appUrl);
    if (
      config.demoMode
      || configuredCount !== configuredValues.length
      || !config.googleOauthClientId
      || !config.googleOauthClientSecret
      || !config.googleOauthRedirectUri
      || !config.googleKmsKeyName
      || !config.gmailOauthStateSecret
      || !config.gmailOauthCompletionSecret
      || new URL(config.googleOauthRedirectUri).toString() !== expectedRedirect.toString()
      || expectedRedirect.protocol !== "https:"
    ) {
      throw new Error("GMAIL_OAUTH_RELEASE_GATES_INCOMPLETE");
    }
  }
  if (
    config.assistantReleased
    && (config.demoMode || !config.privacyNoticeApproved || configuredCount !== configuredValues.length)
  ) {
    throw new Error("ASSISTANT_RELEASE_GATES_INCOMPLETE");
  }
  if (
    config.unsubscribeReleased
    && (config.demoMode || !config.unsubscribeSigningSecret || !config.unsubscribeIngestSecret || configuredCount !== configuredValues.length)
  ) {
    throw new Error("UNSUBSCRIBE_RELEASE_GATES_INCOMPLETE");
  }
  if (config.externalSendAllowed && !config.unsubscribeReleased) {
    throw new Error("EXTERNAL_SEND_REQUIRES_UNSUBSCRIBE");
  }
  if (
    config.dispatchReleased
    && (
      config.demoMode
      || configuredCount !== configuredValues.length
      || !config.dispatchSecret
      || !config.cronSecret
    )
  ) {
    throw new Error("DISPATCH_RELEASE_GATES_INCOMPLETE");
  }
  if (
    config.dispatchReleased
    && config.dispatchMode === "live"
    && (!config.gmailOauthReleased || !config.gmailWebhookReleased || !config.unsubscribeReleased)
  ) {
    throw new Error("DISPATCH_LIVE_REQUIRES_GMAIL_AND_UNSUBSCRIBE_RELEASES");
  }

  // Carril directo (M041). Liberarlo exige Supabase dedicado y los mismos
  // secretos del motor (dispatch + cron). Ponerlo en live exige además la llave
  // de la bóveda y el cliente OAuth de Google; sin ellos el cron responde HOLD
  // y ningún buzón puede conectarse.
  if (
    config.directLaneReleased
    && (config.demoMode || configuredCount !== configuredValues.length || !config.dispatchSecret || !config.cronSecret)
  ) {
    throw new Error("DIRECT_LANE_RELEASE_GATES_INCOMPLETE");
  }
  if (
    config.directLaneReleased
    && config.directLaneMode === "live"
    && (!config.directLaneVaultKey || !config.googleOauthClientId || !config.googleOauthClientSecret || !config.googleOauthRedirectUri)
  ) {
    throw new Error("DIRECT_LANE_LIVE_REQUIRES_VAULT_AND_OAUTH_CLIENT");
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
