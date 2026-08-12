import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/v1/unsubscribe/route";
import { createUnsubscribeToken } from "@/lib/unsubscribe/token";

const organizationId = "11111111-1111-4111-8111-111111111111";
const enrollmentId = "22222222-2222-4222-8222-222222222222";
const signingSecret = "signing-secret-for-tests-at-least-32-chars";

function releaseEnvironment(): void {
  vi.stubEnv("NEXT_PUBLIC_APP_ENV", "staging");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://diagnostico.example.invalid");
  vi.stubEnv("ENNCO_DEMO_MODE", "false");
  vi.stubEnv("ENNCO_UNSUBSCRIBE_RELEASED", "true");
  vi.stubEnv("ENNCO_UNSUBSCRIBE_SIGNING_SECRET", signingSecret);
  vi.stubEnv("ENNCO_UNSUBSCRIBE_INGEST_SECRET", "ingest-secret-for-tests-at-least-32-characters");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.invalid");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key-for-synthetic-tests");
  vi.stubEnv("NEXT_PUBLIC_ENNCO_ORGANIZATION_ID", organizationId);
}

afterEach(() => vi.unstubAllEnvs());

describe("visible unsubscribe confirmation", () => {
  it("validates the signed token before rendering a private confirmation form", async () => {
    releaseEnvironment();
    const { token } = createUnsubscribeToken({ organizationId, enrollmentId, secret: signingSecret });
    const response = await GET(new Request(`https://diagnostico.example.invalid/api/v1/unsubscribe?token=${encodeURIComponent(token)}`));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(response.headers.get("content-security-policy")).toContain("form-action 'self'");
    expect(html).toContain("Confirmar baja");
    expect(html).toContain("List-Unsubscribe");
  });

  it("does not render a form for a tampered token", async () => {
    releaseEnvironment();
    const response = await GET(new Request("https://diagnostico.example.invalid/api/v1/unsubscribe?token=tampered"));
    const html = await response.text();

    expect(response.status).toBe(400);
    expect(html).toContain("Enlace no disponible");
    expect(html).not.toContain("Confirmar baja");
  });
});
