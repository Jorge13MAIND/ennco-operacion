import { api, context } from "@/lib/solar/api";
import { readPriceCatalog } from "@/lib/precios/server";
export const dynamic = "force-dynamic";
export async function GET() { return api(async () => ({ catalog: await readPriceCatalog(await context()) })); }
