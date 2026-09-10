import {
  api,
  context,
  bundleFor,
  body,
  key,
  update,
  detail,
} from "@/lib/projects/server";
import { updateProjectSchema } from "@/lib/projects/schemas";
type Params = { params: Promise<{ id: string }> };
export async function GET(_: Request, { params }: Params) {
  return api(async () => {
    const c = await context();
    return detail(c, await bundleFor(c, (await params).id));
  });
}
export async function PATCH(request: Request, { params }: Params) {
  return api(async () => {
    const c = await context(request),
      { expectedVersion, ...patch } = updateProjectSchema.parse(
        await body(request),
      );
    return detail(
      c,
      await update(c, (await params).id, expectedVersion, patch, key(request)),
    );
  });
}
