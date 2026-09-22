import { api, body, context } from "@/lib/solar/api";
import { categorySchema, saveCategory } from "@/lib/productos/server";
export const dynamic = "force-dynamic";
/** Crea o actualiza un tipo de producto (Paco puede agregar los suyos). */
export async function POST(request: Request) {
  return api(async () => {
    const access = await context(request);
    return { category: await saveCategory(access, categorySchema.parse(await body(request))) };
  });
}
