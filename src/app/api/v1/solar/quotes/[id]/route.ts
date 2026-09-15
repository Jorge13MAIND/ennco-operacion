import { api, context } from "@/lib/projects/server";
import { getQuote } from "@/lib/solar/server";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  return api(async () => ({ quote: await getQuote(await context(), (await params).id) }));
}
