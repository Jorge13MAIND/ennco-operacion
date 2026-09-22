import { z } from "zod";

import { api, body, context } from "@/lib/solar/api";
import { setProductActive } from "@/lib/productos/server";
export const dynamic = "force-dynamic";
/** Archiva o restaura un producto. Nada se borra: la papelera de la lista solo lo saca de la vista. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const access = await context(request);
    const { id } = await params;
    const input = z.object({ active: z.boolean() }).parse(await body(request));
    return { product: await setProductActive(access, z.uuid().parse(id), input.active) };
  });
}
