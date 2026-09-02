import { NextResponse } from "next/server";
import { z } from "zod";

import { correosMutation, correosRejected, privateHeaders, rpcErrorCode } from "@/lib/correos/http";
import { uuidSchema } from "@/lib/operations/mutations";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const mailboxId = uuidSchema.safeParse(id);
  if (!mailboxId.success) return correosRejected("CORREOS_MAILBOX_ID_INVALID", 400);
  const mutation = await correosMutation(request, z.object({ reason: z.string().trim().min(3).max(500) }).strict());
  if (!mutation.ok) return mutation.response;
  const { data, error } = await mutation.client.rpc("revoke_direct_lane_credential", {
    target_organization_id: mutation.organizationId,
    target_mailbox_id: mailboxId.data,
    target_reason: mutation.body.reason,
    target_idempotency_key: mutation.idempotencyKey,
  });
  if (error) return correosRejected(rpcErrorCode(error, "DIRECT_LANE_REVOKE_REJECTED"));
  return NextResponse.json(data, { status: 200, headers: privateHeaders });
}
