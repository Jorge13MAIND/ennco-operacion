import { cache } from "react";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
const recoveryOverviewSchema = z.object({
  commercial_event_ids: z.array(z.uuid()),
  unmatched: z.array(z.object({ id: z.uuid(), normalized_from: z.string(), subject: z.string().nullable(), body_text: z.string().nullable(), next_action: z.string(), decision: z.enum(["PENDING", "NEEDS_CONTEXT"]) })),
});
export type RecoveryOverview = z.infer<typeof recoveryOverviewSchema>;
export const loadRecoveryOverview = cache(async (organizationId: string): Promise<RecoveryOverview> => {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("read_email_recovery_overview", { target_organization_id: organizationId });
  if (error) throw new Error("RECOVERY_OVERVIEW_UNAVAILABLE");
  return recoveryOverviewSchema.parse(data);
});
