import { NextResponse } from "next/server";
import { z } from "zod";
import { correosMutation, correosRejected, privateHeaders, rpcErrorCode } from "@/lib/correos/http";

const bodySchema = z.object({ decision: z.enum(["REVIEWED", "UNRELATED", "NEEDS_CONTEXT"]), note: z.string().trim().min(5).max(1000) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const review = z.uuid().safeParse((await params).id);
  if (!review.success) return correosRejected("EMAIL_UNMATCHED_ID_INVALID", 400);
  const mutation = await correosMutation(request, bodySchema);
  if (!mutation.ok) return mutation.response;
  const { data, error } = await mutation.client.rpc("review_unmatched_email", {
    target_org: mutation.organizationId, target_review_id: review.data,
    target_decision: mutation.body.decision, target_note: mutation.body.note,
    target_idempotency_key: mutation.idempotencyKey,
  });
  if (error) return correosRejected(rpcErrorCode(error, "EMAIL_UNMATCHED_REVIEW_REJECTED"));
  return NextResponse.json(data, { headers: privateHeaders });
}
