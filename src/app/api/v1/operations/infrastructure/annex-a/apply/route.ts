import { NextResponse } from "next/server";

import { getMutationContext } from "@/lib/operations/route";
import {
  annexAImportResultSchema,
  createFrozenAnnexADatabaseSnapshot,
} from "@/lib/suppression/annex-a";

const idempotencyKeySchema = /^[a-f0-9]{64}$/u;
const privateHeaders = { "Cache-Control": "private, no-store" } as const;

export async function POST(request: Request): Promise<NextResponse> {
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim().toLowerCase() ?? "";
  if (!idempotencyKeySchema.test(idempotencyKey)) {
    return NextResponse.json({ error: "ANNEX_A_IDEMPOTENCY_KEY_INVALID" }, { status: 400, headers: privateHeaders });
  }
  const snapshot = createFrozenAnnexADatabaseSnapshot();
  const { data, error } = await context.client.rpc("apply_annex_a_suppression_snapshot", {
    target_organization_id: context.organizationId,
    target_snapshot: snapshot,
    target_idempotency_key: idempotencyKey,
  });
  if (error) {
    return NextResponse.json({ error: "ANNEX_A_IMPORT_REJECTED" }, { status: 409, headers: privateHeaders });
  }
  const result = annexAImportResultSchema.safeParse(data);
  if (!result.success) {
    return NextResponse.json({ error: "ANNEX_A_IMPORT_RESPONSE_INVALID" }, { status: 409, headers: privateHeaders });
  }
  return NextResponse.json(result.data, { status: 200, headers: privateHeaders });
}
