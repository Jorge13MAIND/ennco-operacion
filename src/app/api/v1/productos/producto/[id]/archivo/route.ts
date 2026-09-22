import { z } from "zod";

import { api, context, ProjectApiError } from "@/lib/solar/api";
import { uploadProductFile } from "@/lib/productos/server";
export const dynamic = "force-dynamic";
/** Sube la foto (PNG/JPG/WebP, 5 MB) o la ficha técnica (PDF, 10 MB) de un producto. Cuerpo multipart: kind + file. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const access = await context(request);
    const { id } = await params;
    if (Number(request.headers.get("content-length") ?? 0) > 11 * 1024 * 1024) throw new ProjectApiError("PRODUCT_FILE_TOO_LARGE", 413);
    const form = await request.formData().catch(() => { throw new ProjectApiError("PRODUCT_FORM_INVALID", 400); });
    const kind = z.enum(["photo", "datasheet"]).parse(form.get("kind"));
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ProjectApiError("PRODUCT_FILE_REQUIRED", 400);
    return { product: await uploadProductFile(access, z.uuid().parse(id), kind, file) };
  });
}
