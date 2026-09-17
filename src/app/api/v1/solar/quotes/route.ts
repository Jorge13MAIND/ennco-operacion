import { api, body, context, ProjectApiError } from "@/lib/solar/api";
import { quoteSaveSchema } from "@/lib/solar/schema";
import { listQuotes, saveQuote } from "@/lib/solar/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return api(async () => ({ quotes: await listQuotes(await context()) }));
}

export async function POST(request: Request) {
  return api(async () => {
    const c = await context(request);
    const payload = quoteSaveSchema.parse(await body(request));
    try {
      return { quote: await saveQuote(c, payload) };
    } catch (e) {
      const code = e instanceof Error ? e.message : "SOLAR_STORAGE_UNAVAILABLE";
      throw new ProjectApiError(code, code === "SOLAR_FORBIDDEN" ? 403 : code === "SOLAR_QUOTE_VERSION_CONFLICT" ? 409 : code === "SOLAR_QUOTE_NOT_FOUND" ? 404 : code === "SOLAR_INPUT_NOT_FOUND" ? 422 : 503);
    }
  });
}
