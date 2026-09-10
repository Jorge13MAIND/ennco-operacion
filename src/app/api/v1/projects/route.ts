import {
  api,
  context,
  allProjects,
  body,
  key,
  create,
  detail,
  bundleFor,
} from "@/lib/projects/server";
import { syncProjectDrive } from "@/lib/projects/document-service";
import { driveConfigured } from "@/lib/projects/drive";
import { createProjectSchema } from "@/lib/projects/schemas";
export const dynamic = "force-dynamic";
export async function GET() {
  return api(async () => allProjects(await context()));
}
export async function POST(request: Request) {
  return api(async () => {
    const c = await context(request);
    const k = key(request);
    let b = await create(c, createProjectSchema.parse(await body(request)), k);
    if (
      c.evidenceClass === "live" &&
      driveConfigured() &&
      b.permissions.canConfirmPayments
    ) {
      try {
        const r = await syncProjectDrive(c, b, k);
        b = r.bundle;
      } catch {
        b = await bundleFor(c, b.project.id);
        return {
          ...detail(c, b),
          drive: {
            status: "PENDING",
            message: "Expediente guardado; Drive pendiente de reintento.",
          },
        };
      }
    }
    return detail(c, b);
  });
}
