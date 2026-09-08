import { NextResponse } from "next/server";

import { recordDirectLaneOpen } from "@/lib/correos/client";
import { TRANSPARENT_GIF, verifyOpenPixelToken } from "@/lib/correos/open-pixel";
import { getRuntimeConfig } from "@/lib/runtime/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const gifHeaders = {
  "Content-Type": "image/gif",
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  "Content-Length": String(TRANSPARENT_GIF.length),
} as const;

/**
 * Pixel de apertura. Siempre responde el GIF (nunca revela si el token era
 * válido); solo registra cuando la firma es correcta. Cualquier error queda
 * en silencio: un pixel jamás debe romper la lectura del correo.
 */
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const { token } = await context.params;
  const config = getRuntimeConfig();
  const clean = token.replace(/\.gif$/iu, "");
  if (config.dispatchSecret && config.organizationId) {
    const messageId = verifyOpenPixelToken({ token: clean, organizationId: config.organizationId, secret: config.dispatchSecret });
    if (messageId) await recordDirectLaneOpen(config, messageId).catch(() => undefined);
  }
  return new NextResponse(new Uint8Array(TRANSPARENT_GIF), { status: 200, headers: gifHeaders });
}
