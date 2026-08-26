import { NextResponse } from "next/server";
import { z } from "zod";

import {
  hybridMailboxMutationResultSchema,
  hybridMailboxObservationInputSchema,
} from "@/lib/infrastructure/hybrid-outbound";
import { getMutationContext } from "@/lib/operations/route";

const idempotencyKeySchema = /^[a-f0-9]{64}$/u;
const privateHeaders = { "Cache-Control": "private, no-store" } as const;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const mailboxId = z.uuid().safeParse((await params).id);
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim().toLowerCase() ?? "";
  if (!mailboxId.success || !idempotencyKeySchema.test(idempotencyKey)) {
    return NextResponse.json({ error: "HYBRID_OBSERVATION_REFERENCE_INVALID" }, { status: 400, headers: privateHeaders });
  }
  const payload = hybridMailboxObservationInputSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) {
    return NextResponse.json({ error: "HYBRID_OBSERVATION_INPUT_INVALID" }, { status: 400, headers: privateHeaders });
  }
  const { data, error } = await context.client.rpc("record_hybrid_mailbox_observation", {
    target_organization_id: context.organizationId,
    target_mailbox_id: mailboxId.data,
    target_metrics: payload.data,
    target_idempotency_key: idempotencyKey,
  });
  if (error) return NextResponse.json({ error: "HYBRID_OBSERVATION_REJECTED" }, { status: 409, headers: privateHeaders });
  const result = hybridMailboxMutationResultSchema.safeParse(data);
  if (!result.success) {
    return NextResponse.json({ error: "HYBRID_OBSERVATION_RESPONSE_INVALID" }, { status: 409, headers: privateHeaders });
  }
  return NextResponse.json(result.data, { status: 200, headers: privateHeaders });
}
