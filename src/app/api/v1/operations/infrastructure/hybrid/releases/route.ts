import { NextResponse } from "next/server";

import {
  hybridReleaseInputSchema,
  hybridReleaseResultSchema,
} from "@/lib/infrastructure/hybrid-outbound";
import { getMutationContext } from "@/lib/operations/route";

const idempotencyKeySchema = /^[a-f0-9]{64}$/u;
const privateHeaders = { "Cache-Control": "private, no-store" } as const;

export async function POST(request: Request): Promise<NextResponse> {
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim().toLowerCase() ?? "";
  if (!idempotencyKeySchema.test(idempotencyKey)) {
    return NextResponse.json({ error: "HYBRID_RELEASE_IDEMPOTENCY_KEY_INVALID" }, { status: 400, headers: privateHeaders });
  }
  const payload = hybridReleaseInputSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) {
    return NextResponse.json({ error: "HYBRID_RELEASE_INPUT_INVALID" }, { status: 400, headers: privateHeaders });
  }
  const { data, error } = await context.client.rpc("create_hybrid_outbound_release", {
    target_organization_id: context.organizationId,
    target_mailbox_id: payload.data.mailbox_id,
    target_campaign_id: payload.data.campaign_id,
    target_lane: payload.data.lane,
    target_manifest_sha256: payload.data.manifest_sha256,
    target_suppression_sha256: payload.data.suppression_sha256,
    target_copy_sha256: payload.data.copy_sha256,
    target_sequence_sha256: payload.data.sequence_sha256,
    target_scheduled_for: payload.data.scheduled_for,
    target_expires_at: payload.data.expires_at,
    target_enrollment_ids: payload.data.enrollment_ids,
    target_idempotency_key: idempotencyKey,
  });
  if (error) return NextResponse.json({ error: "HYBRID_RELEASE_REJECTED" }, { status: 409, headers: privateHeaders });
  const result = hybridReleaseResultSchema.safeParse(data);
  if (!result.success) {
    return NextResponse.json({ error: "HYBRID_RELEASE_RESPONSE_INVALID" }, { status: 409, headers: privateHeaders });
  }
  return NextResponse.json(result.data, { status: 200, headers: privateHeaders });
}
