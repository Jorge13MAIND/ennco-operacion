import { z } from "zod";

import { api, body, context } from "@/lib/solar/api";
import { setProductFavorite } from "@/lib/productos/server";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const access = await context(request);
    const { id } = await params;
    const input = z.object({ favorite: z.boolean() }).parse(await body(request));
    return { product: await setProductFavorite(access, z.uuid().parse(id), input.favorite) };
  });
}
