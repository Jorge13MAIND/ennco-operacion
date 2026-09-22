import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, context, headers } from "@/lib/solar/api";
import { readProductCatalog, signedProductUrl } from "@/lib/productos/server";
export const dynamic = "force-dynamic";
/** Descarga la ficha técnica: redirige a la URL firmada del bucket privado. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await context();
    const { id } = await params;
    const product = (await readProductCatalog(access)).products.find((p) => p.id === z.uuid().parse(id));
    if (!product?.datasheetPath) return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404, headers });
    return NextResponse.redirect(await signedProductUrl(access, product.datasheetPath), { status: 302, headers });
  } catch (e) { return apiError(e); }
}
