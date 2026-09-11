import { z } from "zod";
import {
  api,
  context,
  key,
  body,
  bundleFor,
  detail,
} from "@/lib/projects/server";
import { syncProjectDrive } from "@/lib/projects/document-service";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return api(async () => {
    const c = await context(request),
      id = (await params).id,
      v = z
        .object({ expectedVersion: z.number().int().positive() })
        .strict()
        .parse(await body(request));
    const b = await bundleFor(c, id);
    void v;
    const result = await syncProjectDrive(c, b, key(request));
    return { ...detail(c, result.bundle), drive: result.drive };
  });
}
