import { api, context } from "@/lib/solar/api";
import { readProductCatalog } from "@/lib/productos/server";
export const dynamic = "force-dynamic";
export async function GET() { return api(async () => ({ catalog: await readProductCatalog(await context()) })); }
