import type { MetadataRoute } from "next";

import { getRuntimeConfig } from "@/lib/runtime/config";
import { buildRobots } from "@/lib/seo/indexing";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function robots(): MetadataRoute.Robots {
  try {
    return buildRobots(getRuntimeConfig());
  } catch {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
}
