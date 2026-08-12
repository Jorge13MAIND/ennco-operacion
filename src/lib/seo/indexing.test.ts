import { describe, expect, it } from "vitest";

import { PRIVACY_NOTICE_CONTENT_SHA256 } from "@/lib/privacy/notice";
import { getRuntimeConfig } from "@/lib/runtime/config";
import {
  buildPublicMetadata,
  buildRobots,
  buildSitemap,
  NEVER_INDEX_ROUTE_PREFIXES,
  PUBLIC_INDEXABLE_ROUTES,
} from "@/lib/seo/indexing";

const dedicated = {
  NEXT_PUBLIC_SUPABASE_URL: "https://ennco.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_ennco_test_only",
  NEXT_PUBLIC_ENNCO_ORGANIZATION_ID: "11111111-1111-4111-8111-111111111111",
  ENNCO_PREQUOTE_INGEST_SECRET: "synthetic-ingest-secret-at-least-32-characters",
  ENNCO_PDF_SIGNING_SECRET: "synthetic-pdf-secret-at-least-32-characters",
};

function releasedConfig() {
  return getRuntimeConfig({
    ...dedicated,
    NEXT_PUBLIC_APP_ENV: "production",
    NEXT_PUBLIC_APP_URL: "https://diagnostico.ennco.com.mx",
    ENNCO_DEMO_MODE: "false",
    ENNCO_REQUIRE_MFA: "true",
    ENNCO_PRIVACY_NOTICE_APPROVED: "true",
    ENNCO_PRIVACY_NOTICE_APPROVED_VERSION: "2026-08-11-v1",
    ENNCO_PRIVACY_NOTICE_APPROVED_SHA256: PRIVACY_NOTICE_CONTENT_SHA256,
    ENNCO_PUBLIC_SURFACE_RELEASED: "true",
    ENNCO_PUBLIC_SURFACE_RELEASED_AT: "2026-08-11T09:00:00-06:00",
  });
}

describe("public indexing release", () => {
  it("keeps metadata, robots and sitemap closed by default", () => {
    const config = getRuntimeConfig({});
    const metadata = buildPublicMetadata(config, {
      route: "/diagnostico",
      title: "Diagnóstico industrial | ENNCO",
      description: "Referencia preliminar.",
    });

    expect(metadata.robots).toMatchObject({ index: false, follow: false, noarchive: true });
    expect(metadata.alternates?.canonical?.toString()).toBe("http://localhost:3000/diagnostico");
    expect(buildRobots(config)).toEqual({ rules: { userAgent: "*", disallow: "/" } });
    expect(buildSitemap(config)).toEqual([]);
  });

  it("releases only the explicit public route allowlist", () => {
    const config = releasedConfig();
    const metadata = buildPublicMetadata(config, {
      route: "/privacidad",
      title: "Aviso de privacidad | ENNCO",
      description: "Información de privacidad.",
    });

    expect(metadata.robots).toMatchObject({ index: true, follow: true });
    expect(metadata.alternates?.canonical?.toString()).toBe("https://diagnostico.ennco.com.mx/privacidad");
    expect(buildRobots(config)).toEqual({
      rules: {
        userAgent: "*",
        allow: [...PUBLIC_INDEXABLE_ROUTES],
        disallow: ["/", ...NEVER_INDEX_ROUTE_PREFIXES],
      },
      sitemap: "https://diagnostico.ennco.com.mx/sitemap.xml",
      host: "https://diagnostico.ennco.com.mx",
    });
  });

  it("derives every sitemap date from the validated release timestamp", () => {
    const sitemap = buildSitemap(releasedConfig());

    expect(sitemap).toHaveLength(2);
    expect(sitemap.map((entry) => new URL(entry.url).pathname)).toEqual(PUBLIC_INDEXABLE_ROUTES);
    expect(new Set(sitemap.map((entry) => entry.lastModified))).toEqual(
      new Set(["2026-08-11T09:00:00-06:00"]),
    );
    expect(sitemap.some((entry) => /api|ingreso|operacion/.test(entry.url))).toBe(false);
  });
});
