import { NextResponse } from "next/server";

import { renderPrequotePdf } from "@/lib/prequote/pdf";
import { verifyPrequotePdfToken } from "@/lib/prequote/pdf-token";
import { getPdfSigningSecret, getRuntimeConfig } from "@/lib/runtime/config";

type RouteContext = { params: Promise<{ folio: string }> };

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const { folio } = await context.params;
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return NextResponse.json(
      { error: "PDF_TOKEN_REQUIRED" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  try {
    const config = getRuntimeConfig();
    const payload = verifyPrequotePdfToken({
      token,
      expectedFolio: folio,
      secret: getPdfSigningSecret(config),
    });
    const bytes = await renderPrequotePdf(payload);
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${folio}.pdf"`,
        "Content-Type": "application/pdf",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "PDF_TOKEN_INVALID_OR_EXPIRED" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
