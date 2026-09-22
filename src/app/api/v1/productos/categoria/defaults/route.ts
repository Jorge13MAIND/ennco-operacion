import { api, context } from "@/lib/solar/api";
import { seedDefaultCategories } from "@/lib/productos/server";
export const dynamic = "force-dynamic";
/** Repone los diez tipos de SunOne que falten. Idempotente. */
export async function POST(request: Request) {
  return api(async () => ({ result: await seedDefaultCategories(await context(request)) }));
}
