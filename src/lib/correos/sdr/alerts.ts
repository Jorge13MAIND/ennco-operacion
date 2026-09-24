import { z } from "zod";
import type { RuntimeConfig } from "@/lib/runtime/config";
import { sdrCommand } from "@/lib/correos/sdr/client";
import { sendSdrAlertEmail } from "@/lib/correos/sdr/alert-email";

const alertSchema = z.object({ case_id: z.uuid(), stage: z.enum(["PRIMARY", "BACKUP", "NO_BACKUP", "OVERDUE"]),
  pending_minutes: z.number().int().nonnegative(), backup_configured: z.boolean(),
  owner_email: z.string().nullable(), backup_email: z.string().nullable() });
const workSchema = z.object({ status: z.literal("ALERT_WORK"), alerts: z.array(alertSchema).max(10),
  oldest_pending_minutes: z.number().int().nonnegative() });

/** Provider acceptance is logged separately from a person's Control Room acknowledgment. */
export async function runSdrAlerts(config: RuntimeConfig, deps: {
  command?: typeof sdrCommand; send?: typeof sendSdrAlertEmail;
} = {}) {
  const command = deps.command ?? sdrCommand;
  const send = deps.send ?? sendSdrAlertEmail;
  const work = workSchema.parse(await command(config, { op: "ALERT_WORK" }));
  let accepted = 0;
  let unavailable = 0;
  let ambiguous = 0;
  for (const item of work.alerts) {
    let outcome: "ACCEPTED" | "UNAVAILABLE" | "AMBIGUOUS";
    try { outcome = await send(config, item); }
    catch { outcome = "AMBIGUOUS"; }
    await command(config, { op: "ALERT_SETTLE", case_id: item.case_id, stage: item.stage,
      accepted: outcome === "AMBIGUOUS" ? null : outcome === "ACCEPTED" });
    if (outcome === "ACCEPTED") accepted += 1;
    else if (outcome === "AMBIGUOUS") ambiguous += 1;
    else unavailable += 1;
  }
  return { state: unavailable || ambiguous ? "DEGRADED" : "OK", claimed: work.alerts.length,
    provider_accepted: accepted, provider_unavailable: unavailable, provider_ambiguous: ambiguous,
    oldest_pending_minutes: work.oldest_pending_minutes };
}
