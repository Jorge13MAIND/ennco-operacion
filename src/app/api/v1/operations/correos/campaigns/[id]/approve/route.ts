import { NextResponse } from "next/server";
import { z } from "zod";

import { correosMutation, correosRejected, privateHeaders, rpcErrorCode } from "@/lib/correos/http";
import { uuidSchema } from "@/lib/operations/mutations";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const campaignId = uuidSchema.safeParse(id);
  if (!campaignId.success) return correosRejected("CORREOS_CAMPAIGN_ID_INVALID", 400);
  const mutation = await correosMutation(request, z.object({ confirm: z.literal(true) }).strict());
  if (!mutation.ok) return mutation.response;
  const { data, error } = await mutation.client.rpc("approve_direct_lane_campaign", {
    target_organization_id: mutation.organizationId,
    target_campaign_id: campaignId.data,
    target_idempotency_key: mutation.idempotencyKey,
  });
  if (error) return correosRejected(rpcErrorCode(error, "DIRECT_LANE_APPROVAL_REJECTED"));
  return NextResponse.json(data, { status: 200, headers: privateHeaders });
}
