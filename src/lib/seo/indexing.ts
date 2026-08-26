import type { Metadata, MetadataRoute } from "next";

import { PUBLIC_SURFACE_ORIGIN, type RuntimeConfig } from "@/lib/runtime/config";

export const PUBLIC_INDEXABLE_ROUTES = ["/", "/diagnostico", "/privacidad"] as const;
export const NEVER_INDEX_ROUTE_PREFIXES = ["/api", "/ingreso", "/operacion"] as const;

export type PublicIndexableRoute = (typeof PUBLIC_INDEXABLE_ROUTES)[number];

export const PRIVATE_ROBOTS: NonNullable<Metadata["robots"]> = {
  index: false,
  follow: false,
  noarchive: true,
  googleBot: {
    index: false,
    follow: false,
    noimageindex: true,
    noarchive: true,
  },
};

const RELEASED_PUBLIC_ROBOTS: NonNullable<Metadata["robots"]> = {
  index: true,
  follow: true,
  googleBot: {
    index: true,
    follow: true,
  },
};

export function isPublicIndexingReleased(config: RuntimeConfig): boolean {
  return config.appEnv === "production"
    && config.publicSurfaceReleased
    && !config.demoMode
    && config.privacyNoticeApproved
    && new URL(config.appUrl).origin === PUBLIC_SURFACE_ORIGIN
    && new URL(config.appUrl).pathname === "/"
    && Boolean(config.publicSurfaceReleasedAt);
}

export function buildPublicMetadata(
  config: RuntimeConfig,
  input: { route: PublicIndexableRoute; title: string; description: string },
): Metadata {
  return {
    title: input.title,
    description: input.description,
    alternates: {
      canonical: new URL(input.route, config.appUrl),
    },
    robots: isPublicIndexingReleased(config) ? RELEASED_PUBLIC_ROBOTS : PRIVATE_ROBOTS,
  };
}

export function buildRobots(config: RuntimeConfig): MetadataRoute.Robots {
  if (!isPublicIndexingReleased(config)) {
    return {
      rules: {
        userAgent: "*",
        disallow: "/",
      },
    };
  }

  return {
    rules: {
      userAgent: "*",
      allow: [...PUBLIC_INDEXABLE_ROUTES],
      disallow: [...NEVER_INDEX_ROUTE_PREFIXES],
    },
    sitemap: new URL("/sitemap.xml", config.appUrl).toString(),
    host: new URL(config.appUrl).origin,
  };
}

export function buildSitemap(config: RuntimeConfig): MetadataRoute.Sitemap {
  if (!isPublicIndexingReleased(config) || !config.publicSurfaceReleasedAt) return [];

  return PUBLIC_INDEXABLE_ROUTES.map((route) => ({
    url: new URL(route, config.appUrl).toString(),
    lastModified: config.publicSurfaceReleasedAt,
  }));
}
