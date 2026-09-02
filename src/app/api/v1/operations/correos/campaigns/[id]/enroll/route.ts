import { NextResponse } from "next/server";
import { z } from "zod";

import { correosMutation, correosRejected, privateHeaders, rpcErrorCode } from "@/lib/correos/http";
import { uuidSchema } from "@/lib/operations/mutations";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const campaignId = uuidSchema.safeParse(id);
  if (!campaignId.success) return correosRejected("CORREOS_CAMPAIGN_ID_INVALID", 400);
  const mutation = await correosMutation(request, z.object({
    mailbox_id: z.uuid().nullable().default(null),
    contact_ids: z.array(z.uuid()).max(500).nullable().default(null),
    max_count: z.number().int().min(1).max(500).default(50),
  }).strict());
  if (!mutation.ok) return mutation.response;
  const { data, error } = await mutation.client.rpc("enroll_direct_lane_contacts", {
    target_organization_id: mutation.organizationId,
    target_campaign_id: campaignId.data,
    target_mailbox_id: mutation.body.mailbox_id,
    target_contact_ids: mutation.body.contact_ids,
    target_max_count: mutation.body.max_count,
    target_idempotency_key: mutation.idempotencyKey,
  });
  if (error) return correosRejected(rpcErrorCode(error, "DIRECT_LANE_ENROLL_REJECTED"));
  return NextResponse.json(data, { status: 200, headers: privateHeaders });
}
