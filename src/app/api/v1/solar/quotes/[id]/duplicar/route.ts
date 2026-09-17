import { api, context, ProjectApiError } from "@/lib/projects/server";
import { duplicateQuote } from "@/lib/solar/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const c = await context(request);
    try {
      return { quote: await duplicateQuote(c, (await params).id) };
    } catch (e) {
      const code = e instanceof Error ? e.message : "SOLAR_STORAGE_UNAVAILABLE";
      throw new ProjectApiError(code, code === "SOLAR_FORBIDDEN" ? 403 : code === "SOLAR_QUOTE_NOT_FOUND" ? 404 : code === "SOLAR_INPUT_NOT_FOUND" ? 422 : 503);
    }
  });
}
