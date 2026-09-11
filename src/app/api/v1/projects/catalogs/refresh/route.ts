import {
  api,
  context,
  body,
  key,
  accessFor,
  ProjectApiError,
} from "@/lib/projects/server";
import {
  refreshSource,
  sourceRefreshSchema,
  SourceRefreshError,
} from "@/lib/projects/source-refresh";
export const maxDuration = 30;
export async function POST(request: Request) {
  return api(async () => {
    const c = await context(request),
      access = await accessFor(c);
    if (!access.canManageCatalogs)
      throw new ProjectApiError("PROJECT_FORBIDDEN", 403);
    key(request);
    try {
      return {
        candidate: await refreshSource(
          sourceRefreshSchema.parse(await body(request)),
        ),
      };
    } catch (e) {
      if (e instanceof SourceRefreshError)
        throw new ProjectApiError(e.code, 503);
      throw e;
    }
  });
}
