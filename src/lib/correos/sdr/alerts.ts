import { z } from "zod";
import { sendDispatchAlert } from "@/lib/dispatch/telegram";
import type { RuntimeConfig } from "@/lib/runtime/config";
import { sdrCommand } from "@/lib/correos/sdr/client";

const alertSchema = z.object({ case_id: z.uuid(), stage: z.enum(["PRIMARY", "BACKUP", "NO_BACKUP", "OVERDUE"]),
  pending_minutes: z.number().int().nonnegative(), backup_configured: z.boolean() });
const workSchema = z.object({ status: z.literal("ALERT_WORK"), alerts: z.array(alertSchema).max(10),
  oldest_pending_minutes: z.number().int().nonnegative() });

/** Provider acceptance is logged separately from a person's Control Room acknowledgment. */
export async function runSdrAlerts(config: RuntimeConfig, deps: {
  command?: typeof sdrCommand; send?: typeof sendDispatchAlert;
} = {}) {
  const command = deps.command ?? sdrCommand;
  const send = deps.send ?? sendDispatchAlert;
  const work = workSchema.parse(await command(config, { op: "ALERT_WORK" }));
  let accepted = 0;
  let unavailable = 0;
  for (const item of work.alerts) {
    const level = item.stage === "OVERDUE" || item.stage === "NO_BACKUP" ? "CRITICAL" : "WARN";
    const title = item.stage === "OVERDUE" ? "respuesta sin acuse: nuevas incorporaciones pausadas"
      : item.stage === "BACKUP" ? "respuesta pendiente: respaldo debe tomarla"
      : item.stage === "NO_BACKUP" ? "respuesta pendiente: no hay respaldo activo"
      : "respuesta pendiente de acuse";
    const delivered = await send({ config, level, title,
      lines: [`Caso ${item.case_id}`, `${item.pending_minutes} minuto(s) sin acuse humano`,
        "Abrir Control Room: ennco-operacion.vercel.app/operacion/correos"] });
    await command(config, { op: "ALERT_SETTLE", case_id: item.case_id, stage: item.stage, accepted: delivered });
    if (delivered) accepted += 1;
    else unavailable += 1;
  }
  return { state: unavailable ? "DEGRADED" : "OK", claimed: work.alerts.length,
    provider_accepted: accepted, provider_unavailable: unavailable,
    oldest_pending_minutes: work.oldest_pending_minutes };
}
