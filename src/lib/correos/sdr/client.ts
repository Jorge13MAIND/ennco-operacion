import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createDispatchProof } from "@/lib/dispatch/proof";
import type { RuntimeConfig } from "@/lib/runtime/config";
export const sdrWorkItemSchema = z.object({
  case_id: z.uuid(), event_id: z.uuid(), event_kind: z.string(), body: z.string().nullable(),
  mailbox_id: z.uuid(), mailbox_email: z.email(), contact_email: z.email(), owner_id: z.uuid().nullable(),
  provider_message_id: z.string().nullable(), provider_thread_id: z.string().nullable(), related_outbound_id: z.uuid(),
  suppressed: z.boolean(), followup: z.boolean(), followups_sent: z.number().int().min(0).max(2),
  approved: z.boolean(), decision: z.record(z.string(), z.unknown()).nullable(), own_sdr_message_ids: z.array(z.string()),
}).passthrough();
export type SdrWorkItem = z.infer<typeof sdrWorkItemSchema>;
export const workSchema = z.object({ status: z.literal("WORK"), mode: z.enum(["PAUSED", "REVIEW", "AUTO"]), policy_version: z.string(), cases: z.array(sdrWorkItemSchema).max(10) }).passthrough();
export function sdrEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  return { serviceSecret: environment.ENNCO_SDR_SERVICE_SECRET ?? "", apiKey: environment.ENNCO_SDR_OPENAI_API_KEY ?? "", model: environment.ENNCO_SDR_MODEL ?? "" };
}
export async function sdrCommand(config: RuntimeConfig, payload: Record<string, unknown>, secret = sdrEnvironment().serviceSecret): Promise<Record<string, unknown>> {
  if (!config.organizationId || !config.supabaseUrl || !config.supabasePublishableKey || secret.length < 32) throw new Error("SDR_SERVICE_NOT_CONFIGURED");
  const text = JSON.stringify(payload);
  const proof = createDispatchProof({ organizationId: config.organizationId, commandName: "email_sdr_command",
    payloadParts: [config.organizationId, createHash("sha256").update(text).digest("hex")], secret });
  const client = createClient(config.supabaseUrl, config.supabasePublishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await client.rpc("email_sdr_command", { target_organization_id: config.organizationId, target_payload: text, ...proof });
  if (error) throw new Error("SDR_SERVICE_COMMAND_FAILED");
  return z.record(z.string(), z.unknown()).parse(data);
}
