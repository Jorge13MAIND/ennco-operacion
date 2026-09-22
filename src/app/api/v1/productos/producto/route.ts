import { api, body, context } from "@/lib/solar/api";
import { productSchema, saveProduct } from "@/lib/productos/server";
export const dynamic = "force-dynamic";
/** Crea o actualiza un producto. */
export async function POST(request: Request) {
  return api(async () => {
    const access = await context(request);
    return { product: await saveProduct(access, productSchema.parse(await body(request))) };
  });
}
