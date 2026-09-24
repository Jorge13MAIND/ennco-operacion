import { NextResponse } from "next/server";
import { z } from "zod";
import { correosMutation, correosRejected, privateHeaders, rpcErrorCode } from "@/lib/correos/http";

const bodySchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("READY"), plant_state: z.enum(["GUANAJUATO", "QUERETARO", "JALISCO", "MICHOACAN"]),
    plant_source_url: z.url(), responsibility_source_url: z.url(),
    responsibility_note: z.string().trim().min(20).max(1000), expires_at: z.iso.datetime({ offset: true }) }).strict(),
  z.object({ decision: z.literal("HELD") }).strict(),
]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const contact = z.uuid().safeParse((await params).id);
  if (!contact.success) return correosRejected("EMAIL_CONTACT_ID_INVALID", 400);
  const mutation = await correosMutation(request, bodySchema);
  if (!mutation.ok) return mutation.response;
  const b = mutation.body;
  const { data, error } = await mutation.client.rpc("review_email_contact_clearance", {
    target_org: mutation.organizationId, target_contact: contact.data, target_decision: b.decision,
    target_plant_state: b.decision === "READY" ? b.plant_state : null,
    target_plant_source_url: b.decision === "READY" ? b.plant_source_url : null,
    target_responsibility_source_url: b.decision === "READY" ? b.responsibility_source_url : null,
    target_responsibility_note: b.decision === "READY" ? b.responsibility_note : null,
    target_expires_at: b.decision === "READY" ? b.expires_at : null,
    target_idempotency_key: mutation.idempotencyKey,
  });
  if (error) return correosRejected(rpcErrorCode(error, "EMAIL_CONTACT_CLEARANCE_REJECTED"));
  return NextResponse.json(data, { headers: privateHeaders });
}
