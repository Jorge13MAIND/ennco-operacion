import { api, context } from "@/lib/solar/api";
import { loadSolarCatalog } from "@/lib/solar/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return api(async () => loadSolarCatalog(await context()));
}
