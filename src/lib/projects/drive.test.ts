import { describe, it, expect } from "vitest";
import {
  assertPrivateDriveFile,
  ensureDriveTree,
  type DriveTransport,
} from "./drive";
import { DOCUMENT_SECTIONS } from "./types";
const owner = "contacto@ennco.com.mx";
describe("expediente Drive", () => {
  it("rechaza enlaces públicos, otro propietario y archivos ajenos", () => {
    const file = {
      id: "a",
      name: "A",
      mimeType: "application/pdf",
      owners: [{ emailAddress: owner }],
      permissions: [{ type: "user", role: "owner", emailAddress: owner }],
      appProperties: { enncoProjectId: "p" },
    };
    expect(() =>
      assertPrivateDriveFile(file, { enncoProjectId: "p" }),
    ).not.toThrow();
    expect(() =>
      assertPrivateDriveFile(
        { ...file, permissions: [{ type: "anyone", role: "reader" }] },
        { enncoProjectId: "p" },
      ),
    ).toThrow("PERMISSION");
    expect(() =>
      assertPrivateDriveFile(file, { enncoProjectId: "other" }),
    ).toThrow("IDENTITY");
  });
  it("reintenta usando IDs persistidos sin duplicar carpetas", async () => {
    const files = new Map<string, Record<string, unknown>>();
    let creates = 0;
    const t: DriveTransport = {
      request: async (path, init) => {
        if (init?.method === "POST") {
          const value = JSON.parse(String(init.body));
          creates++;
          files.set(value.id, {
            ...value,
            owners: [{ emailAddress: owner }],
            permissions: [{ type: "user", role: "owner", emailAddress: owner }],
          });
          return Response.json({ id: value.id });
        }
        const id = path.split("/files/")[1]?.split("?")[0] ?? "";
        return files.has(id)
          ? Response.json(files.get(id))
          : new Response(null, { status: 404 });
      },
    };
    const plan = {
      ownerEmail: owner,
      rootId: "root",
      folderId: "project",
      sections: Object.fromEntries(
        DOCUMENT_SECTIONS.map((s, i) => [s, `folder${i}`]),
      ),
    };
    await ensureDriveTree(t, plan, "org", "p", "ENNCO-1");
    await ensureDriveTree(t, plan, "org", "p", "ENNCO-1");
    expect(creates).toBe(10);
    expect(files.size).toBe(10);
  });
});
