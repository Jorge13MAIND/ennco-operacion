import { NextResponse } from "next/server";

import {
  hybridMailboxMutationResultSchema,
  hybridMailboxSnapshotSchema,
} from "@/lib/infrastructure/hybrid-outbound";
import { getMutationContext } from "@/lib/operations/route";

const idempotencyKeySchema = /^[a-f0-9]{64}$/u;
const privateHeaders = { "Cache-Control": "private, no-store" } as const;

export async function POST(request: Request): Promise<NextResponse> {
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim().toLowerCase() ?? "";
  if (!idempotencyKeySchema.test(idempotencyKey)) {
    return NextResponse.json({ error: "HYBRID_MAILBOX_IDEMPOTENCY_KEY_INVALID" }, { status: 400, headers: privateHeaders });
  }
  const payload = hybridMailboxSnapshotSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) {
    return NextResponse.json({ error: "HYBRID_MAILBOX_SNAPSHOT_INPUT_INVALID" }, { status: 400, headers: privateHeaders });
  }
  const { data, error } = await context.client.rpc("apply_hybrid_mailbox_snapshot", {
    target_organization_id: context.organizationId,
    target_snapshot: payload.data,
    target_idempotency_key: idempotencyKey,
  });
  if (error) return NextResponse.json({ error: "HYBRID_MAILBOX_SNAPSHOT_REJECTED" }, { status: 409, headers: privateHeaders });
  const result = hybridMailboxMutationResultSchema.safeParse(data);
  if (!result.success) {
    return NextResponse.json({ error: "HYBRID_MAILBOX_SNAPSHOT_RESPONSE_INVALID" }, { status: 409, headers: privateHeaders });
  }
  return NextResponse.json(result.data, { status: 200, headers: privateHeaders });
}
