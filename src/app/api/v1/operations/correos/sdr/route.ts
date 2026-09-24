import { NextResponse } from "next/server";
import { z } from "zod";
import { correosMutation, correosRejected, privateHeaders, rpcErrorCode } from "@/lib/correos/http";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("MODE"), mode: z.enum(["PAUSED", "REVIEW", "AUTO"]) }).strict(),
  z.object({ action: z.literal("ACK"), case_id: z.uuid() }).strict(),
  z.object({ action: z.enum(["APPROVE", "REVIEWED", "RETRY"]), case_id: z.uuid(), thread_hash: z.string().nullable(), note: z.string().trim().min(5).max(1000) }).strict(),
]);
export async function POST(request: Request) {
  const mutation = await correosMutation(request, schema);
  if (!mutation.ok) return mutation.response;
  const body = mutation.body;
  const org = { target_organization_id: mutation.organizationId };
  const result = body.action === "MODE"
    ? await mutation.client.rpc("set_email_sdr_mode", { ...org, target_mode: body.mode })
    : body.action === "ACK"
      ? await mutation.client.rpc("ack_email_sdr_alert", { ...org, target_case_id: body.case_id })
      : await mutation.client.rpc("review_email_sdr_case", { ...org, target_case_id: body.case_id, target_thread_hash: body.thread_hash, target_action: body.action, target_note: body.note });
  if (result.error) return correosRejected(rpcErrorCode(result.error, "SDR_ACTION_REJECTED"));
  return NextResponse.json(result.data, { headers: privateHeaders });
}
