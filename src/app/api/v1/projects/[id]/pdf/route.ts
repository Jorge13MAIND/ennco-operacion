import { z } from "zod";
import { context, bundleFor, apiError, headers } from "@/lib/projects/server";
import { generateProjectPdf } from "@/lib/projects/documents";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const c = await context(),
      b = await bundleFor(c, (await params).id),
      url = new URL(request.url),
      kind = z
        .enum(["proposal", "technical", "financial", "contract"])
        .parse(url.searchParams.get("kind")),
      revision = z
        .uuid()
        .optional()
        .parse(url.searchParams.get("revision") ?? undefined),
      bytes = await generateProjectPdf(b, kind, revision);
    return new Response(Uint8Array.from(bytes), {
      headers: {
        ...headers,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${b.project.folio}-${kind}.pdf"`,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
