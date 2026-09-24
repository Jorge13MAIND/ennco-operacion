import { extractReplyText } from "@/lib/gmail/body";
import { threadSchema } from "@/lib/correos/sdr/policy";
import { loadRecoveryOverview, type RecoveryOverview } from "@/lib/correos/recovery-overview";
import { z } from "zod";
import type { OperationsAccessContext } from "@/lib/auth/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const sdrCaseSchema = z.object({
  contact_email: z.string().nullable(), mailbox_email: z.string(), subject: z.string().nullable(),
  conversation: z.array(z.object({ from: z.string(), date: z.string(), text: z.string() })).default([]),
  id: z.uuid(), provider_event_id: z.uuid(), owner_user_id: z.uuid().nullable(),
  can_ack: z.boolean().default(false),
  state: z.string(), thread_hash: z.string().nullable(), next_action: z.string(), updated_at: z.string(),
  reply_classification: z.string().optional(),
  decision: z.object({ intent: z.string(), eligible: z.boolean(), draft: z.string().optional(), evidence: z.array(z.string()).optional(), gates: z.array(z.string()).optional() }).passthrough().nullable(),
});
export type SdrCaseView = z.infer<typeof sdrCaseSchema>;
const statusSchema = z.object({ mode: z.enum(["PAUSED", "REVIEW", "AUTO"]), reviewed_canaries: z.number(), pending_alerts: z.number(), legacy_open_incidents: z.number(), model_calls_enabled: z.boolean() });
const inventorySchema = z.object({ uncontacted: z.number().int(), ready: z.number().int(),
  verified_accounts: z.number().int(), promoted_contacts: z.number().int(),
  review_queue: z.array(z.object({ contact_id: z.uuid(), full_name: z.string(), role_title: z.string(),
    legal_name: z.string(), state: z.string().nullable(), account_research_status: z.string(),
    person_researched: z.boolean(), clearance_decision: z.string().nullable(), clearance_expires_at: z.string().nullable() })).max(50) });
export type SdrScreen = { available: boolean; live: boolean; cases: SdrCaseView[]; unmatched: RecoveryOverview["unmatched"];
  status: z.infer<typeof statusSchema> | null; inventory: z.infer<typeof inventorySchema> | null };
export async function loadSdrScreen(access: OperationsAccessContext): Promise<SdrScreen> {
  if (access.evidenceClass !== "live" || !access.organizationId) return { available: true, live: false, cases: [], unmatched: [], status: null, inventory: null };
  const client = await createSupabaseServerClient();
  const [cases, status, recovery, inventory] = await Promise.all([
    client.rpc("read_email_sdr_cases", { target_organization_id: access.organizationId }),
    client.rpc("read_email_sdr_status", { target_organization_id: access.organizationId }),
    loadRecoveryOverview(access.organizationId),
    client.rpc("read_email_contact_inventory", { target_organization_id: access.organizationId }),
  ]);
  const rows = Array.isArray(cases.data) ? cases.data.map((row: Record<string, unknown>) => {
    const thread = threadSchema.safeParse(row.thread);
    return { ...row, conversation: thread.success ? thread.data.messages.map(m => ({
      from: m.payload.headers.find(h => h.name.toLowerCase() === "from")?.value ?? "Identidad no disponible",
      date: new Date(Number(m.internalDate)).toISOString(), text: extractReplyText(m) ?? "Sin cuerpo recuperado",
    })) : [] };
  }) : null;
  const parsedCases = z.array(sdrCaseSchema).safeParse(rows);
  const parsedStatus = statusSchema.safeParse(status.data);
  const parsedInventory = inventorySchema.safeParse(inventory.data);
  if (cases.error || status.error || !parsedCases.success || !parsedStatus.success) return { available: false, live: true, cases: [], unmatched: [], status: null, inventory: null };
  return { available: true, live: true, cases: parsedCases.data, unmatched: recovery.unmatched,
    status: parsedStatus.data, inventory: inventory.error || !parsedInventory.success ? null : parsedInventory.data };
}
