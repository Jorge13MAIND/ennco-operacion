import { api, context, body, key, append, detail } from "@/lib/projects/server";
import { appendRecordSchema } from "@/lib/projects/schemas";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return api(async () => {
    const c = await context(request),
      v = appendRecordSchema.parse(await body(request));
    return detail(
      c,
      await append(
        c,
        (await params).id,
        v.expectedVersion,
        v.kind,
        v.data,
        key(request),
      ),
    );
  });
}
