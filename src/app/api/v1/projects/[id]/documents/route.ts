import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  api,
  context,
  key,
  bundleFor,
  detail,
  append,
  hash,
  ProjectApiError,
} from "@/lib/projects/server";
import { DOCUMENT_SECTIONS } from "@/lib/projects/types";
import { canAppendRecord } from "@/lib/projects/permissions";
import {
  extractReceipt,
  validateDocumentBytes,
} from "@/lib/projects/extraction";
import { PROJECT_DOCUMENT_BUCKET } from "@/lib/projects/document-service";
const meta = z.object({
  section: z.enum(DOCUMENT_SECTIONS),
  visibility: z.enum(["TEAM", "ADMIN", "PURCHASES"]),
  revisionId: z.uuid().optional(),
  expectedVersion: z.coerce.number().int().positive(),
});
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return api(async () => {
    const c = await context(request),
      id = (await params).id,
      k = key(request);
    if (Number(request.headers.get("content-length") ?? 0) > 4.25 * 1024 * 1024)
      throw new ProjectApiError("PROJECT_DOCUMENT_SIZE_INVALID", 413);
    const form = await request.formData(),
      file = form.get("file");
    if (!(file instanceof File) || file.size > 4 * 1024 * 1024)
      throw new ProjectApiError("PROJECT_DOCUMENT_SIZE_INVALID", 413);
    const v = meta.parse({
      section: form.get("section"),
      visibility: form.get("visibility"),
      expectedVersion: form.get("expectedVersion"),
      revisionId: form.get("revisionId") || undefined,
    });
    const b = await bundleFor(c, id);
    if (!canAppendRecord(b.permissions, "document", v))
      throw new ProjectApiError("PROJECT_FORBIDDEN", 403);
    if (v.revisionId && !b.records.some((r) => r.id === v.revisionId))
      throw new ProjectApiError("PROJECT_REVISION_NOT_FOUND", 404);
    const bytes = new Uint8Array(await file.arrayBuffer());
    validateDocumentBytes(bytes, file.type);
    const sha256 = hash(bytes),
      storagePath = `${b.project.organizationId}/${id}/${v.visibility}/${k}`;
    if (c.evidenceClass === "live") {
      const client = await createSupabaseServerClient();
      const uploaded = await client.storage
        .from(PROJECT_DOCUMENT_BUCKET)
        .upload(storagePath, bytes, { contentType: file.type, upsert: false });
      if (uploaded.error) {
        const existing = await client.storage
          .from(PROJECT_DOCUMENT_BUCKET)
          .download(storagePath);
        if (
          !existing.data ||
          hash(new Uint8Array(await existing.data.arrayBuffer())) !== sha256
        )
          throw new ProjectApiError("PROJECT_DOCUMENT_STORAGE_FAILED");
      }
    }
    const doc = {
      name: file.name.replace(/[\x00-\x1f/\\]/g, "_").slice(0, 200),
      section: v.section,
      visibility: v.visibility,
      mimeType: file.type,
      size: bytes.length,
      sha256,
      status: "PENDING",
      storagePath,
      ...(v.revisionId ? { revisionId: v.revisionId } : {}),
    };
    const saved = await append(
      c,
      id,
      v.expectedVersion,
      "document",
      doc,
      k,
      true,
    );
    const extraction =
      v.section === "Información del cliente"
        ? await extractReceipt(bytes, file.type)
        : null;
    return {
      ...detail(c, saved),
      document: saved.records.findLast(
        (r) => r.kind === "document" && r.data.sha256 === sha256,
      ),
      extraction,
    };
  });
}
