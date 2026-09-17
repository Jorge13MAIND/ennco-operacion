import { api, body, context, ProjectApiError } from "@/lib/solar/api";
import { saveItem, itemSchema } from "@/lib/precios/server";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return api(async () => {
    const c = await context(request);
    const payload = itemSchema.parse(await body(request));
    try { return { item: await saveItem(c, payload) }; } catch (e) {
      const code = e instanceof Error ? e.message : "SOLAR_STORAGE_UNAVAILABLE";
      throw new ProjectApiError(code, code === "SOLAR_FORBIDDEN" ? 403 : code.includes("NOT_FOUND") ? 404 : 503);
    }
  });
}
