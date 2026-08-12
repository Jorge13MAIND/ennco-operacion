import { NextResponse } from "next/server";

import { uuidSchema } from "@/lib/operations/mutations";
import { getMutationContext, mutationResponse, mutationUnavailable } from "@/lib/operations/route";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const taskId = uuidSchema.safeParse(id);
  if (!taskId.success) return NextResponse.json({ error: "TASK_ID_INVALID" }, { status: 400 });
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const { data, error } = await context.client.rpc("complete_operational_task", {
    target_organization_id: context.organizationId,
    target_task_id: taskId.data,
  });
  if (error) return mutationUnavailable("TASK_COMPLETION_REJECTED");
  return mutationResponse(data);
}
