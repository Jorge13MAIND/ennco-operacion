import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { capacityConfigResultSchema, mapCapacityRpcError } from "@/lib/operations/capacity";
import { capacityConfigSchema } from "@/lib/operations/mutations";
import { getMutationContext, mutationResponse } from "@/lib/operations/route";

export async function POST(request: Request): Promise<NextResponse> {
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const payload = capacityConfigSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) {
    return NextResponse.json({ error: "CAPACITY_CONFIG_INPUT_INVALID" }, { status: 400 });
  }
  const monthlyLimit = 2;
  const warningAt = 1;
  const idempotencyKey = createHash("sha256")
    .update([
      "capacity-config-v1",
      context.organizationId,
      monthlyLimit,
      warningAt,
      payload.data.effectiveFromMonth,
      payload.data.sourceReference,
    ].join(":"))
    .digest("hex");
  const { data, error } = await context.client.rpc("create_operational_capacity_config", {
    target_organization_id: context.organizationId,
    target_monthly_limit: monthlyLimit,
    target_warning_at: warningAt,
    target_effective_from_month: payload.data.effectiveFromMonth,
    target_source_reference: payload.data.sourceReference,
    target_idempotency_key: idempotencyKey,
  });
  if (error) {
    const mapped = mapCapacityRpcError(error);
    return NextResponse.json({ error: mapped.code }, { status: mapped.status, headers: { "Cache-Control": "private, no-store" } });
  }
  const result = capacityConfigResultSchema.safeParse(data);
  if (!result.success) {
    return NextResponse.json({ error: "CAPACITY_RESPONSE_INVALID" }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
  }
  return mutationResponse(result.data);
}
