import { DOCUMENT_SECTIONS, type DocumentSection } from "./types";
export const DRIVE_OWNER = "contacto@ennco.com.mx";
const api = "https://www.googleapis.com/drive/v3";
export type DrivePlan = {
  ownerEmail: string;
  rootId: string;
  folderId: string;
  sections: Record<string, string>;
};
type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  appProperties?: Record<string, string>;
  owners?: { emailAddress?: string }[];
  permissions?: { type: string; role: string; emailAddress?: string }[];
};
export interface DriveTransport {
  request(path: string, init?: RequestInit): Promise<Response>;
}
export function driveConfigured() {
  return Boolean(
    process.env.ENNCO_DRIVE_CLIENT_ID &&
      process.env.ENNCO_DRIVE_CLIENT_SECRET &&
      process.env.ENNCO_DRIVE_REFRESH_TOKEN,
  );
}
export async function driveTransport(): Promise<DriveTransport> {
  if (!driveConfigured()) throw new Error("PROJECT_DRIVE_NOT_CONFIGURED");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.ENNCO_DRIVE_CLIENT_ID!,
      client_secret: process.env.ENNCO_DRIVE_CLIENT_SECRET!,
      refresh_token: process.env.ENNCO_DRIVE_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error("PROJECT_DRIVE_AUTH_REQUIRED");
  const token = (await res.json()) as { access_token?: string };
  if (!token.access_token) throw new Error("PROJECT_DRIVE_AUTH_REQUIRED");
  const transport: DriveTransport = {
    request: async (path, init = {}) =>
      fetch(path.startsWith("https://") ? path : `${api}${path}`, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${token.access_token}`,
        },
        signal: AbortSignal.timeout(30000),
      }),
  };
  const about = await transport.request("/about?fields=user(emailAddress)");
  if (!about.ok) throw new Error("PROJECT_DRIVE_SCOPE_REQUIRED");
  const user = (await about.json()) as { user?: { emailAddress?: string } };
  if (user.user?.emailAddress?.toLowerCase() !== DRIVE_OWNER)
    throw new Error("PROJECT_DRIVE_OWNER_MISMATCH");
  return transport;
}
export async function allocateDriveIds(
  t: DriveTransport,
  count: number,
): Promise<string[]> {
  const response = await t.request(
    `/files/generateIds?count=${count}&space=drive&type=files`,
  );
  if (!response.ok) throw new Error("PROJECT_DRIVE_RESERVATION_FAILED");
  const value = (await response.json()) as { ids?: string[] };
  if (value.ids?.length !== count)
    throw new Error("PROJECT_DRIVE_RESERVATION_FAILED");
  return value.ids;
}
/** Reject public, domain, group and extra-user ACLs; dashboard permissions remain authoritative. */
export function assertPrivateDriveFile(
  file: DriveFile,
  expected: Record<string, string>,
) {
  if (!file.owners?.some((o) => o.emailAddress?.toLowerCase() === DRIVE_OWNER))
    throw new Error("PROJECT_DRIVE_OWNER_MISMATCH");
  if (
    !file.permissions?.length ||
    file.permissions.some(
      (p) => p.type !== "user" || p.emailAddress?.toLowerCase() !== DRIVE_OWNER,
    )
  )
    throw new Error("PROJECT_DRIVE_PERMISSION_CONFLICT");
  if (
    Object.entries(expected).some(
      ([key, value]) => file.appProperties?.[key] !== value,
    )
  )
    throw new Error("PROJECT_DRIVE_IDENTITY_CONFLICT");
}
async function getFile(t: DriveTransport, id: string) {
  const response = await t.request(
    `/files/${encodeURIComponent(id)}?fields=id,name,mimeType,webViewLink,appProperties,owners(emailAddress),permissions(type,role,emailAddress)`,
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("PROJECT_DRIVE_READ_FAILED");
  return (await response.json()) as DriveFile;
}
async function ensureFolder(
  t: DriveTransport,
  id: string,
  name: string,
  parent: string | undefined,
  props: Record<string, string>,
) {
  let file = await getFile(t, id);
  if (!file) {
    const response = await t.request("/files?fields=id", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        name,
        mimeType: "application/vnd.google-apps.folder",
        ...(parent ? { parents: [parent] } : {}),
        appProperties: props,
      }),
    });
    if (!response.ok && response.status !== 409)
      throw new Error("PROJECT_DRIVE_FOLDER_FAILED");
    file = await getFile(t, id);
  }
  if (!file) throw new Error("PROJECT_DRIVE_FOLDER_FAILED");
  assertPrivateDriveFile(file, props);
  return file;
}
export async function ensureDriveTree(
  t: DriveTransport,
  plan: DrivePlan,
  organizationId: string,
  projectId: string,
  folio: string,
) {
  const root = await ensureFolder(
    t,
    plan.rootId,
    "Proyectos ENNCO",
    undefined,
    { enncoOrganizationId: organizationId, enncoPurpose: "projects-root" },
  );
  assertPrivateDriveFile(root, {
    enncoOrganizationId: organizationId,
    enncoPurpose: "projects-root",
  });
  await ensureFolder(t, plan.folderId, folio, plan.rootId, {
    enncoProjectId: projectId,
    enncoPurpose: "project",
  });
  for (const [index, section] of DOCUMENT_SECTIONS.entries()) {
    const id = plan.sections[section];
    if (!id) throw new Error("PROJECT_DRIVE_PLAN_INCOMPLETE");
    await ensureFolder(
      t,
      id,
      `${String(index + 1).padStart(2, "0")}. ${section}`,
      plan.folderId,
      { enncoProjectId: projectId, enncoSection: section },
    );
  }
  return `https://drive.google.com/drive/folders/${plan.folderId}`;
}
export async function uploadDriveDocument(
  t: DriveTransport,
  input: {
    id: string;
    projectId: string;
    name: string;
    section: DocumentSection;
    parentId: string;
    sha256: string;
    bytes: Uint8Array;
    mimeType: string;
  },
) {
  const props = { enncoProjectId: input.projectId, enncoSha256: input.sha256 };
  let file = await getFile(t, input.id);
  if (!file) {
    const boundary = `ennco_${crypto.randomUUID()}`;
    const metadata = JSON.stringify({
      id: input.id,
      name: input.name,
      parents: [input.parentId],
      appProperties: props,
    });
    const prefix = new TextEncoder().encode(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${input.mimeType}\r\n\r\n`,
      ),
      suffix = new TextEncoder().encode(`\r\n--${boundary}--`);
    const payload = new Uint8Array(
      prefix.length + input.bytes.length + suffix.length,
    );
    payload.set(prefix);
    payload.set(input.bytes, prefix.length);
    payload.set(suffix, prefix.length + input.bytes.length);
    const response = await t.request(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
      {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body: payload,
      },
    );
    if (!response.ok && response.status !== 409)
      throw new Error("PROJECT_DRIVE_UPLOAD_FAILED");
    file = await getFile(t, input.id);
  }
  if (!file) throw new Error("PROJECT_DRIVE_UPLOAD_FAILED");
  assertPrivateDriveFile(file, props);
  return {
    id: file.id,
    url: `https://drive.google.com/file/d/${file.id}/view`,
  };
}
