import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  context,
  bundleFor,
  apiError,
  headers,
  ProjectApiError,
} from "@/lib/projects/server";
import { PROJECT_DOCUMENT_BUCKET } from "@/lib/projects/document-service";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string; documentId: string }> },
) {
  try {
    const c = await context(),
      { id, documentId } = await params,
      b = await bundleFor(c, id),
      doc = b.records.find((r) => r.id === documentId && r.kind === "document");
    if (!doc?.data.storagePath)
      throw new ProjectApiError("PROJECT_DOCUMENT_NOT_FOUND", 404);
    if (c.evidenceClass !== "live")
      throw new ProjectApiError("PROJECT_DOCUMENT_DEMO_UNAVAILABLE", 409);
    const client = await createSupabaseServerClient();
    const { data, error } = await client.storage
      .from(PROJECT_DOCUMENT_BUCKET)
      .download(String(doc.data.storagePath));
    if (error || !data)
      throw new ProjectApiError("PROJECT_DOCUMENT_NOT_FOUND", 404);
    return new Response(data, {
      headers: {
        ...headers,
        "Content-Type": String(doc.data.mimeType),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(String(doc.data.name))}`,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
