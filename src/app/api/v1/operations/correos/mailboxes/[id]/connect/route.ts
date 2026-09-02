import { NextResponse } from "next/server";
import { z } from "zod";

import { correosMutation, correosRejected, privateHeaders, rpcErrorCode } from "@/lib/correos/http";
import { buildInvitationUrl, createInvitationToken, DIRECT_LANE_INVITATION_DAYS } from "@/lib/correos/oauth";
import { uuidSchema } from "@/lib/operations/mutations";
import { getRuntimeConfig } from "@/lib/runtime/config";

/**
 * Genera la liga de consentimiento de un buzón. La liga se muestra UNA sola
 * vez (la base guarda el hash); quien la abra autoriza en Google como ese
 * buzón exacto. Vence en 7 días.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const mailboxId = uuidSchema.safeParse(id);
  if (!mailboxId.success) return correosRejected("CORREOS_MAILBOX_ID_INVALID", 400);
  const mutation = await correosMutation(request, z.object({}).passthrough());
  if (!mutation.ok) return mutation.response;
  const config = getRuntimeConfig();
  if (!config.directLaneReleased) return correosRejected("DIRECT_LANE_NOT_RELEASED", 503);
  const { token, tokenSha256 } = createInvitationToken();
  const expiresAt = new Date(Date.now() + DIRECT_LANE_INVITATION_DAYS * 86_400_000).toISOString();
  const { data, error } = await mutation.client.rpc("create_direct_lane_invitation", {
    target_organization_id: mutation.organizationId,
    target_mailbox_id: mailboxId.data,
    target_token_sha256: tokenSha256,
    target_expires_at: expiresAt,
    target_idempotency_key: mutation.idempotencyKey,
  });
  if (error) return correosRejected(rpcErrorCode(error, "DIRECT_LANE_INVITATION_REJECTED"));
  const result = z.object({ status: z.string(), normalized_email: z.string(), expires_at: z.string(), replayed: z.boolean().optional() }).passthrough().safeParse(data);
  if (!result.success) return correosRejected("DIRECT_LANE_INVITATION_RESPONSE_INVALID");
  // Un replay idempotente no puede regresar la liga: el token ya no existe en claro.
  return NextResponse.json({
    status: result.data.status,
    normalized_email: result.data.normalized_email,
    expires_at: result.data.expires_at,
    invitation_url: result.data.replayed ? null : buildInvitationUrl(config.appUrl, token),
  }, { status: 200, headers: privateHeaders });
}
