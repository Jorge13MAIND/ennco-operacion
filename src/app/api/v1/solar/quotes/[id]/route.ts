import { api, context, ProjectApiError } from "@/lib/solar/api";
import { getQuote } from "@/lib/solar/server";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const c = await context();
    try { return { quote: await getQuote(c, (await params).id) }; } catch (e) {
      const code = e instanceof Error ? e.message : "SOLAR_STORAGE_UNAVAILABLE";
      throw new ProjectApiError(code, code === "SOLAR_QUOTE_NOT_FOUND" ? 404 : 503);
    }
  });
}
