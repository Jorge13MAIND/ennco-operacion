import { z } from "zod";
import {
  api,
  context,
  body,
  key,
  accessFor,
  ProjectApiError,
} from "@/lib/projects/server";
import {
  listProjectMembers,
  setProjectMemberAreas,
} from "@/lib/projects/repository";
import { PROJECT_AREAS } from "@/lib/projects/types";
const schema = z
  .object({ userId: z.uuid(), areas: z.array(z.enum(PROJECT_AREAS)).max(6) })
  .strict();
export async function GET() {
  return api(async () => {
    const c = await context(),
      access = await accessFor(c);
    if (!access.canManageMembers)
      throw new ProjectApiError("PROJECT_FORBIDDEN", 403);
    return {
      members: c.evidenceClass === "live" ? await listProjectMembers(c) : [],
      access,
    };
  });
}
export async function POST(request: Request) {
  return api(async () => {
    const c = await context(request),
      access = await accessFor(c);
    if (!access.canManageMembers)
      throw new ProjectApiError("PROJECT_FORBIDDEN", 403);
    const v = schema.parse(await body(request));
    if (c.evidenceClass !== "live")
      throw new ProjectApiError("PROJECT_DEMO_MEMBERS_UNAVAILABLE", 409);
    await setProjectMemberAreas(c, v.userId, v.areas, key(request));
    return { members: await listProjectMembers(c), access };
  });
}
