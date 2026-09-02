import { NextResponse } from "next/server";
import { z } from "zod";

import { correosMutation, correosRejected, privateHeaders, rpcErrorCode } from "@/lib/correos/http";
import { uuidSchema } from "@/lib/operations/mutations";

const bodySchema = z.object({
  status: z.enum(["CONNECTED", "PAUSED", "KILLED"]).optional(),
  ramp_mode: z.enum(["AUTO", "FIXED"]).optional(),
  fixed_cap: z.number().int().min(0).max(100).optional(),
  cap_max: z.number().int().min(0).max(100).optional(),
  display_name: z.string().trim().min(3).max(120).optional(),
  reason: z.string().trim().min(3).max(500),
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const mailboxId = uuidSchema.safeParse(id);
  if (!mailboxId.success) return correosRejected("CORREOS_MAILBOX_ID_INVALID", 400);
  const mutation = await correosMutation(request, bodySchema);
  if (!mutation.ok) return mutation.response;
  const { reason, ...patch } = mutation.body;
  const { data, error } = await mutation.client.rpc("configure_direct_lane_mailbox", {
    target_organization_id: mutation.organizationId,
    target_mailbox_id: mailboxId.data,
    target_patch: patch,
    target_reason: reason,
    target_idempotency_key: mutation.idempotencyKey,
  });
  if (error) return correosRejected(rpcErrorCode(error, "DIRECT_LANE_CONFIGURE_REJECTED"));
  return NextResponse.json(data, { status: 200, headers: privateHeaders });
}
