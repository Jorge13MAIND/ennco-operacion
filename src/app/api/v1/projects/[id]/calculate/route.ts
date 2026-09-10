import { z } from "zod";
import {
  api,
  context,
  body,
  key,
  append,
  detail,
  bundleFor,
  catalogs,
  hash,
  ProjectApiError,
} from "@/lib/projects/server";
import { engineeringInputSchema } from "@/lib/projects/engineering";
import { runReviewedCalculation } from "@/lib/projects/calculation";
const schema = z
  .object({
    expectedVersion: z.number().int().positive(),
    input: engineeringInputSchema,
  })
  .strict();
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return api(async () => {
    const c = await context(request),
      id = (await params).id,
      v = schema.parse(await body(request)),
      b = await bundleFor(c, id);
    if (v.input.segment !== b.project.segment)
      throw new ProjectApiError("PROJECT_SEGMENT_MISMATCH", 422);
    const requestFingerprint = hash(JSON.stringify(v)),
      operationKeyHash = hash(key(request));
    const existing = b.records.find(
      (r) =>
        r.kind === "calculation" &&
        r.data.operationKeyHash === operationKeyHash &&
        (c.evidenceClass === "synthetic_demo" || r.actorId === c.userId),
    );
    if (existing) {
      if (existing.data.requestFingerprint !== requestFingerprint)
        throw new ProjectApiError("PROJECT_IDEMPOTENCY_CONFLICT");
      return { ...detail(c, b), calculation: existing.data.result };
    }
    const calculation = runReviewedCalculation(v.input, await catalogs(c));
    const record = {
      operationKeyHash,
      requestFingerprint,
      input: calculation.input,
      result: calculation.result,
      inputHash: hash(JSON.stringify(calculation.input)),
      sourceVersions: calculation.snapshots,
      reviewStatus: "PENDING",
      customerSnapshot: {
        customerName: b.project.customerName,
        contactName: b.project.contactName,
        location: b.project.location,
        scope: b.project.scope,
      },
    };
    return {
      ...detail(
        c,
        await append(
          c,
          id,
          v.expectedVersion,
          "calculation",
          record,
          key(request),
          true,
        ),
      ),
      calculation: calculation.result,
    };
  });
}
