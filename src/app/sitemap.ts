import type { MetadataRoute } from "next";

import { getRuntimeConfig } from "@/lib/runtime/config";
import { buildSitemap } from "@/lib/seo/indexing";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function sitemap(): MetadataRoute.Sitemap {
  try {
    return buildSitemap(getRuntimeConfig());
  } catch {
    return [];
  }
}
