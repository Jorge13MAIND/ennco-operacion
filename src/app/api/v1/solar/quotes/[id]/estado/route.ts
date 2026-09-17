import { z } from "zod";

import { api, body, context, ProjectApiError } from "@/lib/projects/server";
import { setQuoteStatus } from "@/lib/solar/server";

export const dynamic = "force-dynamic";

const schema = z.object({ status: z.enum(["DRAFT", "SENT", "ACCEPTED", "ARCHIVED"]) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const c = await context(request);
    const { status } = schema.parse(await body(request));
    try {
      return { quote: await setQuoteStatus(c, (await params).id, status) };
    } catch (e) {
      const code = e instanceof Error ? e.message : "SOLAR_STORAGE_UNAVAILABLE";
      throw new ProjectApiError(code, code === "SOLAR_FORBIDDEN" ? 403 : code === "SOLAR_QUOTE_NOT_FOUND" ? 404 : 503);
    }
  });
}
