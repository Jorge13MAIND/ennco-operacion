import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { OperationsAccessContext } from "@/lib/auth/authorization";
import { saveCatalog } from "./repository";
import { append, bundleFor, catalogs, hash, ProjectApiError } from "./server";
import {
  allocateDriveIds,
  driveConfigured,
  driveTransport,
  ensureDriveTree,
  uploadDriveDocument,
  DRIVE_OWNER,
  type DrivePlan,
} from "./drive";
import {
  DOCUMENT_SECTIONS,
  type DocumentSection,
  type JsonRecord,
  type ProjectBundle,
} from "./types";
export const PROJECT_DOCUMENT_BUCKET = "ennco-project-documents";
export async function syncProjectDrive(
  c: OperationsAccessContext,
  initial: ProjectBundle,
  operationKey: string,
) {
  if (c.evidenceClass !== "live")
    throw new ProjectApiError("PROJECT_DRIVE_DEMO_DISABLED", 409);
  if (!driveConfigured())
    throw new ProjectApiError("PROJECT_DRIVE_NOT_CONFIGURED", 503);
  if (!initial.permissions.canConfirmPayments)
    throw new ProjectApiError("PROJECT_DRIVE_SETUP_ADMIN_REQUIRED", 403);
  const t = await driveTransport();
  let b = initial;
  let planRecord = b.records.find((r) => r.kind === "drive_setup");
  if (!planRecord) {
    let root = (await catalogs(c)).find(
      (e) => e.category === "drive_root" && e.name === "Proyectos ENNCO",
    );
    if (!root) {
      const ids = await allocateDriveIds(t, 1);
      try {
        root = await saveCatalog(
          c,
          {
            category: "drive_root",
            name: "Proyectos ENNCO",
            version: 1,
            data: { folderId: ids[0], ownerEmail: DRIVE_OWNER },
            sourceUrl:
              "https://developers.google.com/workspace/drive/api/guides/folder",
            sourceDate: new Date().toISOString().slice(0, 10),
            status: "DRAFT",
          },
          hash(`${c.organizationId}:drive-root-v1`),
        );
      } catch {
        root = (await catalogs(c)).find(
          (e) => e.category === "drive_root" && e.name === "Proyectos ENNCO",
        );
        if (!root)
          throw new ProjectApiError("PROJECT_DRIVE_ROOT_RESERVATION_FAILED");
      }
    }
    const ids = await allocateDriveIds(t, 9);
    const plan: DrivePlan = {
      ownerEmail: DRIVE_OWNER,
      rootId: String(root.data.folderId),
      folderId: ids[0]!,
      sections: Object.fromEntries(
        DOCUMENT_SECTIONS.map((section, index) => [section, ids[index + 1]!]),
      ),
    };
    try {
      b = await append(
        c,
        b.project.id,
        b.project.version,
        "drive_setup",
        plan as unknown as JsonRecord,
        hash(`${operationKey}:folders`),
        true,
      );
    } catch (e) {
      b = await bundleFor(c, b.project.id);
      if (!b.records.some((r) => r.kind === "drive_setup")) throw e;
    }
    planRecord = b.records.find((r) => r.kind === "drive_setup");
  }
  if (!planRecord) throw new ProjectApiError("PROJECT_DRIVE_PLAN_INCOMPLETE");
  const plan = planRecord.data as unknown as DrivePlan;
  const url = await ensureDriveTree(
    t,
    plan,
    b.project.organizationId,
    b.project.id,
    b.project.folio,
  );
  const client = await createSupabaseServerClient();
  const superseded = new Set(
    b.records
      .filter((r) => r.kind === "document")
      .map((r) => r.data.supersedes),
  );
  for (let doc of b.records.filter(
    (r) =>
      r.kind === "document" &&
      r.data.status !== "SYNCED" &&
      !superseded.has(r.id),
  )) {
    const storagePath = String(doc.data.storagePath ?? "");
    if (!storagePath) continue;
    if (!doc.data.driveFileId) {
      const ids = await allocateDriveIds(t, 1);
      b = await append(
        c,
        b.project.id,
        b.project.version,
        "document",
        {
          ...doc.data,
          driveFileId: ids[0],
          supersedes: doc.id,
          status: "PENDING",
        },
        hash(`${doc.id}:drive-reserve`),
        true,
      );
      doc = b.records.find(
        (r) =>
          r.kind === "document" &&
          r.data.driveFileId === ids[0] &&
          r.data.supersedes === doc.id,
      )!;
    }
    const downloaded = await client.storage
      .from(PROJECT_DOCUMENT_BUCKET)
      .download(storagePath);
    if (downloaded.error || !downloaded.data)
      throw new ProjectApiError("PROJECT_DOCUMENT_DOWNLOAD_FAILED");
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    if (hash(bytes) !== doc.data.sha256)
      throw new ProjectApiError("PROJECT_DOCUMENT_INTEGRITY_FAILED");
    const section = doc.data.section as DocumentSection;
    const uploaded = await uploadDriveDocument(t, {
      id: String(doc.data.driveFileId),
      projectId: b.project.id,
      name: String(doc.data.name),
      section,
      parentId: plan.sections[section]!,
      sha256: String(doc.data.sha256),
      bytes,
      mimeType: String(doc.data.mimeType),
    });
    b = await append(
      c,
      b.project.id,
      b.project.version,
      "document",
      {
        ...doc.data,
        driveFileId: uploaded.id,
        driveUrl: uploaded.url,
        status: "SYNCED",
        supersedes: doc.id,
      },
      hash(`${doc.id}:drive-synced`),
      true,
    );
  }
  return { bundle: b, drive: { url, status: "SYNCED" as const } };
}
