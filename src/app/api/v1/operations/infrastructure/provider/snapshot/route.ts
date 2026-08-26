import { NextResponse } from "next/server";

import { outboundProviderSnapshotResultSchema, outboundProviderSnapshotSchema } from "@/lib/infrastructure/provider-snapshot";
import { getMutationContext } from "@/lib/operations/route";

const idempotencyKeySchema = /^[a-f0-9]{64}$/u;
const privateHeaders = { "Cache-Control": "private, no-store" } as const;

export async function POST(request: Request): Promise<NextResponse> {
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim().toLowerCase() ?? "";
  if (!idempotencyKeySchema.test(idempotencyKey)) {
    return NextResponse.json({ error: "PROVIDER_SNAPSHOT_IDEMPOTENCY_KEY_INVALID" }, { status: 400, headers: privateHeaders });
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > 250_000) {
    return NextResponse.json({ error: "PROVIDER_SNAPSHOT_BODY_TOO_LARGE" }, { status: 413, headers: privateHeaders });
  }
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "PROVIDER_SNAPSHOT_JSON_INVALID" }, { status: 400, headers: privateHeaders });
  }
  const snapshot = outboundProviderSnapshotSchema.safeParse(rawBody);
  if (!snapshot.success) {
    return NextResponse.json({ error: "PROVIDER_SNAPSHOT_INPUT_INVALID" }, { status: 400, headers: privateHeaders });
  }
  const { data, error } = await context.client.rpc("apply_apollo_dedicated_provider_snapshot", {
    target_organization_id: context.organizationId,
    target_snapshot: snapshot.data,
    target_idempotency_key: idempotencyKey,
  });
  if (error) {
    return NextResponse.json({ error: "PROVIDER_SNAPSHOT_REJECTED" }, { status: 409, headers: privateHeaders });
  }
  const result = outboundProviderSnapshotResultSchema.safeParse(data);
  if (!result.success) {
    return NextResponse.json({ error: "PROVIDER_SNAPSHOT_RESPONSE_INVALID" }, { status: 409, headers: privateHeaders });
  }
  return NextResponse.json(result.data, { status: 200, headers: privateHeaders });
}
