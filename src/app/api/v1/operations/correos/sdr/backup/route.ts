import { NextResponse } from "next/server";
import { z } from "zod";
import { correosMutation, correosRejected, privateHeaders, rpcErrorCode } from "@/lib/correos/http";

const bodySchema = z.object({ backup_user_id: z.uuid() }).strict();
export async function POST(request: Request) {
  const mutation = await correosMutation(request, bodySchema);
  if (!mutation.ok) return mutation.response;
  const { data, error } = await mutation.client.rpc("configure_email_sdr_backup", {
    target_organization_id: mutation.organizationId,
    target_backup_user_id: mutation.body.backup_user_id,
    target_idempotency_key: mutation.idempotencyKey,
  });
  if (error) return correosRejected(rpcErrorCode(error, "SDR_BACKUP_REJECTED"));
  return NextResponse.json(data, { headers: privateHeaders });
}
