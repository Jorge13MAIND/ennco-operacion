import { api, body, context } from "@/lib/projects/server";
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
    return { quote: await saveQuote(c, payload) };
  });
}
