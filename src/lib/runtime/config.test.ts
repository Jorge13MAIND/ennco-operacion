import { describe, expect, it } from "vitest";
import { getRuntimeConfig, hasDedicatedSupabase } from "@/lib/runtime/config";

const dedicated = {
  NEXT_PUBLIC_SUPABASE_URL: "https://ennco.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_ennco_test_only",
  NEXT_PUBLIC_ENNCO_ORGANIZATION_ID: "11111111-1111-4111-8111-111111111111",
};

const prequoteSecrets = {
  ENNCO_PREQUOTE_INGEST_SECRET: "synthetic-ingest-secret-at-least-32-characters",
  ENNCO_PDF_SIGNING_SECRET: "synthetic-pdf-secret-at-least-32-characters",
};

describe("runtime configuration", () => {
  it("keeps local synthetic mode fail closed for external actions", () => {
    const config = getRuntimeConfig({});

    expect(config).toMatchObject({
      appEnv: "development",
      demoMode: true,
      requireMfa: false,
      externalSendAllowed: false,
      globalKillSwitch: true,
      publicSurfaceReleased: false,
      privacyNoticeApproved: false,
      gmailWebhookReleased: false,
      assistantReleased: false,
    });
    expect(hasDedicatedSupabase(config)).toBe(false);
  });

  it("rejects partially configured identity infrastructure", () => {
    expect(() =>
      getRuntimeConfig({
        NEXT_PUBLIC_SUPABASE_URL: dedicated.NEXT_PUBLIC_SUPABASE_URL,
      }),
    ).toThrow("INCOMPLETE_DEDICATED_SUPABASE_CONFIGURATION");
  });

  it("requires dedicated identity infrastructure outside demo mode", () => {
    expect(() => getRuntimeConfig({ ENNCO_DEMO_MODE: "false" })).toThrow(
      "DEDICATED_SUPABASE_REQUIRED_OUTSIDE_DEMO",
    );
  });

  it("accepts a complete dedicated configuration without a service role key", () => {
    const config = getRuntimeConfig({
      ...dedicated,
      ENNCO_DEMO_MODE: "false",
    });

    expect(hasDedicatedSupabase(config)).toBe(true);
  });

  it("forbids demo mode or disabled MFA in production", () => {
    expect(() =>
      getRuntimeConfig({
        NEXT_PUBLIC_APP_ENV: "production",
        ENNCO_DEMO_MODE: "true",
      }),
    ).toThrow("DEMO_MODE_FORBIDDEN_IN_PRODUCTION");

    expect(() =>
      getRuntimeConfig({
        ...dedicated,
        NEXT_PUBLIC_APP_ENV: "production",
        ENNCO_DEMO_MODE: "false",
        ENNCO_REQUIRE_MFA: "false",
      }),
    ).toThrow("MFA_REQUIRED_IN_PRODUCTION");
  });

  it("requires both server-only prequote secrets in production", () => {
    expect(() =>
      getRuntimeConfig({
        ...dedicated,
        NEXT_PUBLIC_APP_ENV: "production",
        ENNCO_DEMO_MODE: "false",
        ENNCO_REQUIRE_MFA: "true",
      }),
    ).toThrow("PREQUOTE_SERVER_SECRETS_REQUIRED_IN_PRODUCTION");

    const config = getRuntimeConfig({
      ...dedicated,
      ...prequoteSecrets,
      NEXT_PUBLIC_APP_ENV: "production",
      ENNCO_DEMO_MODE: "false",
      ENNCO_REQUIRE_MFA: "true",
    });
    expect(config.pdfSigningSecret).toBe(prequoteSecrets.ENNCO_PDF_SIGNING_SECRET);
  });

  it("keeps the public surface closed until demo is off and privacy is approved", () => {
    expect(() =>
      getRuntimeConfig({
        ...dedicated,
        ...prequoteSecrets,
        NEXT_PUBLIC_APP_ENV: "production",
        ENNCO_DEMO_MODE: "false",
        ENNCO_REQUIRE_MFA: "true",
        ENNCO_PUBLIC_SURFACE_RELEASED: "true",
      }),
    ).toThrow("PUBLIC_SURFACE_RELEASE_GATES_INCOMPLETE");
  });

  it("keeps Gmail push closed until every identity and persistence gate exists", () => {
    expect(() =>
      getRuntimeConfig({
        ...dedicated,
        ...prequoteSecrets,
        NEXT_PUBLIC_APP_ENV: "production",
        ENNCO_DEMO_MODE: "false",
        ENNCO_REQUIRE_MFA: "true",
        ENNCO_GMAIL_WEBHOOK_RELEASED: "true",
      }),
    ).toThrow("GMAIL_WEBHOOK_RELEASE_GATES_INCOMPLETE");

    const config = getRuntimeConfig({
      ...dedicated,
      ...prequoteSecrets,
      NEXT_PUBLIC_APP_ENV: "production",
      ENNCO_DEMO_MODE: "false",
      ENNCO_REQUIRE_MFA: "true",
      ENNCO_GMAIL_WEBHOOK_RELEASED: "true",
      ENNCO_GMAIL_INGEST_SECRET: "synthetic-gmail-secret-at-least-32-characters",
      GMAIL_PUBSUB_AUDIENCE: "https://operacion.ennco.com.mx/api/v1/webhooks/gmail",
      GMAIL_PUBSUB_SERVICE_ACCOUNT: "pubsub@ennco.invalid",
      GMAIL_PUBSUB_SUBSCRIPTION: "projects/ennco/subscriptions/gmail",
    });
    expect(config.gmailWebhookReleased).toBe(true);
  });

  it("keeps the assistant closed until privacy and dedicated infrastructure are ready", () => {
    expect(() =>
      getRuntimeConfig({
        ...dedicated,
        ENNCO_DEMO_MODE: "false",
        ENNCO_ASSISTANT_RELEASED: "true",
      }),
    ).toThrow("ASSISTANT_RELEASE_GATES_INCOMPLETE");

    const config = getRuntimeConfig({
      ...dedicated,
      ENNCO_DEMO_MODE: "false",
      ENNCO_PRIVACY_NOTICE_APPROVED: "true",
      ENNCO_ASSISTANT_RELEASED: "true",
    });
    expect(config.assistantReleased).toBe(true);
  });

  it("infers production from the deployment platform and rejects a platform downgrade", () => {
    expect(() => getRuntimeConfig({ VERCEL_ENV: "production" })).toThrow(
      "DEDICATED_SUPABASE_REQUIRED_OUTSIDE_DEMO",
    );
    expect(() =>
      getRuntimeConfig({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_APP_ENV: "development",
      }),
    ).toThrow("APP_ENV_PLATFORM_MISMATCH");
  });
});
